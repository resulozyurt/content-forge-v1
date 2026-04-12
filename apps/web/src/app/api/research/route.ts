// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const openai = new OpenAI();
export const maxDuration = 60; 

interface ScrapedData {
    url: string;
    title: string;
    wordCount: number;
    headings: { level: string; text: string }[];
}

export async function POST(req: Request) {
    try {
        const { topic, config } = await req.json();

        if (!topic) {
            return NextResponse.json({ message: "Topic is required" }, { status: 400 });
        }

        const serperApiKey = process.env.SERPER_API_KEY;
        if (!serperApiKey) {
            throw new Error("SERPER_API_KEY is missing in environment variables.");
        }

        const language = config?.language || "English";
        const contentDepth = config?.depth || "Comprehensive";
        
        console.log(`[STAGE 1] Fetching real SERP data for: "${topic}"...`);

        // 1. Fetch Google SERP Data via Serper.dev
        const serperResponse = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": serperApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                q: topic,
                num: 10 // Fetch top 10 results
            })
        });

        const serperData = await serperResponse.json();
        
        if (!serperData.organic || serperData.organic.length === 0) {
            throw new Error("No organic search results found.");
        }

        const topUrls = serperData.organic.map((res: any) => res.link).slice(0, 10);
        console.log(`[STAGE 2] Found ${topUrls.length} URLs. Initiating Cheerio scraper...`);

        // 2. Scrape individual URLs concurrently
        const scrapePromises = topUrls.map(async (url: string) => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); 

                const response = await fetch(url, { 
                    signal: controller.signal,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
                });
                clearTimeout(timeoutId);

                if (!response.ok) return null;

                const html = await response.text();
                const $ = cheerio.load(html);

                // Remove unnecessary elements to calculate rough word count
                $('script, style, noscript, iframe, img, svg, nav, footer').remove();
                const textContent = $('body').text().replace(/\s+/g, ' ').trim();
                const wordCount = textContent.split(' ').length;

                const headings: { level: string; text: string }[] = [];
                $('h1, h2, h3').each((_, el) => {
                    const text = $(el).text().trim();
                    if (text.length > 5 && text.length < 150) {
                        headings.push({
                            level: el.tagName.toLowerCase(),
                            text: text
                        });
                    }
                });

                const pageTitle = $('title').text() || url;

                return {
                    url,
                    title: pageTitle.substring(0, 60),
                    wordCount,
                    headings: headings.slice(0, 20) 
                } as ScrapedData;

            } catch (err) {
                // Ignore failed fetches (CORS, anti-bot, timeouts) to not crash the whole process
                return null;
            }
        });

        // Resolve all promises and filter out failed ones
        const scrapedResultsRaw = await Promise.all(scrapePromises);
        const validScrapedResults = scrapedResultsRaw.filter(Boolean) as ScrapedData[];

        if (validScrapedResults.length === 0) {
            throw new Error("Failed to scrape any of the top 10 URLs. Sites might be protected.");
        }

        console.log(`[STAGE 3] Successfully scraped ${validScrapedResults.length} sites. Sending to OpenAI NLP Engine...`);

        // 3. Pass real scraped data to OpenAI for NLP Analysis
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are an elite SEO Strategist and NLP Expert. Analyze the provided real-world SERP competitor data.
                    You MUST return the output ONLY as a valid JSON object matching this exact schema:
                    {
                        "searchIntent": "String (e.g., Informational, Transactional, Commercial)",
                        "primaryKeywords": ["keyword1", "keyword2", "keyword3"],
                        "secondaryKeywords": ["kw4", "kw5", "kw6", "kw7", "kw8"],
                        "competitors": [
                            {
                                "name": "Competitor Site Title",
                                "url": "competitor.com",
                                "wordCount": 1500,
                                "headings": [
                                    {"level": "h2", "text": "Heading text"}
                                ]
                            }
                        ]
                    }
                    
                    CRITICAL RULES:
                    1. Output language MUST be: ${language}.
                    2. Analyze the provided competitor headings to extract highly relevant LSI/NLP keywords.
                    3. Return EXACTLY the competitors provided in the user prompt, do NOT invent new ones. Format their headings logically.
                    4. Content depth context: ${contentDepth}.`
                },
                {
                    role: "user",
                    content: `Here is the real SERP data for the topic "${topic}":\n\n${JSON.stringify(validScrapedResults, null, 2)}`
                }
            ],
            temperature: 0.5,
        });

        const rawContent = completion.choices[0].message.content;
        
        if (!rawContent) {
            throw new Error("No content received from OpenAI");
        }

        const researchData = JSON.parse(rawContent);
        
        console.log("✅ [SUCCESS] Real Research & Scraping Complete!");

        return NextResponse.json({ data: researchData }, { status: 200 });

    } catch (error: any) {
        console.error("RESEARCH_ERROR:", error);
        return NextResponse.json({ message: error.message || "Error during research phase" }, { status: 500 });
    }
}