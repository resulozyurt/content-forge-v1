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

// Initialize AI SDK clients. Priority: Anthropic (Claude)
const openai = new OpenAI();
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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
        if (!session?.user?.id) {
            return new Response(
                JSON.stringify({ message: "Unauthorized access. Please authenticate to proceed." }), 
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }

        currentUserId = (session.user as any).id;
        
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`gen_article_${currentUserId}_${ip}`, 10, 60 * 60 * 1000);

        if (!limiter.success) {
            return new Response(
                JSON.stringify({ message: "Generation quota reached. Please check back later." }), 
                { status: 429, headers: { 'Content-Type': 'application/json', ...getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) } }
            );
        }

        const rawBody = await req.json();
        const parseResult = generationPayloadSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return new Response(
                JSON.stringify({ message: "Invalid payload provided.", errors: parseResult.error.format() }), 
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const { outlineData, config } = parseResult.data;

        const activeTool = await prisma.tool.findFirst({ where: { isActive: true } });
        if (!activeTool) throw new Error("System Configuration Fault: No active AI tools found in the database.");

        const contentJob = await prisma.contentJob.create({
            data: {
                userId: currentUserId,
                toolId: activeTool.id,
                aiModel: config.engine.toLowerCase().includes("claude") ? "CLAUDE_3_5_SONNET" : "GPT_4_OMNI",
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
        const wordsPerSection = Math.max(150, Math.floor(targetTotalWords / totalHeadings));

        let brandContext = "";
        let brandNameContext = "";
        
        if (config.enableBrandVoice) {
            try {
                const brandProfile = await prisma.brandProfile.findUnique({ where: { userId: currentUserId } });
                if (brandProfile) {
                    brandNameContext = brandProfile.name;
                    brandContext = `\nBRAND IDENTITY INJECTION RULE:
You MUST organically weave the following brand into the content.
- Brand Name: ${brandProfile.name}
- Core Offerings: ${brandProfile.description}
CRITICAL: Maintain authoritative tone. Avoid cheap advertising language.`;
                }
            } catch (brandError) {
                console.warn("[BRAND_FETCH_WARNING]: Could not retrieve brand profile.", brandError);
            }
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
                    // --- PHASE 3: ADVANCED RAG LINKER & SITEMAP INTEGRATION ---
                    let internalLinks: string[] = [];
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

                                // Shuffle and limit to 15 to provide dynamic variety across generations
                                internalLinks = filteredLinks.sort(() => 0.5 - Math.random()).slice(0, 15);
                            }
                        } catch (e) {
                            console.warn("[SEO_PIPELINE_WARNING] Sitemap fetch timed out.");
                        }
                    }

                    const externalLinksContext = outlineData.sourceUrls.length > 0 
                        ? `EXTERNAL LINK RULE: To build authority, you MAY insert MAX ONE external link from: [${outlineData.sourceUrls.join(', ')}]. ONLY use it if it contextually strengthens the factual claim. Format: <a href="[URL]" target="_blank" rel="noopener noreferrer">[Anchor Text]</a>.`
                        : `EXTERNAL LINK RULE: Do not add external links.`;

                    const internalLinksContext = internalLinks.length > 0
                        ? `INTERNAL LINK RULE: You have access to these internal URLs: [${internalLinks.join(', ')}]. You MAY organically insert MAX ONE internal link IF it perfectly matches the paragraph's context. Do NOT force it. Format: <a href="[URL]">[Anchor Text]</a>.`
                        : `INTERNAL LINK RULE: Skip internal linking.`;

                    const systemPrompt = `You are an elite Senior SEO Engineer and NLP Content Strategist. 
Task: Write a high-density, expert-level section for the heading provided.

STRICT RULES:
1. NO FLUFF: Deliver pure, factual, analytical value immediately.
2. LANGUAGE: EXACTLY ${config.language}.
3. TONE: ${config.tone}.
4. DEPTH: ${config.depth}.
5. LENGTH TARGET: ~${wordsPerSection} words. NEVER truncate.
6. ${externalLinksContext}
7. ${internalLinksContext}${brandContext}`;

                    let h2Counter = 0;
                    let fullGeneratedHtml = ""; 

                    for (let i = 0; i < outlineData.headings.length; i++) {
                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetKeyword = outlineData.selectedKeywords.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        const userMessage = `Original Heading: "${heading.text}"\nTarget NLP Keyword: "${targetKeyword}"`;
                        
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
                                            name: "generate_section",
                                            description: "Generates semantic HTML content and a refined heading.",
                                            input_schema: {
                                                type: "object",
                                                properties: {
                                                    rewrittenHeading: { type: "string" },
                                                    htmlContent: { type: "string" }
                                                },
                                                required: ["rewrittenHeading", "htmlContent"]
                                            }
                                        }
                                    ],
                                    tool_choice: { type: "tool", name: "generate_section" },
                                    temperature: 0.6,
                                });
                                
                                const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                                if (toolUseBlock) {
                                    const parsedData: any = typeof toolUseBlock.input === 'string' 
                                        ? JSON.parse(toolUseBlock.input) 
                                        : toolUseBlock.input;
                                        
                                    finalHeadingText = parsedData.rewrittenHeading || heading.text;
                                    generatedText = parsedData.htmlContent || "";
                                }
                            } else {
                                const textCompletion = await openai.chat.completions.create({
                                    model: "gpt-4o",
                                    response_format: { type: "json_object" },
                                    messages: [
                                        { role: "system", content: systemPrompt + `\n\nOutput ONLY a JSON object: { "rewrittenHeading": "...", "htmlContent": "..." }` },
                                        { role: "user", content: userMessage }
                                    ],
                                    temperature: 0.6,
                                });
                                const rawContent = textCompletion.choices[0].message.content || "{}";
                                const parsedData = JSON.parse(rawContent);
                                finalHeadingText = parsedData.rewrittenHeading || heading.text;
                                generatedText = parsedData.htmlContent || "";
                            }
                        } catch (parseError) {
                            console.error("[PARSE_FAULT] Pipeline execution failed.", parseError);
                            generatedText = "<p>Content pipeline encountered a formatting fault.</p>";
                        }

                        generatedText = generatedText.replace(/```html|```/g, '').trim();
                        fullGeneratedHtml += `<${heading.level}>${finalHeadingText}</${heading.level}>\n${generatedText}\n`;

                        sendEvent({ id: `h-${i}-${Date.now()}`, type: heading.level, content: finalHeadingText });
                        sendEvent({ id: `p-${i}-${Date.now()}`, type: 'paragraph', content: generatedText });

                        if (heading.level === 'h2' && h2Counter > 0 && h2Counter % 3 === 0) {
                            try {
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", 
                                    max_tokens: 1000,
                                    system: `You are an expert art director. Create visual metadata for an image.
CRITICAL RULES:
1. The 'prompt' MUST be in English. SEO fields must be in ${config.language}.
2. Style: ULTRA-REALISTIC, DSLR photography, natural lighting. NO text.`,
                                    messages: [{ role: "user", content: `Create visual metadata for section: "${finalHeadingText}".` }],
                                    tools: [
                                        {
                                            name: "generate_image_metadata",
                                            description: "Provides metadata for image generation.",
                                            input_schema: {
                                                type: "object",
                                                properties: {
                                                    prompt: { type: "string" },
                                                    alt: { type: "string" },
                                                    title: { type: "string" },
                                                    caption: { type: "string" }
                                                },
                                                required: ["prompt", "alt", "title", "caption"]
                                            }
                                        }
                                    ],
                                    tool_choice: { type: "tool", name: "generate_image_metadata" },
                                    temperature: 0.7,
                                });

                                const toolUseBlock = promptReq.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                                const promptData: any = toolUseBlock ? (typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input) : {};

                                if (promptData.prompt) {
                                    const geminiApiKey = process.env.GEMINI_API_KEY;
                                    let b64Image = "";
                                    let imgHtml = "";

                                    if (geminiApiKey) {
                                        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${geminiApiKey}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ contents: [{ parts: [{ text: promptData.prompt + " Ultra-realistic, DSLR quality, raw photography, natural lighting, NO text" }] }] })
                                        });

                                        if (geminiRes.ok) {
                                            const geminiData = await geminiRes.json();
                                            const parts = geminiData.candidates?.[0]?.content?.parts || [];
                                            for (const part of parts) {
                                                if (part.inlineData && part.inlineData.data) {
                                                    b64Image = part.inlineData.data;
                                                    break;
                                                }
                                            }
                                        }
                                    }

                                    if (b64Image) {
                                        imgHtml = `<figure class="my-8"><img src="data:image/jpeg;base64,${b64Image}" alt="${promptData.alt}" title="${promptData.title}" class="w-full rounded-xl shadow-lg border border-gray-200" /><figcaption class="text-center text-sm text-gray-500 mt-3 italic">${promptData.caption}</figcaption></figure>`;
                                    } else {
                                        imgHtml = `<div class="border-l-4 border-indigo-500 bg-indigo-50/50 p-4 my-6 rounded-r-lg"><span class="text-xs font-bold text-indigo-600 uppercase mb-2 block">Visual Asset Pending</span><p class="text-gray-800 font-mono text-sm">${promptData.prompt}</p></div>`;
                                    }
                                    fullGeneratedHtml += `${imgHtml}\n`; 
                                    sendEvent({ id: `img-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                }
                            } catch (promptError) {
                                console.error("[IMAGE_GENERATION_FAULT]:", promptError);
                            }
                        }
                    }

                    let finalSeoMetadata = null;
                    try {
                        const seoSystemPrompt = `You are a Senior Technical SEO Architect.
Task: Generate Rank Math compatible metadata for the generated article.
RULES:
1. Language MUST be exactly: ${config.language}.
2. Provide a 'focusKeyword' that represents the main topic perfectly.
3. Provide a 'metaTitle' (max 60 characters, highly clickable).
4. Provide a 'metaDescription' (max 160 characters, strong CTA).`;

                        const contentSample = fullGeneratedHtml.substring(0, 5000); 

                        const seoResponse = await anthropic.messages.create({
                            model: "claude-sonnet-4-6",
                            max_tokens: 500,
                            system: seoSystemPrompt,
                            messages: [{ role: "user", content: `Analyze this content and generate SEO JSON:\n\n${contentSample}` }],
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
                    } catch (seoError) {
                        console.error("[SEO_METADATA_GENERATION_FAULT]:", seoError);
                    }

                    await prisma.contentJob.update({
                        where: { id: currentJobId! },
                        data: {
                            status: "COMPLETED",
                            outputContent: fullGeneratedHtml,
                            seoMetadata: finalSeoMetadata ? finalSeoMetadata : undefined
                        }
                    });

                    closeStream();

                } catch (streamError) {
                    console.error("[STREAM_EXECUTION_FAULT]:", streamError);
                    if (currentJobId) await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
                    closeStream(); 
                }
            }
        });

        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } });

    } catch (error: any) {
        if (areCreditsDeducted && currentJobId) {
            try {
                await prisma.transaction.create({ data: { userId: currentUserId, amount: ARTICLE_COST, type: "REFUND", description: `System Fault Refund for Job: ${currentJobId}` } });
                await prisma.wallet.update({ where: { userId: currentUserId }, data: { creditsAvailable: { increment: ARTICLE_COST } } });
                await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
            } catch (rollbackError) {}
        }
        return new Response(JSON.stringify({ message: error.message || "A critical error occurred." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}