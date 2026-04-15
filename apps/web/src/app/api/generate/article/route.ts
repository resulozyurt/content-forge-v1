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

// Initialize AI SDK clients. Anthropic is prioritized as the primary cognitive engine.
const openai = new OpenAI();
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

// Extend the maximum execution duration for serverless environments (Vercel/Railway)
export const maxDuration = 300;

// Define a rigorous input validation schema to prevent malformed requests and injection attacks
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
        engine: z.string().optional().default("claude-3-5-sonnet-latest"),
        wpSitemap: z.string().optional().default(""),
        targetLength: z.string().optional().default("1000"), 
        enableBrandVoice: z.boolean().optional().default(false) 
    })
});

export async function POST(req: NextRequest) {
    try {
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return new Response(
                JSON.stringify({ message: "Unauthorized access. Please authenticate to proceed." }), 
                { status: 401, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const userId = (session.user as any).id;
        
        // 2. Rate Limiting: 10 full article generations per hour per user
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`gen_article_${userId}_${ip}`, 10, 60 * 60 * 1000);

        if (!limiter.success) {
            return new Response(
                JSON.stringify({ message: "Generation quota reached. Please check back in an hour." }), 
                { 
                    status: 429, 
                    headers: { 
                        'Content-Type': 'application/json',
                        ...getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset)
                    } 
                }
            );
        }

        const ARTICLE_COST = 5;

        // 3. Billing Guard: Verify available credits prior to initialization
        await BillingGuard.checkCredits(userId, ARTICLE_COST);

        // 4. Input Validation via Zod Schema
        const rawBody = await req.json();
        const parseResult = generationPayloadSchema.safeParse(rawBody);

        if (!parseResult.success) {
            return new Response(
                JSON.stringify({ 
                    message: "Invalid payload provided. Please verify the request formatting.", 
                    errors: parseResult.error.format() 
                }), 
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const { outlineData, config } = parseResult.data;

        // 5. Capture UI Configurations
        const language = config.language;
        const tone = config.tone;
        const depth = config.depth;
        const engine = config.engine;
        const wpSitemap = config.wpSitemap;
        const totalHeadings = outlineData.headings.length;

        // Calculate dynamic word count per section to prevent LLM truncation
        const targetTotalWords = parseInt(config.targetLength, 10) || 1000;
        const wordsPerSection = Math.max(150, Math.floor(targetTotalWords / totalHeadings));

        // 6. Fetch Brand Identity Context
        let brandContext = "";
        let brandNameContext = "";
        if (config.enableBrandVoice) {
            try {
                const brandProfile = await prisma.brandProfile.findUnique({ where: { userId } });
                if (brandProfile) {
                    brandNameContext = brandProfile.name;
                    brandContext = `\nBRAND IDENTITY INJECTION RULE:
You MUST organically weave the following brand into the content as an authoritative solution, where contextually relevant.
- Brand Name: ${brandProfile.name}
- Core Offerings & Tone: ${brandProfile.description}
${brandProfile.sitemapUrl ? `- Brand Sitemap/Links: Use this to guide internal linking: ${brandProfile.sitemapUrl}` : ''}
CRITICAL: Do not make it sound like a cheap advertisement. Weave it naturally into the narrative as a premier industry solution.`;
                }
            } catch (brandError) {
                console.warn("[BRAND_FETCH_WARNING]: Could not retrieve brand profile.", brandError);
            }
        }

        // 7. Initialize Server-Sent Events (SSE) Stream Architecture
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
                    // Dynamic Internal Link Pool Configuration
                    let internalLinks: string[] = [];
                    if (wpSitemap) {
                        try {
                            const sitemapRes = await fetch(wpSitemap, { signal: AbortSignal.timeout(5000) });
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
                        ? `EXTERNAL LINK RULE: You MUST organically insert ONE external link using EXACTLY one of these verified URLs: ${sourceUrls.join(', ')}. NEVER hallucinate or invent URLs.`
                        : `EXTERNAL LINK RULE: Do not add any external links as no verified sources were provided.`;

                    const internalLinksContext = internalLinks.length > 0
                        ? `INTERNAL LINK RULE: You MUST organically insert ONE internal link using a relevant URL from this list: ${internalLinks.join(', ')}. Format: <a href="[URL]" class="text-blue-600 hover:underline">[Anchor Text]</a>.`
                        : `INTERNAL LINK RULE: Skip internal linking altogether as no valid sitemap URLs were detected.`;

                    // Core SEO & NLP System Prompt tailored for Claude's analytical strengths
                    const systemPrompt = `You are an elite Senior SEO Engineer and NLP Content Strategist. 
Task: Write a high-density, expert-level section for the heading provided.

STRICT RULES:
1. NO FLUFF: Avoid generic introductions. Deliver pure, factual, and analytical value immediately.
2. LANGUAGE: EXACTLY ${language}. If English, utilize Native American English phrasing exclusively.
3. TONE: ${tone}.
4. DEPTH: ${depth}.
5. LENGTH TARGET: Write approximately ${wordsPerSection} words for this section. Ensure the narrative is complete and NEVER truncated.
6. ${externalLinksContext}
7. ${internalLinksContext}${brandContext}`;

                    let h2Counter = 0;

                    // Primary Generation Loop
                    for (let i = 0; i < outlineData.headings.length; i++) {
                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetKeyword = outlineData.selectedKeywords.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        const userMessage = `Original Heading: "${heading.text}"\nTarget NLP Keyword to seamlessly incorporate: "${targetKeyword}"`;
                        
                        let finalHeadingText = heading.text;
                        let generatedText = "";

                        // A. Dynamic Engine Routing (Prioritizing Claude Tool Use)
                        try {
                            if (engine.toLowerCase().includes("claude")) {
                                const anthropicResponse = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6",
                                    max_tokens: 4096,
                                    system: systemPrompt,
                                    messages: [{ role: "user", content: userMessage }],
                                    tools: [
                                        {
                                            name: "generate_section",
                                            description: "Generates the semantic HTML content and refined heading.",
                                            input_schema: {
                                                type: "object",
                                                properties: {
                                                    rewrittenHeading: { type: "string", description: "A highly engaging, unique, and SEO-optimized variation of the heading." },
                                                    htmlContent: { type: "string", description: "The raw HTML content (<p>, <ul>, <strong>) for this section. No markdown backticks." }
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
                                    let parsedData: any = {};
                                    if (typeof toolUseBlock.input === 'string') {
                                        parsedData = JSON.parse(toolUseBlock.input);
                                    } else {
                                        parsedData = toolUseBlock.input;
                                    }
                                    finalHeadingText = parsedData.rewrittenHeading || heading.text;
                                    generatedText = parsedData.htmlContent || "";
                                }
                            } else {
                                // Fallback to OpenAI if explicitly requested by the user
                                const textCompletion = await openai.chat.completions.create({
                                    model: "gpt-4o",
                                    response_format: { type: "json_object" },
                                    messages: [
                                        { role: "system", content: systemPrompt + `\n\nOutput ONLY a JSON object matching: { "rewrittenHeading": "...", "htmlContent": "..." }` },
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
                            console.error("[PARSE_FAULT] Failed to execute generation pipeline.", parseError);
                            generatedText = "<p>The content pipeline encountered a formatting fault during execution.</p>";
                        }

                        generatedText = generatedText.replace(/```html|```/g, '').trim();

                        // B. Dispatch Content Blocks to the Client
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

                        // C. Visual Asset Generation (Migrated to Claude Tool-Use + Gemini Flash)
                        if (heading.level === 'h2' && h2Counter % 2 === 0) {
                            try {
                                // Step 1: Generate Visual Metadata via Claude
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", 
                                    max_tokens: 1000,
                                    system: `You are an expert art director and SEO specialist. 
TASK: Create a highly detailed image generation prompt and SEO metadata.

CRITICAL RULES:
1. The 'prompt' MUST be in English. The SEO fields must be in ${language}.
2. Style: ULTRA-REALISTIC, DSLR photography, 35mm lens, natural lighting. NO text in images.
${brandNameContext ? `3. Subtly align the aesthetic with the brand: ${brandNameContext}.` : ''}`,
                                    messages: [
                                        { role: "user", content: `Create visual metadata for an article section titled: "${finalHeadingText}".` }
                                    ],
                                    tools: [
                                        {
                                            name: "generate_image_metadata",
                                            description: "Provides structured metadata for image generation.",
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
                                    // Step 2: Fetch Base64 Image from Gemini API
                                    const geminiApiKey = process.env.GEMINI_API_KEY;
                                    let b64Image = "";

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
                                        } else {
                                            console.error("[GEMINI_API_ERROR]: Failed to fetch image.", await geminiRes.text());
                                        }
                                    } else {
                                        console.warn("[GEMINI_MISSING_KEY]: GEMINI_API_KEY not found in environment variables.");
                                    }

                                    // Step 3: Dispatch Image HTML or Fallback
                                    if (b64Image) {
                                        const imgHtml = `
                                            <figure class="my-8">
                                                <img src="data:image/jpeg;base64,${b64Image}" alt="${promptData.alt}" title="${promptData.title}" class="w-full rounded-xl shadow-lg border border-gray-200 dark:border-gray-800" />
                                                <figcaption class="text-center text-sm text-gray-500 mt-3 italic">${promptData.caption}</figcaption>
                                            </figure>
                                        `;
                                        sendEvent({ id: `img-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                    } else {
                                        const fallbackHtml = `
                                            <div class="ai-prompt-container border-l-4 border-indigo-500 bg-indigo-50/50 p-4 my-6 rounded-r-lg">
                                                <span class="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2 block">Visual Asset Pending (API Error)</span>
                                                <p class="text-gray-800 font-mono text-sm leading-relaxed">${promptData.prompt}</p>
                                            </div>
                                        `;
                                        sendEvent({ id: `img-prompt-${i}-${Date.now()}`, type: 'image', content: fallbackHtml });
                                    }
                                }
                            } catch (promptError) {
                                console.error("[IMAGE_GENERATION_FAULT]:", promptError);
                            }
                        }
                    }

                    // 11. Finalize Transaction
                    await BillingGuard.deductCredits(userId, ARTICLE_COST, "GENERATION");
                    closeStream();

                } catch (streamError) {
                    console.error("[STREAM_EXECUTION_FAULT]:", streamError);
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
        return new Response(
            JSON.stringify({ message: error.message || "A critical error occurred." }), 
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}