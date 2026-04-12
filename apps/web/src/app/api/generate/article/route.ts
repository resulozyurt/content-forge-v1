// apps/web/src/app/api/generate/article/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai = new OpenAI();
const anthropic = new Anthropic();
export const maxDuration = 300; 

export async function POST(req: Request) {
    try {
        const { outlineData, config } = await req.json();

        if (!outlineData || !outlineData.headings) {
            return NextResponse.json({ message: "Outline data is missing" }, { status: 400 });
        }

        const generatedBlocks: any[] = [];
        let h2Counter = 0;

        // --- 1. ARAYÜZDEN GELEN KONFİGÜRASYONLARI YAKALA ---
        const language = config?.language || "English (US)";
        const tone = config?.tone || "Highly Professional, Data-Driven, Authoritative";
        const depth = config?.depth || "Comprehensive";
        const engine = config?.engine || "GPT-4o";
        const wpSitemap = config?.wpSitemap || ""; 

        // --- 2. DİNAMİK İÇ LİNK HAVUZU OLUŞTURMA (SITEMAP FETCH) ---
        let internalLinks: string[] = [];
        if (wpSitemap) {
            try {
                console.log(`[SEO] Fetching sitemap for internal links from: ${wpSitemap}`);
                const sitemapRes = await fetch(wpSitemap, { signal: AbortSignal.timeout(5000) });
                if (sitemapRes.ok) {
                    const sitemapXml = await sitemapRes.text();
                    const matches = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g));
                    internalLinks = matches.map(m => m[1]).filter(url => url.length > 10).slice(0, 20);
                    console.log(`[SEO] Successfully fetched ${internalLinks.length} URLs from sitemap.`);
                }
            } catch (e) {
                console.warn("[SEO] Sitemap fetch failed or timed out. Proceeding without dynamic internal links.");
            }
        }

        // --- 3. GERÇEK DIŞ KAYNAK LİNKLERİ (AŞAMA 1'DEN GELEN) ---
        const sourceUrls = outlineData.sourceUrls || [];
        const externalLinksContext = sourceUrls.length > 0 
            ? `EXTERNAL LINK RULE: You MUST organically insert ONE external link using EXACTLY one of these verified URLs: ${sourceUrls.join(', ')}. NEVER hallucinate or invent URLs. Anchor text must flow naturally.`
            : `EXTERNAL LINK RULE: Do not add any external links as no verified sources were provided.`;

        const internalLinksContext = internalLinks.length > 0
            ? `INTERNAL LINK RULE: You MUST organically insert ONE internal link using a relevant URL from this list: ${internalLinks.join(', ')}. Anchor text must be natural. Format: <a href="[URL]" class="text-blue-600 hover:underline">[Anchor Text]</a>.`
            : `INTERNAL LINK RULE: No internal links provided. Skip internal linking.`;

        // --- 4. ANA SEO VE NLP SİSTEM PROMPTU (JSON FORMATINA ZORLAMA) ---
        const systemPrompt = `You are an elite Senior SEO Engineer and NLP Content Strategist. 
        Task: Write a high-density, expert-level section for the heading provided.
        
        CRITICAL OUTPUT FORMAT: You MUST return your response ONLY as a valid JSON object matching this schema:
        {
          "rewrittenHeading": "A highly engaging, unique, and SEO-optimized variation of the provided heading. Do not copy the original exactly.",
          "htmlContent": "The raw HTML content (<p>, <ul>, <strong>) for this section. No markdown backticks."
        }
        
        STRICT RULES:
        1. NO FLUFF: Avoid generic intros ("In today's digital world"). Deliver pure, factual, and analytical value immediately.
        2. LANGUAGE: EXACTLY ${language}.
        3. TONE: ${tone}.
        4. DEPTH: ${depth}.
        5. FORMAT: Return ONLY valid JSON.
        6. ${externalLinksContext}
        7. ${internalLinksContext}`;

        console.log(`🚀 AI Engine Started | Model: ${engine} | Lang: ${language}`);

        // --- 5. ÜRETİM DÖNGÜSÜ ---
        for (let i = 0; i < outlineData.headings.length; i++) {
            const heading = outlineData.headings[i];
            if (heading.level === 'h2') h2Counter++;

            const targetKeyword = outlineData.selectedKeywords?.length > 0 
                ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                : heading.text;

            const userMessage = `Original Heading: "${heading.text}"\nTarget NLP Keyword to include naturally: "${targetKeyword}"`;
            
            let finalHeadingText = heading.text;
            let generatedText = "";
            let rawContent = "";

            // --- A. DİNAMİK MODEL SEÇİMİ (CLAUDE vs GPT) ---
            try {
                if (engine.toLowerCase().includes("claude")) {
                    console.log(`[GENERATING] Section: ${heading.text} (via Claude)`);
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
                    console.log(`[GENERATING] Section: ${heading.text} (via GPT-4o)`);
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

                // AI'dan gelen JSON'ı temizle ve parse et
                const cleanedRaw = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsedData = JSON.parse(cleanedRaw);
                
                finalHeadingText = parsedData.rewrittenHeading || heading.text;
                generatedText = parsedData.htmlContent || "";

            } catch (parseError) {
                console.error("Failed to parse AI JSON response", parseError);
                generatedText = rawContent || "<p>Content generation failed or formatting error.</p>";
            }

            // HTML Temizliği
            generatedText = generatedText.replace(/```html|```/g, '').trim();

            // Bloğu Diziye Ekle
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

            // --- B. KUSURSUZ GÖRSEL ÜRETİMİ (DALL-E 3) ---
            if (heading.level === 'h2' && h2Counter % 2 === 0) {
                try {
                    const imagePrompt = `A highly professional, data-driven, cinematic corporate illustration representing: ${finalHeadingText}. Minimalist style, tech-focused, no text or words in the image.`;

                    console.log(`[IMAGE AI] Triggering DALL-E 3 for: ${finalHeadingText}`);
                    const imageResponse = await openai.images.generate({
                        model: "dall-e-3",
                        prompt: imagePrompt,
                        n: 1,
                        size: "1024x1024",
                        quality: "standard",
                    });

                    const imageUrl = imageResponse.data[0].url;

                    if (imageUrl) {
                        const imageHtmlContext = `
                            <figure style="margin: 2rem 0; text-align: center;">
                                <img src="${imageUrl}" alt="${finalHeadingText}" style="border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); width: 100%; max-width: 800px; height: auto;" />
                                <figcaption style="font-size: 0.875rem; color: #6b7280; margin-top: 0.75rem; font-style: italic;">
                                    Concept: ${finalHeadingText}
                                </figcaption>
                            </figure>
                        `;

                        generatedBlocks.push({
                            id: `img-${i}`,
                            type: 'image',
                            content: imageHtmlContext,
                        });
                    }
                } catch (imgError) {
                    console.error("[IMAGE ERROR] DALL-E 3 failed:", imgError);
                }
            }
        }

        console.log("✅ [SUCCESS] AI Content Generation Complete!");
        return NextResponse.json({ blocks: generatedBlocks }, { status: 200 });

    } catch (error: any) {
        console.error("GENERATION_ERROR:", error);
        return NextResponse.json({ message: error.message || "Error during AI generation" }, { status: 500 });
    }
}