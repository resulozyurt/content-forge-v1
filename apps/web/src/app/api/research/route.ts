// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const openai = new OpenAI();

// Extend execution timeout for robust asynchronous scraping operations
export const maxDuration = 300; 

export interface ScrapedData {
  url: string;
  title: string;
  wordCount: number;
  headings: { level: string; text: string }[];
  domainAuthorityFallback?: number; // Future-proofing for SEO metrics
}

/**
 * Utility function to rotate User-Agents to mitigate basic WAF blocks.
 */
const getRandomUserAgent = (): string => {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0"
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

/**
 * Advanced fetch wrapper prepared for external Scraping API integration.
 * Replace the standard fetch with ScraperAPI, Browserless, or Firecrawl endpoints here in production.
 */
const fetchWithScrapingInfrastructure = async (url: string, signal: AbortSignal): Promise<string | null> => {
  try {
    // Note: To enable a commercial scraper API, wrap the URL here.
    // Example: const targetUrl = \`http://api.scraperapi.com?api_key=YOUR_KEY&url=\${encodeURIComponent(url)}\`;
    const targetUrl = url; 

    const response = await fetch(targetUrl, { 
      signal,
      headers: { 
        "User-Agent": getRandomUserAgent(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      }
    });

    if (!response.ok) {
      console.warn(`[SCRAPER_WARNING] Access denied or failed for ${url} - Status: ${response.status}`);
      return null;
    }

    return await response.text();
  } catch (err) {
    console.warn(`[SCRAPER_NETWORK_FAULT] Failed to establish connection to ${url}`);
    return null;
  }
};

export async function POST(req: Request) {
  try {
    // 1. Authentication & Session Validation
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized access. Please log in to continue." }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const RESEARCH_COST = 1;

    // 2. Billing Guard Assessment
    await BillingGuard.checkCredits(userId, RESEARCH_COST);

    const { topic, config } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "A valid research topic is required." }, { status: 400 });
    }

    const serperApiKey = process.env.SERPER_API_KEY;
    if (!serperApiKey) {
      console.error("[CRITICAL_CONFIG_ERROR] SERPER_API_KEY is missing from environment variables.");
      return NextResponse.json({ error: "Search infrastructure configuration is missing." }, { status: 500 });
    }

    const language = config?.language || "English (US)";
    const contentDepth = config?.depth || "Comprehensive";
    
    console.log(`[PIPELINE_INIT] Fetching live SERP data for primary keyword: "${topic}"...`);

    // 3. Procure Google SERP Data via Serper.dev
    const serperResponse = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: topic, num: 10 }), // Target top 10 organic results
    });

    if (!serperResponse.ok) throw new Error("Failed to retrieve data from the primary search provider.");
    const serperData = await serperResponse.json();
    
    if (!serperData.organic || serperData.organic.length === 0) {
      return NextResponse.json({ error: "No organic search results found for the specified query." }, { status: 404 });
    }

    const topUrls = serperData.organic.map((res: any) => res.link).slice(0, 10);
    console.log(`[SCRAPE_INIT] Identified ${topUrls.length} target URLs. Initializing concurrent workers...`);

    // 4. Concurrent Web Scraping with Fault Tolerance
    const scrapePromises = topUrls.map(async (url: string) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second hard timeout per worker

      const html = await fetchWithScrapingInfrastructure(url, controller.signal);
      clearTimeout(timeoutId);

      if (!html) return null;

      try {
        const $ = cheerio.load(html);

        // Aggressive DOM sanitization to reduce noise and LLM token bloat
        $("script, style, noscript, iframe, img, svg, nav, footer, header, aside, .sidebar, .comments, .advertisement").remove();
        
        const textContent = $("body").text().replace(/\s+/g, " ").trim();
        const wordCount = textContent.split(" ").length;

        // Skip pages with insufficient content (likely errors or heavily JS-rendered pages)
        if (wordCount < 150) return null;

        const headings: { level: string; text: string }[] = [];
        $("h1, h2, h3").each((_, el) => {
          const text = $(el).text().replace(/\s+/g, " ").trim();
          // Filter anomalous headings
          if (text.length > 10 && text.length < 120) {
            headings.push({ level: el.tagName.toLowerCase(), text });
          }
        });

        const pageTitle = $("title").text() || url;

        return {
          url,
          title: pageTitle.substring(0, 70),
          wordCount,
          headings: headings.slice(0, 25) // Cap to prevent exceeding token context window
        } as ScrapedData;

      } catch (parseError) {
        console.warn(`[DOM_PARSE_FAULT] Failed to parse HTML payload for ${url}`);
        return null;
      }
    });

    // Use Promise.allSettled to guarantee the pipeline continues even if specific URLs fail
    const scrapedResultsRaw = await Promise.allSettled(scrapePromises);
    const validScrapedResults = scrapedResultsRaw
      .filter((res): res is PromiseFulfilledResult<ScrapedData> => res.status === 'fulfilled' && res.value !== null)
      .map(res => res.value);

    if (validScrapedResults.length === 0) {
      return NextResponse.json({ 
        error: "Unable to parse competitor content. Targets may be protected by anti-bot measures. Consider upgrading to a premium scraping proxy." 
      }, { status: 422 });
    }

    console.log(`[NLP_ROUTING] Successfully extracted data from ${validScrapedResults.length} competitors. Transmitting to NLP engine...`);

    // 5. NLP Analysis & Keyword Extraction via OpenAI
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
  ],
  "questions": [
    {"text": "Question 1", "selected": true},
    {"text": "Question 2", "selected": true}
  ]
}

CRITICAL RULES:
1. TARGET LANGUAGE: ${language}. All generated insights, keywords, and questions MUST be in this language.
2. NATIVE PHRASING: If English, enforce Native American English phrasing strictly.
3. Extract high-value Semantic/LSI keywords based on the competitor headings.
4. Return EXACTLY the competitors provided in the prompt payload; do NOT hallucinate fictional URLs.
5. Content Depth Target: ${contentDepth}. Provide comprehensive keyword coverage suitable for this depth.`
        },
        {
          role: "user",
          content: `Live SERP array for target query "${topic}":\n\n${JSON.stringify(validScrapedResults, null, 2)}`
        }
      ],
      temperature: 0.5,
    });

    const rawContent = completion.choices[0].message.content;
    
    if (!rawContent) throw new Error("The NLP engine failed to return a valid payload.");

    const researchData = JSON.parse(rawContent);
    
    // 6. Finalize Transaction & Deduct Credits
    await BillingGuard.deductCredits(userId, RESEARCH_COST);
    console.log(`[SUCCESS] Research pipeline finalized. Deducted ${RESEARCH_COST} credit(s) from user ${userId}.`);

    return NextResponse.json({ data: researchData }, { status: 200 });

  } catch (error: any) {
    console.error("[RESEARCH_PIPELINE_CRITICAL_FAULT]:", error);
    return NextResponse.json({ 
      error: error.message || "An unexpected critical fault occurred during the research sequence." 
    }, { status: 500 });
  }
}