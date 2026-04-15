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
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return new Response(
                JSON.stringify({ message: "Unauthorized access. Please authenticate to proceed." }), 
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }

        currentUserId = (session.user as any).id;
        
        // 2. Rate Limiting Execution
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`gen_article_${currentUserId}_${ip}`, 10, 60 * 60 * 1000);

        if (!limiter.success) {
            return new Response(
                JSON.stringify({ message: "Generation quota reached. Please check back later." }), 
                { 
                    status: 429, 
                    headers: { 
                        'Content-Type': 'application/json',
                        ...getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset)
                    } 
                }
            );
        }

        // 3. Payload Validation
        const rawBody = await req.json();
        const parseResult = generationPayloadSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return new Response(
                JSON.stringify({ 
                    message: "Invalid payload provided.", 
                    errors: parseResult.error.format() 
                }), 
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const { outlineData, config } = parseResult.data;

        // 4. Persistence Init: Retrieve tool context and create a pending Job record
        const activeTool = await prisma.tool.findFirst({ where: { isActive: true } });
        if (!activeTool) {
            throw new Error("System Configuration Fault: No active AI tools found in the database.");
        }

        const contentJob = await prisma.contentJob.create({
            data: {
                userId: currentUserId,
                toolId: activeTool.id,
                aiModel: config.engine.toLowerCase().includes("claude") ? "claude-sonnet-4-6" : "GPT_4_OMNI",
                status: "PROCESSING",
                inputPayload: rawBody,
            }
        });
        currentJobId = contentJob.id;

        // 5. Atomic Billing: Deduct credits BEFORE initializing the heavy stream
        await BillingGuard.checkCredits(currentUserId, ARTICLE_COST);
        await BillingGuard.deductCredits(currentUserId, ARTICLE_COST, "GENERATION");
        areCreditsDeducted = true;

        // 6. Context Preparation
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
${brandProfile.sitemapUrl ? `- Internal Link Guide: ${brandProfile.sitemapUrl}` : ''}
CRITICAL: Maintain authoritative tone. Avoid cheap advertising language.`;
                }
            } catch (brandError) {
                console.warn("[BRAND_FETCH_WARNING]: Could not retrieve brand profile.", brandError);
            }
        }

        // 7. Stream Architecture Initialization
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
                    let internalLinks: string[] = [];
                    if (config.wpSitemap) {
                        try {
                            const sitemapRes = await fetch(config.wpSitemap, { signal: AbortSignal.timeout(5000) });
                            if (sitemapRes.ok) {
                                const sitemapXml = await sitemapRes.text();
                                const matches = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g));
                                internalLinks = matches.map(m => m[1]).filter(url => url.length > 10).slice(0, 20);
                            }
                        } catch (e) {
                            console.warn("[SEO_PIPELINE_WARNING] Sitemap fetch timed out.");
                        }
                    }

                    const sourceUrls = outlineData.sourceUrls;
                    const externalLinksContext = sourceUrls.length > 0 
                        ? `EXTERNAL LINK RULE: Organically insert ONE external link from: ${sourceUrls.join(', ')}.`
                        : `EXTERNAL LINK RULE: Do not add external links.`;

                    const internalLinksContext = internalLinks.length > 0
                        ? `INTERNAL LINK RULE: Organically insert ONE internal link from: ${internalLinks.join(', ')}. Use format: <a href="[URL]">[Anchor Text]</a>.`
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
                    let fullGeneratedHtml = ""; // HTML Accumulator for database persistence

                    // Primary Generation Loop
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

                        // Accumulate Core Text Content
                        fullGeneratedHtml += `<${heading.level}>${finalHeadingText}</${heading.level}>\n${generatedText}\n`;

                        // Dispatch Text Blocks to Client
                        sendEvent({
                            id: `h-${i}-${Date.now()}`,
                            type: heading.level,
                            content: finalHeadingText,
                        });

                        sendEvent({
                            id: `p-${i}-${Date.now()}`,
                            type: 'paragraph',
                            content: generatedText,
                        });

                        // Visual Asset Generation
                        if (heading.level === 'h2' && h2Counter % 2 === 0) {
                            try {
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", 
                                    max_tokens: 1000,
                                    system: `You are an expert art director. Create visual metadata for an image.
CRITICAL RULES:
1. The 'prompt' MUST be in English. SEO fields must be in ${config.language}.
2. Style: ULTRA-REALISTIC, DSLR photography, natural lighting. NO text.`,
                                    messages: [
                                        { role: "user", content: `Create visual metadata for section: "${finalHeadingText}".` }
                                    ],
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
                                let promptData: any = {};
                                
                                if (toolUseBlock) {
                                    promptData = typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input;
                                }

                                if (promptData.prompt) {
                                    const geminiApiKey = process.env.GEMINI_API_KEY;
                                    let b64Image = "";
                                    let imgHtml = "";

                                    if (geminiApiKey) {
                                        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${geminiApiKey}`;
                                        const geminiPayload = {
                                            contents: [{
                                                parts: [{ text: promptData.prompt + " Ultra-realistic, DSLR quality, raw photography, natural lighting, NO text" }]
                                            }]
                                        };

                                        const geminiRes = await fetch(geminiUrl, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(geminiPayload)
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
                                        imgHtml = `
                                            <figure class="my-8">
                                                <img src="data:image/jpeg;base64,${b64Image}" alt="${promptData.alt}" title="${promptData.title}" class="w-full rounded-xl shadow-lg border border-gray-200" />
                                                <figcaption class="text-center text-sm text-gray-500 mt-3 italic">${promptData.caption}</figcaption>
                                            </figure>
                                        `;
                                        fullGeneratedHtml += `${imgHtml}\n`; // Accumulate Image HTML
                                        sendEvent({ id: `img-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                    } else {
                                        imgHtml = `
                                            <div class="border-l-4 border-indigo-500 bg-indigo-50/50 p-4 my-6 rounded-r-lg">
                                                <span class="text-xs font-bold text-indigo-600 uppercase mb-2 block">Visual Asset Pending</span>
                                                <p class="text-gray-800 font-mono text-sm">${promptData.prompt}</p>
                                            </div>
                                        `;
                                        fullGeneratedHtml += `${imgHtml}\n`; // Accumulate Fallback HTML
                                        sendEvent({ id: `img-prompt-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                    }
                                }
                            } catch (promptError) {
                                console.error("[IMAGE_GENERATION_FAULT]:", promptError);
                            }
                        }
                    }

                    // 8. Commit Job Persistence (Success)
                    await prisma.contentJob.update({
                        where: { id: currentJobId! },
                        data: {
                            status: "COMPLETED",
                            outputContent: fullGeneratedHtml
                        }
                    });

                    closeStream();

                } catch (streamError) {
                    console.error("[STREAM_EXECUTION_FAULT]:", streamError);
                    
                    // Trigger Failure State internally
                    if (currentJobId) {
                        await prisma.contentJob.update({
                            where: { id: currentJobId },
                            data: { status: "FAILED" }
                        });
                    }
                    closeStream(); 
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error("[PIPELINE_CRITICAL_FAILURE]:", error);

        // 9. Trigger Atomic Rollback on Fatal Pipeline Error
        if (areCreditsDeducted && currentJobId) {
            console.log("[BILLING_ROLLBACK]: Refunding user due to critical fault.");
            try {
                // Direct DB manipulation used as fallback if BillingGuard lacks a native refund method
                await prisma.transaction.create({
                    data: {
                        userId: currentUserId,
                        amount: ARTICLE_COST,
                        type: "REFUND",
                        description: `System Fault Refund for Job: ${currentJobId}`
                    }
                });
                await prisma.wallet.update({
                    where: { userId: currentUserId },
                    data: { creditsAvailable: { increment: ARTICLE_COST } }
                });
                
                await prisma.contentJob.update({
                    where: { id: currentJobId },
                    data: { status: "FAILED" }
                });
            } catch (rollbackError) {
                console.error("[CRITICAL_ROLLBACK_FAILURE]: Manual intervention required.", rollbackError);
            }
        }

        return new Response(
            JSON.stringify({ message: error.message || "A critical error occurred during initialization." }), 
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}