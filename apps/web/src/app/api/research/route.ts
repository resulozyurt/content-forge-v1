// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

// Initialize the Anthropic SDK to leverage Claude 3.5 Sonnet's deep context window
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

// Extend execution timeout to accommodate deep scraping and Claude's complex reasoning
export const maxDuration = 300; 

export interface ScrapedData {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  headings: { level: string; text: string }[];
  bodyText: string; // Crucial addition: Storing raw text for Claude's semantic TF-IDF simulation
}

/**
 * Advanced fetch wrapper utilizing ScraperAPI to bypass Cloudflare, Datadome, and JS-rendering walls.
 * If SCRAPER_API_KEY is not defined, it gracefully falls back to a standard fetch with rotated headers.
 */
const fetchWithScrapingInfrastructure = async (url: string, signal: AbortSignal): Promise<string | null> => {
  try {
    const scraperApiKey = process.env.SCRAPER_API_KEY;
    
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

    // 3. Procure Google SERP Data (Fetch top 15 to maintain a standby buffer)
    const serperResponse = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: topic, num: 15 }), 
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
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second hard timeout

      const html = await fetchWithScrapingInfrastructure(url, controller.signal);
      clearTimeout(timeoutId);

      if (!html) return null;

      try {
        const $ = cheerio.load(html);

        // Aggressive DOM sanitization to reduce noise
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
          headings: headings.slice(0, 25),
          bodyText: textContent.substring(0, 4000) // Provide 4K chars of pure context per competitor to Claude
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

    console.log(`[NLP_ROUTING] Successfully extracted data for ${validScrapedResults.length} competitors. Executing Claude 3.5 Sonnet Tool Use...`);

    // 5. Constructing the Context payload for Claude
    const competitorContext = validScrapedResults.slice(0, 10).map(c => 
      `--- Competitor: ${c.title} ---\nHeadings: ${c.headings.map(h => h.text).join(", ")}\nContent Snippet: ${c.bodyText}`
    ).join("\n\n");

    // 6. CLAUDE 3.5 SONNET - Tool Use Execution for strict schema adherence
    const anthropicResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      temperature: 0.2, // Low temperature for highly analytical and structured output
      system: `You are an elite SEO Strategist and Data Scientist. Your task is to analyze raw competitor content and extract semantic insights mimicking a mathematical TF-IDF NLP model. Target output language: ${language}.`,
      messages: [
        {
          role: "user",
          content: `Target Topic: "${topic}"\n\nAnalyze the following top-ranking competitor content:\n\n${competitorContext}\n\nExecute the generate_research_report tool to provide your structured findings.`
        }
      ],
      tools: [
        {
          name: "generate_research_report",
          description: "Generates a strict JSON report containing search intent, keywords, gaps, and PAA questions based on competitor analysis.",
          input_schema: {
            type: "object",
            properties: {
              searchIntent: { 
                type: "string", 
                description: "The primary search intent (e.g., Informational, Transactional, Commercial)." 
              },
              primaryKeywords: { 
                type: "array", 
                items: { type: "string" }, 
                description: "Top 3-5 primary semantic keywords." 
              },
              secondaryKeywords: { 
                type: "array", 
                items: { type: "string" }, 
                description: "Exactly 10-15 LSI and secondary keywords extracted by analyzing frequent n-grams in the competitor text snippets." 
              },
              gaps: { 
                type: "array", 
                items: { type: "string" }, 
                description: "List exactly 5 to 7 highly specific content gaps. Identify what the competitors FAILED to mention or cover in-depth. Avoid generic gaps like 'missing images'." 
              },
              questions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    selected: { type: "boolean" }
                  },
                  required: ["text", "selected"]
                },
                description: "List exactly 10 to 12 People Also Ask (PAA) and frequently asked questions related to the topic. Set 'selected' to true for all."
              }
            },
            required: ["searchIntent", "primaryKeywords", "secondaryKeywords", "gaps", "questions"]
          }
        }
      ],
      tool_choice: { type: "tool", name: "generate_research_report" }
    });

    // 7. Extract the Tool Use payload from Claude's response
    const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    
    if (!toolUseBlock) {
      throw new Error("Claude failed to execute the required JSON structuring tool.");
    }

    const reportData = toolUseBlock.input as any;

    // 8. Assemble the final unified payload
    const researchData = {
      intent: reportData.searchIntent || "Informational",
      keywords: [
        ...(reportData.primaryKeywords || []).map((k: string) => ({ text: k, selected: true })),
        ...(reportData.secondaryKeywords || []).map((k: string) => ({ text: k, selected: false }))
      ],
      competitors: validScrapedResults, 
      questions: reportData.questions || [],
      gaps: reportData.gaps || []
    };
    
    // 9. Finalize Transaction & Deduct Credits
    await BillingGuard.deductCredits(userId, RESEARCH_COST, "RESEARCH");
    console.log(`[SUCCESS] Claude 3.5 Sonnet pipeline finalized. Deducted ${RESEARCH_COST} credit(s).`);

    return NextResponse.json({ data: researchData }, { status: 200 });

  } catch (error: any) {
    console.error("[RESEARCH_PIPELINE_CRITICAL_FAULT]:", error);
    return NextResponse.json({ 
      error: error.message || "An unexpected critical fault occurred during the research sequence." 
    }, { status: 500 });
  }
}