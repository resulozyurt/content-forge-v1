// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const openai = new OpenAI();

// Extend execution timeout for robust asynchronous scraping and chained AI operations
export const maxDuration = 300; 

export interface ScrapedData {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  headings: { level: string; text: string }[];
}

/**
 * Advanced fetch wrapper utilizing ScraperAPI to bypass Cloudflare, Datadome, and JS-rendering walls.
 * If SCRAPER_API_KEY is not defined in the environment, it gracefully falls back to a standard fetch with rotated headers.
 */
const fetchWithScrapingInfrastructure = async (url: string, signal: AbortSignal): Promise<string | null> => {
  try {
    const scraperApiKey = process.env.SCRAPER_API_KEY;
    
    // Route traffic through the proxy network if the key is provisioned
    const targetUrl = scraperApiKey 
        ? `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}&render=true`
        : url;

    const response = await fetch(targetUrl, { 
      signal,
      headers: scraperApiKey ? {} : { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
    
    // Rate Limiting: 20 research operations per hour per user
    const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
    const limiter = await rateLimit(`research_${userId}_${ip}`, 20, 60 * 60 * 1000); 

    if (!limiter.success) {
        return NextResponse.json(
            { error: "Research quota exceeded. Please wait before starting new research." }, 
            { 
                status: 429, 
                headers: getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) 
            }
        );
    }

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

    // 3. Procure Google SERP Data (Fetch top 15 to maintain a standby buffer for deselection)
    const serperResponse = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: topic, num: 15 }), // Increased to 15 for the standby buffer
    });

    if (!serperResponse.ok) throw new Error("Failed to retrieve data from the primary search provider.");
    const serperData = await serperResponse.json();
    
    if (!serperData.organic || serperData.organic.length === 0) {
      return NextResponse.json({ error: "No organic search results found for the specified query." }, { status: 404 });
    }

    const topUrls = serperData.organic.map((res: any) => res.link).slice(0, 15);
    console.log(`[SCRAPE_INIT] Identified ${topUrls.length} target URLs. Initializing concurrent workers...`);

    // 4. Concurrent Web Scraping with Fault Tolerance
    const scrapePromises = topUrls.map(async (url: string, index: number) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second hard timeout per worker

      const html = await fetchWithScrapingInfrastructure(url, controller.signal);
      clearTimeout(timeoutId);

      if (!html) return null;

      try {
        const $ = cheerio.load(html);

        // Aggressive DOM sanitization to reduce noise and LLM token bloat
        $("script, style, noscript, iframe, img, svg, nav, footer, header, aside, .sidebar, .comments, .advertisement").remove();
        
        const textContent = $("body").text().replace(/\s+/g, " ").trim();
        const wordCount = textContent.split(" ").length;

        if (wordCount < 150) return null;

        const headings: { level: string; text: string }[] = [];
        $("h1, h2, h3").each((_, el) => {
          const text = $(el).text().replace(/\s+/g, " ").trim();
          if (text.length > 10 && text.length < 120) {
            headings.push({ level: el.tagName.toLowerCase(), text });
          }
        });

        const pageTitle = $("title").text() || url;

        return {
          id: `comp_${index}_${Date.now()}`,
          url,
          title: pageTitle.substring(0, 70),
          wordCount,
          headings: headings.slice(0, 25) // Cap to prevent context window overflow
        } as ScrapedData;

      } catch (parseError) {
        console.warn(`[DOM_PARSE_FAULT] Failed to parse HTML payload for ${url}`);
        return null;
      }
    });

    const scrapedResultsRaw = await Promise.allSettled(scrapePromises);
    const validScrapedResults = scrapedResultsRaw
      .filter((res): res is PromiseFulfilledResult<ScrapedData> => res.status === 'fulfilled' && res.value !== null)
      .map(res => res.value);

    if (validScrapedResults.length === 0) {
      return NextResponse.json({ 
        error: "Unable to parse competitor content. Targets may be protected by anti-bot measures." 
      }, { status: 422 });
    }

    console.log(`[NLP_ROUTING] Successfully extracted data. Executing Chained AI Prompts...`);

    // 5. CHAINED AI - Step 1: Core Search Intent & Keyword Matrix
    const intentCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Faster model for initial classification
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an elite SEO Strategist. Analyze the target topic and return a JSON object with strictly these keys:
{
  "searchIntent": "String (e.g., Informational, Transactional, Commercial Investigation)",
  "primaryKeywords": ["kw1", "kw2", "kw3"],
  "secondaryKeywords": ["kw4", "kw5", "kw6", "kw7"]
}
Rules: Extract LSI and semantic keywords. Target Language: ${language}.`
        },
        { role: "user", content: `Target Topic: "${topic}"` }
      ]
    });

    const intentData = JSON.parse(intentCompletion.choices[0].message.content || "{}");

    // 6. CHAINED AI - Step 2: Content Gap & PAA (People Also Ask) Analysis based on competitors
    // We only send the headings to save tokens and focus the AI on structural gaps
    const competitorHeadingsMap = validScrapedResults.slice(0, 10).map(c => ({ title: c.title, headings: c.headings.map(h => h.text) }));

    const gapCompletion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a Senior Content Architect. Review the structural headings of the top ranking competitors for the topic.
Identify critical content gaps (what they missed) and frequently asked questions.
Return ONLY a JSON object matching this schema:
{
  "gaps": ["Gap 1", "Gap 2", "Gap 3"],
  "questions": [
    {"text": "Question 1", "selected": true},
    {"text": "Question 2", "selected": true}
  ]
}
Rules: Target Language: ${language}. Depth: ${contentDepth}.`
        },
        {
          role: "user",
          content: `Target Topic: "${topic}"\nCompetitor Structures:\n${JSON.stringify(competitorHeadingsMap)}`
        }
      ]
    });

    const gapData = JSON.parse(gapCompletion.choices[0].message.content || "{}");

    // 7. Assemble the final unified payload
    const researchData = {
      intent: intentData.searchIntent || "Informational",
      keywords: [
        ...(intentData.primaryKeywords || []).map((k: string) => ({ text: k, selected: true })),
        ...(intentData.secondaryKeywords || []).map((k: string) => ({ text: k, selected: false }))
      ],
      competitors: validScrapedResults, // Full array including standbys (up to 15)
      questions: gapData.questions || [],
      gaps: gapData.gaps || []
    };
    
    // 8. Finalize Transaction & Deduct Credits
    await BillingGuard.deductCredits(userId, RESEARCH_COST, "RESEARCH");
    console.log(`[SUCCESS] Research pipeline finalized. Deducted ${RESEARCH_COST} credit(s).`);

    return NextResponse.json({ data: researchData }, { status: 200 });

  } catch (error: any) {
    console.error("[RESEARCH_PIPELINE_CRITICAL_FAULT]:", error);
    return NextResponse.json({ 
      error: error.message || "An unexpected critical fault occurred during the research sequence." 
    }, { status: 500 });
  }
}