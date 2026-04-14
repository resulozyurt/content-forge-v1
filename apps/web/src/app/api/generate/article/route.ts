// apps/web/src/app/api/generate/article/route.ts
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

// Initialize AI SDK clients
const openai = new OpenAI();
const anthropic = new Anthropic();

// Extend the maximum execution duration for serverless environments (Vercel)
export const maxDuration = 300;

// Inside POST function:
const userId = (session.user as any).id;
// Limit: 10 full article generations per hour per user (highly expensive)
const limiter = await rateLimit(`gen_article_${userId}`, 10, 60 * 60 * 1000);

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
        const ARTICLE_COST = 5;

        // 2. Billing Guard: Verify available credits prior to initializing the generation pipeline
        await BillingGuard.checkCredits(userId, ARTICLE_COST);

        const { outlineData, config } = await req.json();

        if (!outlineData || !outlineData.headings) {
            return new Response(
                JSON.stringify({ message: "Outline data payload is missing or corrupted." }), 
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // 3. Capture UI Configurations
        const language = config?.language || "English (US)";
        const tone = config?.tone || "Highly Professional, Data-Driven, Authoritative";
        const depth = config?.depth || "Comprehensive";
        const engine = config?.engine || "gpt-4o"; // Ensure fallback
        const wpSitemap = config?.wpSitemap || "";

        // 4. Initialize Server-Sent Events (SSE) Stream Architecture
        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
            async start(controller) {
                // Utility function to dispatch formatted SSE chunks to the client
                const sendEvent = (data: any) => {
                    const chunk = `data: ${JSON.stringify(data)}\n\n`;
                    controller.enqueue(encoder.encode(chunk));
                };

                // Utility function to gracefully terminate the stream
                const closeStream = () => {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                };

                try {
                    // 5. Dynamic Internal Link Pool Configuration
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
                            console.warn("[SEO_PIPELINE_WARNING] Sitemap fetch timed out. Proceeding without dynamic internal linkage.");
                        }
                    }

                    // 6. External & Internal Source Link Directives
                    const sourceUrls = outlineData.sourceUrls || [];
                    const externalLinksContext = sourceUrls.length > 0 
                        ? `EXTERNAL LINK RULE: You MUST organically insert ONE external link using EXACTLY one of these verified URLs: ${sourceUrls.join(', ')}. NEVER hallucinate or invent URLs. The anchor text must flow naturally within the context.`
                        : `EXTERNAL LINK RULE: Do not add any external links as no verified sources were provided.`;

                    const internalLinksContext = internalLinks.length > 0
                        ? `INTERNAL LINK RULE: You MUST organically insert ONE internal link using a relevant URL from this list: ${internalLinks.join(', ')}. Format: <a href="[URL]" class="text-blue-600 hover:underline">[Anchor Text]</a>.`
                        : `INTERNAL LINK RULE: Skip internal linking altogether as no valid sitemap URLs were detected.`;

                    // 7. Core SEO & NLP System Prompt
                    const systemPrompt = `You are an elite Senior SEO Engineer and NLP Content Strategist. 
Task: Write a high-density, expert-level section for the heading provided.

CRITICAL OUTPUT FORMAT: You MUST return your response ONLY as a valid JSON object matching this exact schema:
{
  "rewrittenHeading": "A highly engaging, unique, and SEO-optimized variation of the provided heading. Do not copy the original exactly.",
  "htmlContent": "The raw HTML content (<p>, <ul>, <strong>) for this section. No markdown backticks."
}

STRICT RULES:
1. NO FLUFF: Avoid generic introductions. Deliver pure, factual, and analytical value immediately.
2. LANGUAGE: EXACTLY ${language}. If English, utilize Native American English phrasing exclusively.
3. TONE: ${tone}.
4. DEPTH: ${depth}.
5. FORMAT: Return ONLY valid JSON.
6. ${externalLinksContext}
7. ${internalLinksContext}`;

                    let h2Counter = 0;

                    // 8. Primary Generation Loop (Iterating through the user's outline)
                    for (let i = 0; i < outlineData.headings.length; i++) {
                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetKeyword = outlineData.selectedKeywords?.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        const userMessage = `Original Heading: "${heading.text}"\nTarget NLP Keyword to seamlessly incorporate: "${targetKeyword}"`;
                        
                        let finalHeadingText = heading.text;
                        let generatedText = "";
                        let rawContent = "";

                        // A. Dynamic Engine Routing
                        try {
                            if (engine.toLowerCase().includes("claude")) {
                                const msg = await anthropic.messages.create({
                                    model: "claude-3-5-sonnet-20240620",
                                    max_tokens: 1500,
                                    system: systemPrompt,
                                    messages: [{ role: "user", content: userMessage }],
                                    temperature: 0.6,
                                });
                                
                                if (msg.content[0].type === 'text') {
                                    rawContent = msg.content[0].text;
                                }
                            } else {
                                const textCompletion = await openai.chat.completions.create({
                                    model: "gpt-4o",
                                    response_format: { type: "json_object" },
                                    messages: [
                                        { role: "system", content: systemPrompt },
                                        { role: "user", content: userMessage }
                                    ],
                                    temperature: 0.6,
                                });
                                rawContent = textCompletion.choices[0].message.content || "{}";
                            }

                            // Robust JSON parsing to strip residual markdown artifacts
                            const cleanedRaw = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
                            const parsedData = JSON.parse(cleanedRaw);
                            
                            finalHeadingText = parsedData.rewrittenHeading || heading.text;
                            generatedText = parsedData.htmlContent || "";

                        } catch (parseError) {
                            console.error("[PARSE_FAULT] Failed to extract valid JSON payload from AI response.", parseError);
                            generatedText = rawContent || "<p>The content pipeline encountered a formatting fault during execution.</p>";
                        }

                        // Clean any remaining HTML wrappers generated by the LLM
                        generatedText = generatedText.replace(/```html|```/g, '').trim();

                        // B. Dispatch Content Blocks to the Client Immediately
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

                        // C. Visual Asset Prompt Engineering Execution (Every 2nd H2)
                        if (heading.level === 'h2' && h2Counter % 2 === 0) {
                            try {
                                const promptReq = await openai.chat.completions.create({
                                    model: "gpt-4o",
                                    messages: [
                                        {
                                            role: "system",
                                            content: `You are an elite AI image prompt engineer. Write a highly detailed, photorealistic image generation prompt tailored for a Midjourney v6 or Flow model. 
                                            
                                            CRITICAL RULES:
                                            1. The prompt MUST be authored in Native American English.
                                            2. Be highly descriptive, focusing on lighting, composition, and a corporate/tech aesthetic.
                                            3. Output ONLY the raw prompt text, absolutely nothing else.`
                                        },
                                        {
                                            role: "user",
                                            content: `Generate a visually compelling image prompt for an article section titled: "${finalHeadingText}".`
                                        }
                                    ],
                                    temperature: 0.7,
                                });

                                const generatedPrompt = promptReq.choices[0].message.content?.trim();

                                if (generatedPrompt) {
                                    const promptHtmlContext = `
                                        <div class="ai-prompt-container border-l-4 border-indigo-500 bg-indigo-50/50 p-4 my-6 rounded-r-lg">
                                            <span class="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2 block">Visual Asset Generation Prompt</span>
                                            <p class="text-gray-800 font-mono text-sm leading-relaxed">${generatedPrompt}</p>
                                        </div>
                                    `;

                                    sendEvent({
                                        id: `img-prompt-${i}-${Date.now()}`,
                                        type: 'image',
                                        content: promptHtmlContext,
                                    });
                                }
                            } catch (promptError) {
                                console.error("[PROMPT_FAULT] Failed to generate visual asset prompt:", promptError);
                            }
                        }
                    }

                    // 9. Finalize Transaction & Deduct Credits
                    await BillingGuard.deductCredits(userId, ARTICLE_COST);
                    closeStream();

                } catch (streamError) {
                    console.error("[STREAM_EXECUTION_FAULT]:", streamError);
                    // Ensure the client receives the termination signal even on critical failures
                    closeStream(); 
                }
            }
        });

        // 10. Return the standard SSE response headers to keep the connection alive
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
            JSON.stringify({ message: error.message || "A critical error occurred during the content generation initialization." }), 
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}