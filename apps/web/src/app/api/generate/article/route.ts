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

const generationPayloadSchema = z.object({
    outlineData: z.object({
        headings: z.array(z.object({
            id: z.string().optional(),
            text: z.string(),
            level: z.enum(['h2', 'h3'])
        })).min(1, "The outline must contain at least one valid heading."),
        selectedKeywords: z.array(z.string()).optional().default([]),
        sourceUrls: z.array(z.string()).optional().default([]), 
    }),
    config: z.object({
        language: z.string().optional().default("English (US)"),
        tone: z.string().optional().default("Highly Professional, Data-Driven, Authoritative"),
        depth: z.string().optional().default("Comprehensive"),
        engine: z.string().optional().default("claude-sonnet-4-6"),
        wpSitemap: z.string().optional().default(""),
        targetLength: z.string().optional().default("1000"), 
        enableBrandVoice: z.boolean().optional().default(false) 
    })
});

export async function POST(req: NextRequest) {
    let currentJobId: string | null = null;
    let areCreditsDeducted = false;
    const ARTICLE_COST = 5;
    let currentUserId = "";

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return new Response(JSON.stringify({ message: "Unauthorized access." }), { status: 401 });
        
        currentUserId = (session.user as any).id;
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`gen_article_${currentUserId}_${ip}`, 10, 60 * 60 * 1000);

        if (!limiter.success) return new Response(JSON.stringify({ message: "Generation quota reached." }), { status: 429 });

        const rawBody = await req.json();
        const parseResult = generationPayloadSchema.safeParse(rawBody);

        if (!parseResult.success) return new Response(JSON.stringify({ message: "Invalid payload." }), { status: 400 });

        const { outlineData, config } = parseResult.data;

        const activeTool = await prisma.tool.findFirst({ where: { isActive: true } });
        if (!activeTool) throw new Error("No active AI tools found.");

        const contentJob = await prisma.contentJob.create({
            data: {
                userId: currentUserId,
                toolId: activeTool.id,
                aiModel: "CLAUDE_3_5_SONNET", 
                status: "PROCESSING",
                inputPayload: rawBody,
            }
        });
        currentJobId = contentJob.id;

        await BillingGuard.checkCredits(currentUserId, ARTICLE_COST);
        await BillingGuard.deductCredits(currentUserId, ARTICLE_COST, "GENERATION");
        areCreditsDeducted = true;

        // Reserve ~250 words for the final FAQ and Conclusion section
        const totalHeadings = outlineData.headings.length;
        const targetTotalWords = parseInt(config.targetLength, 10) || 1000;
        const wordsPerSection = Math.max(80, Math.floor((targetTotalWords - 250) / totalHeadings));

        // --- BRAND INJECTION LOGIC (FIELDPIE SUPPORT) ---
        let brandContext = "";
        let brandName = "Our Company";
        let brandDesc = "an industry leading solution";

        if (config.enableBrandVoice) {
            try {
                const brandProfile = await prisma.brandProfile.findUnique({ where: { userId: currentUserId } });
                if (brandProfile) {
                    brandName = brandProfile.name;
                    brandDesc = brandProfile.description;
                    brandContext = `\n[MANDATORY BRAND DIRECTIVE]: 
You represent the brand: "${brandName}". Core offering: "${brandDesc}".
1. IF the heading implies a "Listicle" or "Comparison" (e.g., "Top Retail Execution Tools", "Best Software Compared"), YOU MUST FORCEFULLY INCLUDE "${brandName}" as the #1 recommended solution in that list. Do not omit it.
2. IF the heading is a general explanation, subtly weave "${brandName}" into the text as an objective industry standard solving the problem. Use <strong> tags for the brand name.`;
                }
            } catch (e) {}
        }

        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (data: any) => {
                    const chunk = `data: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(chunk));
                };
                const closeStream = () => {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                };

                try {
                    // --- LINK POOL INITIALIZATION ---
                    let availableInternalLinks: string[] = [];
                    if (config.wpSitemap) {
                        try {
                            const sitemapRes = await fetch(config.wpSitemap, { signal: AbortSignal.timeout(8000) });
                            if (sitemapRes.ok) {
                                const sitemapXml = await sitemapRes.text();
                                const matches = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1]);
                                const isTurkish = config.language.toLowerCase().includes('tr');
                                let filteredLinks = matches.filter(url => {
                                    if (isTurkish) return url.includes('/tr/') || url.includes('-tr/') || !url.match(/\/(en|de|fr|es)\//i);
                                    else return url.includes('/en/') || !url.match(/\/(tr|de|fr|es)\//i);
                                });
                                if (filteredLinks.length === 0) filteredLinks = matches;
                                availableInternalLinks = filteredLinks.sort(() => 0.5 - Math.random()).slice(0, 15);
                            }
                        } catch (e) {}
                    }
                    let availableExternalLinks = [...new Set(outlineData.sourceUrls || [])]; 
                    
                    let h2Counter = 0;
                    let fullGeneratedHtml = ""; 

                    // --- PRIMARY GENERATION LOOP ---
                    for (let i = 0; i < outlineData.headings.length; i++) {
                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetKeyword = outlineData.selectedKeywords.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        const targetWords = heading.level === 'h2' ? wordsPerSection + 50 : Math.max(60, wordsPerSection - 20);

                        // --- STRICT LINK ASSIGNMENT ---
                        let externalLinksContext = "Do NOT add any external links in this section.";
                        if (availableExternalLinks.length > 0 && i % 3 === 0) {
                            const linkToUse = availableExternalLinks.pop();
                            externalLinksContext = `EXTERNAL LINK RULE: You may organically insert this exact external link ONCE: <a href="${linkToUse}" target="_blank" rel="noopener noreferrer">${linkToUse}</a>. CRITICAL: Only use it as an academic/industry citation to back up a fact or statistic. NEVER use it as a "Click here for more" CTA.`;
                        }

                        let internalLinksContext = "Do NOT add any internal links in this section.";
                        if (availableInternalLinks.length > 0 && i % 2 !== 0) {
                            const linkToUse = availableInternalLinks.pop();
                            internalLinksContext = `INTERNAL LINK RULE: Naturally weave this internal URL <a href="${linkToUse}">into a relevant keyword</a> within the paragraph to guide the user deeper into our site. Do not make it look like a button.`;
                        }

                        // --- DYNAMIC FORMATTING PROMPT ---
                        const systemPrompt = `You are an elite Senior SEO Content Architect. Write the highly readable HTML content body for the EXACT heading provided.

[FORMATTING RULES - DO NOT BE ROBOTIC]:
1. DO NOT REWRITE THE HEADING. The user has provided the exact heading. You only generate the body content below it.
2. NATURAL FLOW: Do NOT force a bulleted list or a quote into every single section. Use standard paragraphs (max 2-3 sentences each) for general explanations.
3. USE RICH ELEMENTS STRATEGICALLY:
   - IF the heading implies a comparison (e.g., "Top Software", "Pros and Cons"), YOU MUST create an HTML <table>.
   - IF the heading implies steps or a checklist, use a <ul> or <ol>.
4. EMPHASIS: Bold (<strong>) important entities.
5. LANGUAGE: EXACTLY ${config.language}. Tone: ${config.tone}. Target Word Count: ~${targetWords} words.
6. ${externalLinksContext}
7. ${internalLinksContext}${brandContext}`;

                        const userMessage = `Write the highly readable HTML content body for the heading: "${heading.text}"\nTarget Keyword: "${targetKeyword}"`;
                        
                        let finalHeadingText = heading.text; 
                        let generatedText = "";

                        try {
                            if (config.engine.toLowerCase().includes("claude")) {
                                const anthropicResponse = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6",
                                    max_tokens: 4096,
                                    system: systemPrompt,
                                    messages: [{ role: "user", content: userMessage }],
                                    tools: [
                                        {
                                            name: "generate_html_body",
                                            description: "Generates the formatted HTML content for the section. Do NOT output the heading tag itself.",
                                            input_schema: {
                                                type: "object",
                                                properties: {
                                                    htmlContent: { type: "string", description: "The HTML content (paragraphs, lists, tables)." }
                                                },
                                                required: ["htmlContent"]
                                            }
                                        }
                                    ],
                                    tool_choice: { type: "tool", name: "generate_html_body" },
                                    temperature: 0.6,
                                });
                                
                                const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                                if (toolUseBlock) {
                                    const parsedData: any = typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input;
                                    generatedText = parsedData.htmlContent || "";
                                }
                            } else {
                                const textCompletion = await openai.chat.completions.create({
                                    model: "gpt-4o",
                                    response_format: { type: "json_object" },
                                    messages: [
                                        { role: "system", content: systemPrompt + `\n\nOutput ONLY a JSON object: { "htmlContent": "..." }` },
                                        { role: "user", content: userMessage }
                                    ],
                                    temperature: 0.6,
                                });
                                const parsedData = JSON.parse(textCompletion.choices[0].message.content || "{}");
                                generatedText = parsedData.htmlContent || "";
                            }
                        } catch (parseError) {
                            console.error("[PARSE_FAULT]", parseError);
                        }

                        generatedText = generatedText.replace(/```html|```/g, '').trim();
                        fullGeneratedHtml += `<${heading.level}>${finalHeadingText}</${heading.level}>\n${generatedText}\n`;

                        sendEvent({ id: `h-${i}-${Date.now()}`, type: heading.level, content: finalHeadingText });
                        sendEvent({ id: `p-${i}-${Date.now()}`, type: 'paragraph', content: generatedText });

                        // --- HIGH-QUALITY POLLINATIONS AI IMAGE ENGINE ---
                        if (heading.level === 'h2' && h2Counter > 0 && h2Counter % 3 === 0) {
                            try {
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", 
                                    max_tokens: 500,
                                    system: `Create an English visual prompt. Style: Ultra-realistic corporate photography, raw DSLR, cinematic lighting, real humans working in an office or retail store, highly detailed faces, NO text, NO labels.`,
                                    messages: [{ role: "user", content: `Create visual metadata for: "${finalHeadingText}". Focus on human interaction if possible.` }],
                                    tools: [{
                                        name: "generate_image_metadata",
                                        description: "Provides metadata for image generation.",
                                        input_schema: {
                                            type: "object",
                                            properties: { prompt: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } },
                                            required: ["prompt", "alt", "caption"]
                                        }
                                    }],
                                    tool_choice: { type: "tool", name: "generate_image_metadata" },
                                    temperature: 0.7,
                                });

                                const toolUseBlock = promptReq.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                                const promptData: any = toolUseBlock ? (typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input) : {};

                                if (promptData.prompt) {
                                    const encodedPrompt = encodeURIComponent(promptData.prompt + " ultra realistic 8k photography, clean layout, highly detailed, real humans, DSLR, no text");
                                    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`;

                                    const imgHtml = `
                                        <figure class="my-8">
                                            <img src="${imageUrl}" alt="${promptData.alt}" class="w-full rounded-xl shadow-lg border border-gray-200" />
                                            <figcaption class="text-center text-sm text-gray-500 mt-3 italic">${promptData.caption}</figcaption>
                                        </figure>
                                    `;
                                    fullGeneratedHtml += `${imgHtml}\n`; 
                                    sendEvent({ id: `img-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                }
                            } catch (e) { console.error("[IMAGE_FAULT]", e); }
                        }
                    }

                    // --- AUTOMATIC FAQ & CONCLUSION WITH CTA ---
                    sendEvent({ id: `h-faq-${Date.now()}`, type: 'h2', content: "Conclusion & Frequently Asked Questions" });
                    
                    const finalInternalLink = availableInternalLinks.length > 0 ? availableInternalLinks[0] : "#";
                    
                    const conclusionPrompt = `Write the final Conclusion and FAQ section for the article. Language: EXACTLY ${config.language}. Tone: ${config.tone}. Target Word Count: ~250 words.
                    1. Generate 3 highly relevant FAQ questions and answers using an HTML <dl> (description list) or <h3> structure.
                    2. Generate a 'Final Verdict / Conclusion' heading (<h2>).
                    3. Write a compelling summary paragraph.
                    4. END WITH A POWERFUL CALL TO ACTION (CTA): Explicitly invite the reader to try "${brandName}" (${brandDesc}). Create a stylish HTML CTA button or highlighted link pointing to this exact URL: ${finalInternalLink}.`;

                    let conclusionHtml = "";
                    try {
                        const conclusionRes = await anthropic.messages.create({
                            model: "claude-sonnet-4-6", max_tokens: 1500,
                            system: "You are an elite SEO Architect.",
                            messages: [{ role: "user", content: conclusionPrompt }],
                            tools: [{ name: "gen_conclusion", input_schema: { type: "object", properties: { htmlContent: { type: "string" } }, required: ["htmlContent"] } }],
                            tool_choice: { type: "tool", name: "gen_conclusion" },
                            temperature: 0.6
                        });
                        const toolUseBlock = conclusionRes.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                        const parsedData: any = toolUseBlock ? (typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input) : {};
                        conclusionHtml = (parsedData.htmlContent || "").replace(/```html|```/g, '').trim();
                        
                        fullGeneratedHtml += `\n<h2>Conclusion & Frequently Asked Questions</h2>\n${conclusionHtml}\n`;
                        sendEvent({ id: `p-faq-${Date.now()}`, type: 'paragraph', content: conclusionHtml });
                    } catch (e) {}

                    // --- SEO METADATA GENERATION ---
                    let finalSeoMetadata = null;
                    try {
                        const contentSample = fullGeneratedHtml.substring(0, 5000); 
                        const seoResponse = await anthropic.messages.create({
                            model: "claude-sonnet-4-6",
                            max_tokens: 500,
                            system: `Generate Rank Math metadata. Language: ${config.language}.`,
                            messages: [{ role: "user", content: `Analyze this content:\n\n${contentSample}` }],
                            tools: [{
                                name: "set_rank_math_metadata",
                                description: "Outputs strict Rank Math metadata.",
                                input_schema: {
                                    type: "object",
                                    properties: { focusKeyword: { type: "string" }, metaTitle: { type: "string" }, metaDescription: { type: "string" } },
                                    required: ["focusKeyword", "metaTitle", "metaDescription"]
                                }
                            }],
                            tool_choice: { type: "tool", name: "set_rank_math_metadata" },
                            temperature: 0.3,
                        });

                        const seoBlock = seoResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                        if (seoBlock) {
                            finalSeoMetadata = typeof seoBlock.input === 'string' ? JSON.parse(seoBlock.input) : seoBlock.input;
                            sendEvent({ id: `seo-${Date.now()}`, type: 'seo_metadata', content: finalSeoMetadata });
                        }
                    } catch (e) {}

                    await prisma.contentJob.update({
                        where: { id: currentJobId! },
                        data: { status: "COMPLETED", outputContent: fullGeneratedHtml, seoMetadata: finalSeoMetadata ? finalSeoMetadata : undefined }
                    });

                    closeStream();

                } catch (streamError) {
                    if (currentJobId) await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
                    closeStream(); 
                }
            }
        });

        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } });

    } catch (error: any) {
        if (areCreditsDeducted && currentJobId) {
            try {
                await prisma.transaction.create({ data: { userId: currentUserId, amount: ARTICLE_COST, type: "REFUND", description: "System Fault" } });
                await prisma.wallet.update({ where: { userId: currentUserId }, data: { creditsAvailable: { increment: ARTICLE_COST } } });
                await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
            } catch (e) {}
        }
        return new Response(JSON.stringify({ message: "A critical error occurred." }), { status: 500 });
    }
}