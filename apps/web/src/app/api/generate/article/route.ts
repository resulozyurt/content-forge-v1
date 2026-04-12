// apps/web/src/app/api/generate/article/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth"; 
import { BillingGuard } from "@/lib/billing"; 
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = new OpenAI();
const anthropic = new Anthropic();

// Extended timeout limit to accommodate sequential generation cycles
export const maxDuration = 300; 

export async function POST(req: Request) {
    try {
        // 1. AUTHENTICATION & SESSION VALIDATION
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ message: "Unauthorized access. Please log in to proceed." }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const ARTICLE_COST = 5; 

        // 2. BILLING GUARD: Verify available credits prior to API execution
        await BillingGuard.checkCredits(userId, ARTICLE_COST);

        const { outlineData, config } = await req.json();

        if (!outlineData || !outlineData.headings) {
            return NextResponse.json({ message: "Outline data payload is missing or corrupted." }, { status: 400 });
        }

        const generatedBlocks: any[] = [];
        let h2Counter = 0;

        // 3. CAPTURE UI CONFIGURATIONS
        const language = config?.language || "English (US)";
        const tone = config?.tone || "Highly Professional, Data-Driven, Authoritative";
        const depth = config?.depth || "Comprehensive";
        const engine = config?.engine || "GPT-4o";
        const wpSitemap = config?.wpSitemap || ""; 

        // 4. DYNAMIC INTERNAL LINK POOL (SITEMAP FETCH)
        let internalLinks: string[] = [];
        if (wpSitemap) {
            try {
                console.log(`[SEO_PIPELINE] Fetching sitemap for internal link architecture from: ${wpSitemap}`);
                const sitemapRes = await fetch(wpSitemap, { signal: AbortSignal.timeout(5000) });
                if (sitemapRes.ok) {
                    const sitemapXml = await sitemapRes.text();
                    const matches = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g));
                    internalLinks = matches.map(m => m[1]).filter(url => url.length > 10).slice(0, 20);
                    console.log(`[SEO_PIPELINE] Successfully extracted ${internalLinks.length} valid URLs from the sitemap.`);
                }
            } catch (e) {
                console.warn("[SEO_PIPELINE] Sitemap fetch failed or timed out. Proceeding without dynamic internal linkage.");
            }
        }

        // 5. EXTERNAL SOURCE LINK INTEGRATION
        const sourceUrls = outlineData.sourceUrls || [];
        const externalLinksContext = sourceUrls.length > 0 
            ? `EXTERNAL LINK RULE: You MUST organically insert ONE external link using EXACTLY one of these verified URLs: ${sourceUrls.join(', ')}. NEVER hallucinate or invent URLs. The anchor text must flow naturally.`
            : `EXTERNAL LINK RULE: Do not add any external links as no verified sources were provided.`;

        const internalLinksContext = internalLinks.length > 0
            ? `INTERNAL LINK RULE: You MUST organically insert ONE internal link using a relevant URL from this list: ${internalLinks.join(', ')}. The anchor text must be natural. Format: <a href="[URL]" class="text-blue-600 hover:underline">[Anchor Text]</a>.`
            : `INTERNAL LINK RULE: No internal links provided. Skip internal linking altogether.`;

        // 6. CORE SEO & NLP SYSTEM PROMPT (JSON ENFORCEMENT)
        const systemPrompt = `You are an elite Senior SEO Engineer and NLP Content Strategist. 
        Task: Write a high-density, expert-level section for the heading provided.
        
        CRITICAL OUTPUT FORMAT: You MUST return your response ONLY as a valid JSON object matching this exact schema:
        {
          "rewrittenHeading": "A highly engaging, unique, and SEO-optimized variation of the provided heading. Do not copy the original exactly.",
          "htmlContent": "The raw HTML content (<p>, <ul>, <strong>) for this section. No markdown backticks."
        }
        
        STRICT RULES:
        1. NO FLUFF: Avoid generic intros ("In today's digital world"). Deliver pure, factual, and analytical value immediately.
        2. LANGUAGE: EXACTLY ${language}. If English, utilize Native American English phrasing exclusively.
        3. TONE: ${tone}.
        4. DEPTH: ${depth}.
        5. FORMAT: Return ONLY valid JSON.
        6. ${externalLinksContext}
        7. ${internalLinksContext}`;

        console.log(`🚀 [GENERATION_INIT] Engine: ${engine} | Lang: ${language}`);

        // 7. PRIMARY GENERATION LOOP
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

            // A. DYNAMIC ENGINE ROUTING (CLAUDE vs GPT)
            try {
                if (engine.toLowerCase().includes("claude")) {
                    console.log(`[PROCESS] Drafting section via Claude: ${heading.text}`);
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
                    console.log(`[PROCESS] Drafting section via GPT-4o: ${heading.text}`);
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

                // Robust JSON parsing to handle erratic markdown wrappers
                const cleanedRaw = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsedData = JSON.parse(cleanedRaw);
                
                finalHeadingText = parsedData.rewrittenHeading || heading.text;
                generatedText = parsedData.htmlContent || "";

            } catch (parseError) {
                console.error("[PARSE_FAULT] Failed to extract valid JSON payload from AI response.", parseError);
                generatedText = rawContent || "<p>The content pipeline encountered a formatting fault during execution.</p>";
            }

            // Strip residual HTML markdown wrappers
            generatedText = generatedText.replace(/```html|```/g, '').trim();

            // Append parsed data blocks to the payload array
            generatedBlocks.push({
                id: `h-${i}`,
                type: heading.level,
                content: finalHeadingText,
            });

            generatedBlocks.push({
                id: `p-${i}`,
                type: 'paragraph',
                content: generatedText,
            });

            // B. VISUAL ASSET PROMPT ENGINEERING
            // Generates an optimized text prompt for external generation tools every 2nd H2
            if (heading.level === 'h2' && h2Counter % 2 === 0) {
                try {
                    console.log(`[PROMPT_ENGINEERING] Generating visual asset prompt for: ${finalHeadingText}`);
                    
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

                        generatedBlocks.push({
                            id: `img-prompt-${i}`,
                            type: 'image',
                            content: promptHtmlContext,
                        });
                    }
                } catch (promptError) {
                    console.error("[PROMPT_FAULT] Failed to generate visual asset prompt:", promptError);
                }
            }
        }

        // 8. FINALIZE TRANSACTION
        await BillingGuard.deductCredits(userId, ARTICLE_COST);
        console.log(`✅ [SUCCESS] Content generation pipeline finalized. Deducted ${ARTICLE_COST} credits from user ${userId}.`);

        return NextResponse.json({ blocks: generatedBlocks }, { status: 200 });

    } catch (error: any) {
        console.error("[PIPELINE_CRITICAL_FAILURE]:", error);
        return NextResponse.json({ message: error.message || "A critical error occurred during the content generation pipeline." }, { status: 500 });
    }
}