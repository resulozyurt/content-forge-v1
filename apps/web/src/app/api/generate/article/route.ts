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
        contentType: z.string().optional().default("blog_post"),
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

        let activeTool = await prisma.tool.findFirst({ where: { isActive: true } });
        
        if (!activeTool) {
            console.warn("[DB_WARNING]: No active tools found in DB. Auto-seeding default 'Article Generator'.");
            activeTool = await prisma.tool.create({
                data: {
                    name: "Article Generator",
                    slug: "article-generator",
                    description: "Default AI Content Generation Tool",
                    price: 5,
                    isActive: true
                }
            });
        }

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

        const totalHeadings = outlineData.headings.length;
        const targetTotalWords = parseInt(config.targetLength, 10) || 1000;
        const wordsPerSection = Math.max(80, Math.floor((targetTotalWords - 250) / totalHeadings));

        // --- HARD DIRECTIVE BRAND ADVOCACY ENGINE ---
        let brandContext = "";
        let brandName = "Our Company";

        if (config.enableBrandVoice) {
            try {
                const brandProfile = await prisma.brandProfile.findUnique({ where: { userId: currentUserId } });
                if (brandProfile) {
                    brandName = brandProfile.name;
                    brandContext = `\n[MANDATORY BRAND ADVOCACY]: You are an elite brand advocate for "${brandName}". Core Offering: "${brandProfile.description}". 
CRITICAL RULES:
1. YOU MUST seamlessly and organically weave "${brandName}" into this section as the ultimate solution or standard of excellence.
2. ALWAYS use <strong> tags for the brand name (e.g., <strong>${brandName}</strong>).
3. If making comparisons, aggressively but professionally highlight the flaws of alternatives while positioning "${brandName}" as the #1 choice.`;
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
                    // --- SEMANTIC LINK POOL INITIALIZATION ---
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
                                availableInternalLinks = filteredLinks.sort(() => 0.5 - Math.random());
                            }
                        } catch (e) {
                            console.error("[SITEMAP_FETCH_FAULT]:", e);
                        }
                    }
                    let availableExternalLinks = [...new Set(outlineData.sourceUrls || [])].sort(() => 0.5 - Math.random()); 
                    
                    let h2Counter = 0;
                    let fullGeneratedHtml = ""; 

                    // --- PRIMARY GENERATION LOOP ---
                    for (let i = 0; i < outlineData.headings.length; i++) {
                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetWords = heading.level === 'h2' ? wordsPerSection + 50 : Math.max(60, wordsPerSection - 20);
                        
                        // Define targetKeyword specifically for this loop iteration
                        const targetKeyword = outlineData.selectedKeywords.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        // --- HARD-LINK INJECTION ALGORITHM ---
                        let linkStrategyContext = "\n[MANDATORY LINK INJECTION RULES]:\n";
                        let linkInjected = false;

                        const contextualInternalLinks = availableInternalLinks.slice(i * 2, (i * 2) + 2); 
                        if (contextualInternalLinks.length > 0) {
                            linkStrategyContext += `- INTERNAL LINK: You MUST integrate this URL: "${contextualInternalLinks[0]}". Find the MOST semantically relevant phrase in your generated text and wrap it strictly as: <a href="${contextualInternalLinks[0]}">relevant phrase here</a>.\n`;
                            linkInjected = true;
                        }

                        if (availableExternalLinks.length > 0 && i % 3 === 0) { 
                            const externalLink = availableExternalLinks.pop();
                            linkStrategyContext += `- EXTERNAL CITATION: You MUST integrate this reference URL: "${externalLink}". Anchor text must be a relevant factual statement or statistic formatted as: <a href="${externalLink}" target="_blank" rel="noopener noreferrer">relevant concept</a>.\n`;
                            linkInjected = true;
                        }

                        if (!linkInjected) {
                            linkStrategyContext = ""; // Clean up if no links available
                        }

                        // --- CONTENT ARCHETYPES (DINAMIK IÇERIK MOTORU) ---
                        const archetypePrompts: Record<string, string> = {
                            'blog_post': "Format this strictly as a highly engaging, scannable Blog Post. Maintain a conversational yet authoritative rhythm.",
                            'pillar_page': "Format this as an encyclopedic Pillar Page section. Dive deep into the sub-topic. Provide dense, fact-rich value.",
                            'guide': "Format this as a step-by-step Ultimate Guide. MANDATORY: You must include an actionable checklist or a numbered list (<ol>) in this section.",
                            'product_review': "Format this as a Product Review section. MANDATORY: If this heading implies comparison or features, you MUST include an HTML <table> comparing pros/cons or specs.",
                            'service_page': "Format this as a high-converting Service Page. Keep paragraphs extremely short. Focus exclusively on pain points, benefits, and direct solutions. Drive urgency."
                        };
                        const selectedArchetype = archetypePrompts[config.contentType] || archetypePrompts['blog_post'];

                        // --- ANTI-AI JARGON & READABILITY ---
                        const negativePrompt = `\n[NEGATIVE CONSTRAINTS - STRICTLY PROHIBITED]:
- DO NOT use cliché AI transition words: "In conclusion", "Moreover", "Furthermore", "Delve into", "A testament to", "In the ever-evolving landscape", "Navigating the complexities", "Let's explore".
- NO WALL OF TEXT: A single paragraph MUST NOT exceed 3 sentences. Break them up.`;

                        // MERGED SYSTEM PROMPT (Combines Phase 3 Rich Formatting with Phase 4 Archetypes)
                        const systemPrompt = `You are an elite Senior SEO Content Architect. Write the highly readable HTML content body for the EXACT heading provided.

[CONTENT TYPE DIRECTIVE]:
${selectedArchetype}

[MANDATORY RICH ELEMENTS & FORMATTING RULES]:
1. DO NOT REWRITE THE HEADING ITSELF. Only generate the body content below it.
2. DYNAMIC STRUCTURE (CRITICAL): Analyze the heading. 
   - IF the heading implies a comparison, vs, pros/cons, or pricing, YOU MUST output a styled HTML <table>.
   - IF the heading implies a process, steps, checklist, or multiple features, YOU MUST output an HTML <ul> or <ol>.
   - IF stating a crucial industry fact or quote, wrap it in a <blockquote>.
3. EMPHASIS: Bold (<strong>) important entities, metrics, and core concepts to aid scanning.
4. LANGUAGE: EXACTLY ${config.language}. Tone: ${config.tone}. Target Word Count: ~${targetWords} words.

${negativePrompt}
${linkStrategyContext}
${brandContext}`;

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
                                                    htmlContent: { type: "string", description: "The HTML content (paragraphs, lists, tables, blockquotes)." }
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

                        // --- PHASE 4: HIGH-FIDELITY IMAGE ENGINE (DALL-E 3) ---
                        if (heading.level === 'h2' && h2Counter > 0 && h2Counter % 2 === 0) {
                            try {
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", 
                                    max_tokens: 300,
                                    system: `You are an elite AI Image Prompt Engineer. Write a highly descriptive prompt for a photorealistic, ultra-high-definition corporate image based on the heading. NO TEXT IN IMAGE. Style: DSLR, raw photography, cinematic lighting, diverse real humans in professional settings. Limit: 800 characters.`,
                                    messages: [{ role: "user", content: `Create visual prompt for heading: "${finalHeadingText}"` }]
                                });

                                const textBlock = promptReq.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
                                const optimizedPrompt = textBlock?.text || `Photorealistic corporate photography representing ${finalHeadingText}, diverse real humans, ultra high definition, DSLR, cinematic lighting, no text`;

                                const imageResponse = await openai.images.generate({
                                    model: "dall-e-3",
                                    prompt: optimizedPrompt.substring(0, 900),
                                    n: 1,
                                    size: "1024x1024",
                                    quality: "hd",
                                    style: "natural" 
                                });

                                const imageUrl = imageResponse.data?.[0]?.url;

                                if (imageUrl) {
                                    const imgHtml = `
                                        <figure class="my-10">
                                            <img src="${imageUrl}" alt="${finalHeadingText}" class="w-full rounded-2xl shadow-xl border border-gray-200 object-cover" />
                                            <figcaption class="text-center text-sm text-gray-500 mt-3 italic">${finalHeadingText}</figcaption>
                                        </figure>
                                    `;
                                    fullGeneratedHtml += `${imgHtml}\n`; 
                                    sendEvent({ id: `img-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                }
                            } catch (e) { console.error("[IMAGE_ENGINE_FAULT]", e); }
                        }
                    }

                    // --- AUTOMATIC FAQ & CONCLUSION WITH CTA ---
                    sendEvent({ id: `h-faq-${Date.now()}`, type: 'h2', content: "Conclusion & Frequently Asked Questions" });
                    
                    const finalInternalLink = availableInternalLinks.length > 0 ? availableInternalLinks[0] : "#";
                    
                    const conclusionPrompt = `Write the final Conclusion and FAQ section for the article. Language: EXACTLY ${config.language}. Tone: ${config.tone}. Target Word Count: ~300 words.
                    1. Generate a 'Final Verdict' heading (<h2>) summarizing the core value.
                    2. CTA BLOCK: Explicitly invite the reader to try "${brandName}". Create a stylish HTML blockquote or highly visible paragraph directing them to this exact URL: ${finalInternalLink}.
                    3. FAQ SECTION: Generate 3 highly relevant FAQ questions. Use <h3> for the question and a standard paragraph for the answer. Keep answers punchy.`;

                    let conclusionHtml = "";
                    try {
                        const conclusionRes = await anthropic.messages.create({
                            model: "claude-sonnet-4-6", max_tokens: 1500,
                            system: "You are an elite SEO Architect.",
                            messages: [{ role: "user", content: conclusionPrompt }],
                            tools: [{ 
                                name: "gen_conclusion", 
                                description: "Generates the final Conclusion and FAQ HTML section for the article.",
                                input_schema: { 
                                    type: "object", 
                                    properties: { 
                                        htmlContent: { 
                                            type: "string",
                                            description: "The formatted HTML content containing the final verdict, CTA, and FAQs."
                                        } 
                                    }, 
                                    required: ["htmlContent"] 
                                } 
                            }],
                            tool_choice: { type: "tool", name: "gen_conclusion" },
                            temperature: 0.6
                        });
                        const toolUseBlock = conclusionRes.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                        const parsedData: any = toolUseBlock ? (typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input) : {};
                        conclusionHtml = (parsedData.htmlContent || "").replace(/```html|```/g, '').trim();
                        
                        fullGeneratedHtml += `\n${conclusionHtml}\n`;
                        sendEvent({ id: `p-faq-${Date.now()}`, type: 'paragraph', content: conclusionHtml });
                    } catch (e) {
                        console.error("[CONCLUSION_GEN_FAULT]:", e);
                    }

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
                    console.error("[STREAM_FAULT]:", streamError);
                    if (currentJobId) await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
                    closeStream(); 
                }
            }
        });

        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } });

    } catch (error: any) {
        console.error("[API_ROUTE_FAULT]:", error);
        if (areCreditsDeducted && currentJobId) {
            try {
                await prisma.transaction.create({ data: { userId: currentUserId, amount: ARTICLE_COST, type: "REFUND", description: "System Fault" } });
                await prisma.wallet.update({ where: { userId: currentUserId }, data: { creditsAvailable: { increment: ARTICLE_COST } } });
                await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
            } catch (e) {
                console.error("[REFUND_FAULT]:", e);
            }
        }
        return new Response(JSON.stringify({ message: "A critical error occurred." }), { status: 500 });
    }
}