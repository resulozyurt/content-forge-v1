// apps/web/src/app/api/generate/article/route.ts
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@contentforge/database"; 

const openai = new OpenAI();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
export const maxDuration = 300;

const payloadSchema = z.object({
    outlineData: z.any(),
    config: z.any()
});

export async function POST(req: NextRequest) {
    let currentJobId: string | null = null;
    let areCreditsDeducted = false;
    const ARTICLE_COST = 5;
    let currentUserId = "";

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return new Response(JSON.stringify({ message: "Unauthorized." }), { status: 401 });
        currentUserId = (session.user as any).id;

        const rawBody = await req.json();
        const { outlineData, config } = payloadSchema.parse(rawBody);

        const activeTool = await prisma.tool.findFirst({ where: { isActive: true } });
        if (!activeTool) throw new Error("No active AI tools.");

        const contentJob = await prisma.contentJob.create({
            data: { userId: currentUserId, toolId: activeTool.id, aiModel: "CLAUDE_3_5_SONNET", status: "PROCESSING", inputPayload: rawBody }
        });
        currentJobId = contentJob.id;

        await BillingGuard.checkCredits(currentUserId, ARTICLE_COST);
        await BillingGuard.deductCredits(currentUserId, ARTICLE_COST, "GENERATION");
        areCreditsDeducted = true;

        const totalHeadings = outlineData.headings.length;
        const targetTotalWords = parseInt(config.targetLength, 10) || 1000;
        const baseWordsPerSection = Math.max(100, Math.floor((targetTotalWords - 200) / totalHeadings)); // Reserved 200 words for FAQ/Conclusion

        // --- THE FIELDPIE DIRECTIVE (BRAND IDENTITY) ---
        let brandContext = "";
        let brandName = "Our Solution";
        let brandDesc = "";
        
        if (config.enableBrandVoice) {
            try {
                const brandProfile = await prisma.brandProfile.findUnique({ where: { userId: currentUserId } });
                if (brandProfile) {
                    brandName = brandProfile.name;
                    brandDesc = brandProfile.description;
                    brandContext = `\n[THE BRAND DIRECTIVE - CRITICAL]: 
You represent the brand "${brandName}" (${brandProfile.description}). 
1. If this section discusses a list of top tools, platforms, or software (e.g., "Top Platforms Compared"), YOU ABSOLUTELY MUST include "${brandName}" as the #1 highly recommended option in the list.
2. In general explanatory sections, subtly weave in how a modern tool like "${brandName}" solves the problem being discussed.
Do NOT sound like a cheap advertisement; sound like an objective industry expert who firmly believes ${brandName} is the best architectural choice.`;
                }
            } catch (e) {}
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (data: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                const closeStream = () => { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); };

                try {
                    let availableInternalLinks: string[] = [];
                    if (config.wpSitemap) {
                        try {
                            const sitemapRes = await fetch(config.wpSitemap, { signal: AbortSignal.timeout(5000) });
                            if (sitemapRes.ok) {
                                const sitemapXml = await sitemapRes.text();
                                const matches = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1]);
                                availableInternalLinks = matches.sort(() => 0.5 - Math.random()).slice(0, 15);
                            }
                        } catch (e) {}
                    }
                    let availableExternalLinks = [...new Set(outlineData.sourceUrls || [])]; 
                    
                    let h2Counter = 0;
                    let fullGeneratedHtml = ""; 

                    // --- GENERATION LOOP ---
                    for (let i = 0; i < outlineData.headings.length; i++) {
                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetKeyword = outlineData.selectedKeywords.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        const targetWords = heading.level === 'h2' ? baseWordsPerSection + 60 : Math.max(80, baseWordsPerSection - 20);

                        // --- SMART LINKING ENGINE ---
                        let externalLinksContext = "Do NOT add any external links in this section.";
                        if (availableExternalLinks.length > 0 && i % 3 === 0) {
                            const linkToUse = availableExternalLinks.pop();
                            externalLinksContext = `[EXTERNAL LINKING RULE]: You may use this exact URL <a href="${linkToUse}" target="_blank" rel="noopener noreferrer">${linkToUse}</a> ONLY as a citation for a statistic, fact, or industry standard. NEVER use it as a "Click here for more info" or "Read our guide" CTA. It must look like a natural academic/industry reference.`;
                        }

                        let internalLinksContext = "";
                        if (availableInternalLinks.length > 0 && i % 2 !== 0) {
                            const linkToUse = availableInternalLinks.pop();
                            internalLinksContext = `[INTERNAL LINKING RULE]: Naturally weave this internal URL <a href="${linkToUse}">into a relevant keyword</a> within the paragraph to guide the user deeper into our site.`;
                        }

                        // --- NATURAL & RICH FORMATTING PROMPT ---
                        const systemPrompt = `You are an elite Senior SEO Content Architect. Write the HTML body for the EXACT heading provided.

[FORMATTING & READABILITY RULES]:
1. DO NOT REWRITE THE HEADING. Only generate the content below it.
2. NATURAL FLOW: Write naturally. Do NOT force a bulleted list or a quote into every single section. Use paragraphs (2-4 sentences max per paragraph) as the main structure.
3. RICH ELEMENTS (USE STRATEGICALLY): 
   - IF the section compares items, features, or pros/cons, YOU MUST use an HTML <table>.
   - IF the section lists steps, benefits, or products, use a <ul> or <ol>.
   - IF the section is a general explanation, just use well-crafted <p> tags.
4. Language: EXACTLY ${config.language}. Tone: ${config.tone}. Target Word Count: ~${targetWords} words.
5. ${externalLinksContext}
6. ${internalLinksContext}
7. ${brandContext}`;

                        let generatedText = "";
                        try {
                            if (config.engine.toLowerCase().includes("claude")) {
                                const anthropicResponse = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6",
                                    max_tokens: 2500,
                                    system: systemPrompt,
                                    messages: [{ role: "user", content: `Write the highly readable HTML content body for the heading: "${heading.text}"\nTarget Keyword: "${targetKeyword}"` }],
                                    tools: [{ name: "generate_html", input_schema: { type: "object", properties: { htmlContent: { type: "string" } }, required: ["htmlContent"] } }],
                                    tool_choice: { type: "tool", name: "generate_html" },
                                    temperature: 0.7,
                                });
                                const toolBlock = anthropicResponse.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
                                const parsedData = typeof toolBlock?.input === 'string' ? JSON.parse(toolBlock.input) : toolBlock?.input;
                                generatedText = parsedData?.htmlContent || "";
                            } else {
                                const textCompletion = await openai.chat.completions.create({
                                    model: "gpt-4o",
                                    response_format: { type: "json_object" },
                                    messages: [
                                        { role: "system", content: systemPrompt + `\n\nOutput JSON: { "htmlContent": "..." }` },
                                        { role: "user", content: `Heading: "${heading.text}"` }
                                    ],
                                    temperature: 0.7,
                                });
                                generatedText = JSON.parse(textCompletion.choices[0].message.content || "{}").htmlContent || "";
                            }
                        } catch (e) { console.error(e); }

                        generatedText = generatedText.replace(/```html|```/g, '').trim();
                        fullGeneratedHtml += `<${heading.level}>${heading.text}</${heading.level}>\n${generatedText}\n`;
                        
                        sendEvent({ id: `h-${i}`, type: heading.level, content: heading.text });
                        sendEvent({ id: `p-${i}`, type: 'paragraph', content: generatedText });

                        // --- HIGH-QUALITY AI IMAGE ENGINE ---
                        if (heading.level === 'h2' && h2Counter > 0 && h2Counter % 3 === 0) {
                            try {
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", max_tokens: 500,
                                    system: "Create an English visual prompt. Style: Ultra-realistic corporate photography, raw DSLR, cinematic lighting, real humans working in an office or retail store, highly detailed faces, NO text, NO labels.",
                                    messages: [{ role: "user", content: `Create visual metadata for: "${heading.text}".` }],
                                    tools: [{ name: "gen_meta", input_schema: { type: "object", properties: { prompt: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } }, required: ["prompt", "alt", "caption"] } }],
                                    tool_choice: { type: "tool", name: "gen_meta" }
                                });
                                const promptData = (promptReq.content.find(b => b.type === 'tool_use') as any)?.input || {};
                                if (promptData.prompt) {
                                    const encodedPrompt = encodeURIComponent(promptData.prompt + " ultra realistic 8k photography, clean layout, highly detailed, real humans, DSLR, no text");
                                    const imgHtml = `<figure class="my-8"><img src="https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true" alt="${promptData.alt}" class="w-full rounded-xl shadow-lg border border-gray-200" /><figcaption class="text-center text-sm text-gray-500 mt-3 italic">${promptData.caption}</figcaption></figure>`;
                                    fullGeneratedHtml += `${imgHtml}\n`; 
                                    sendEvent({ id: `img-${i}`, type: 'image', content: imgHtml });
                                }
                            } catch (e) {}
                        }
                    }

                    // --- AUTOMATIC FAQ & CONCLUSION WITH CTA ---
                    sendEvent({ id: `h-faq`, type: 'h2', content: "Frequently Asked Questions" });
                    
                    const finalInternalLink = availableInternalLinks.length > 0 ? availableInternalLinks[0] : "#";
                    
                    const conclusionPrompt = `Write a Conclusion and FAQ section for the article. Language: ${config.language}. Tone: ${config.tone}.
                    1. Generate 3 highly relevant FAQ questions and answers using an HTML <dl> (description list) or <h3> structure.
                    2. Generate a 'Final Verdict / Conclusion' heading (<h2>).
                    3. Write a compelling summary paragraph.
                    4. END WITH A POWERFUL CALL TO ACTION (CTA): Explicitly invite the reader to try "${brandName}" (${brandDesc}). Create a stylish HTML CTA button or highlighted link pointing to this exact URL: ${finalInternalLink}.`;

                    let conclusionHtml = "";
                    try {
                        const conclusionRes = await anthropic.messages.create({
                            model: "claude-sonnet-4-6", max_tokens: 1500,
                            messages: [{ role: "user", content: conclusionPrompt }],
                            tools: [{ name: "gen_conclusion", input_schema: { type: "object", properties: { htmlContent: { type: "string" } }, required: ["htmlContent"] } }],
                            tool_choice: { type: "tool", name: "gen_conclusion" }
                        });
                        conclusionHtml = ((conclusionRes.content.find(b => b.type === 'tool_use') as any)?.input.htmlContent || "").replace(/```html|```/g, '').trim();
                        
                        fullGeneratedHtml += `\n${conclusionHtml}\n`;
                        sendEvent({ id: `p-faq`, type: 'paragraph', content: conclusionHtml });
                    } catch (e) {}

                    // --- SEO METADATA ---
                    let finalSeoMetadata = null;
                    try {
                        const seoRes = await anthropic.messages.create({
                            model: "claude-sonnet-4-6", max_tokens: 500,
                            system: `Generate Rank Math metadata. Language: ${config.language}.`,
                            messages: [{ role: "user", content: `Analyze:\n\n${fullGeneratedHtml.substring(0, 4000)}` }],
                            tools: [{ name: "set_seo", input_schema: { type: "object", properties: { focusKeyword: { type: "string" }, metaTitle: { type: "string" }, metaDescription: { type: "string" } }, required: ["focusKeyword", "metaTitle", "metaDescription"] } }],
                            tool_choice: { type: "tool", name: "set_seo" }
                        });
                        finalSeoMetadata = (seoRes.content.find(b => b.type === 'tool_use') as any)?.input;
                        sendEvent({ id: `seo-${Date.now()}`, type: 'seo_metadata', content: finalSeoMetadata });
                    } catch (e) {}

                    await prisma.contentJob.update({ where: { id: currentJobId! }, data: { status: "COMPLETED", outputContent: fullGeneratedHtml, seoMetadata: finalSeoMetadata || undefined } });
                    closeStream();
                } catch (e) {
                    if (currentJobId) await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
                    closeStream(); 
                }
            }
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } });
    } catch (error: any) {
        return new Response(JSON.stringify({ message: "Critical Error" }), { status: 500 });
    }
}