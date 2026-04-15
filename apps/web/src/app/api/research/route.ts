// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

// Initialize the Anthropic SDK to leverage Claude's deep context window
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export const maxDuration = 300; 

export interface ScrapedData {
  id: string;
  url: string;
  title: string;
  wordCount: number;
  headings: { level: string; text: string }[];
  bodyText: string; 
}

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
    
    const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
    const limiter = await rateLimit(`research_${userId}_${ip}`, 20, 60 * 60 * 1000); 

    if (!limiter.success) {
        return NextResponse.json(
            { error: "Research quota exceeded. Please wait before starting new research." }, 
            { status: 429, headers: getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) }
        );
    }

    const RESEARCH_COST = 1;
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
    
    console.log(`[PIPELINE_INIT] Fetching live SERP data for primary keyword: "${topic}"...`);

    // 3. Procure Google SERP Data (Fetch top 30 to establish a filtering buffer)
    const serperResponse = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: topic, num: 30 }), 
    });

    if (!serperResponse.ok) throw new Error("Failed to retrieve data from the primary search provider.");
    const serperData = await serperResponse.json();
    
    if (!serperData.organic || serperData.organic.length === 0) {
      return NextResponse.json({ error: "No organic search results found for the specified query." }, { status: 404 });
    }

    // 4. Strict Domain Filtering Architecture (Remove Non-Blog/Junk Targets)
    const JUNK_DOMAINS = [
      "youtube.com", "youtu.be", "pinterest.com", "reddit.com", "quora.com",
      "g2.com", "capterra.com", "trustpilot.com", "softwareadvice.com", "getapp.com",
      "amazon.", "ebay.", "etsy.com", "walmart.com", 
      "facebook.com", "twitter.com", "instagram.com", "tiktok.com", "linkedin.com",
      "wikipedia.org", "yelp.com", "tripadvisor.com"
    ];

    const cleanUrls = serperData.organic
      .map((res: any) => res.link)
      .filter((url: string) => {
        const lowerUrl = url.toLowerCase();
        return !JUNK_DOMAINS.some(domain => lowerUrl.includes(domain));
      });

    // Select the top 12 high-quality blog/article URLs for scraping
    const targetUrls = cleanUrls.slice(0, 12);
    console.log(`[SCRAPE_INIT] Identified ${targetUrls.length} high-quality target URLs. Initializing concurrent workers...`);

    if (targetUrls.length === 0) {
        return NextResponse.json({ error: "Search results only contained blacklisted directory or social media sites. Please refine the query." }, { status: 422 });
    }

    // 5. Concurrent Web Scraping with Fault Tolerance
    const scrapePromises = targetUrls.map(async (url: string, index: number) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10-second hard timeout

      const html = await fetchWithScrapingInfrastructure(url, controller.signal);
      clearTimeout(timeoutId);

      if (!html) return null;

      try {
        const $ = cheerio.load(html);

        // Aggressive DOM sanitization to isolate core article content
        $("script, style, noscript, iframe, img, svg, nav, footer, header, aside, .sidebar, .comments, .advertisement, form, button").remove();
        
        const textContent = $("body").text().replace(/\s+/g, " ").trim();
        const wordCount = textContent.split(" ").length;

        if (wordCount < 200) return null; // Skip low-value "thin content" pages

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
          bodyText: textContent.substring(0, 4000) 
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
        error: "Unable to parse competitor content. Targets may be protected by aggressive anti-bot measures." 
      }, { status: 422 });
    }

    console.log(`[NLP_ROUTING] Successfully extracted data for ${validScrapedResults.length} elite competitors. Executing Claude Tool Use...`);

    // 6. Constructing the Context payload (Limit to Top 8 for optimal context window efficiency)
    const competitorContext = validScrapedResults.slice(0, 8).map(c => 
      `--- Competitor: ${c.title} ---\nHeadings: ${c.headings.map(h => h.text).join(", ")}\nContent Snippet: ${c.bodyText}`
    ).join("\n\n");

    // 7. CLAUDE - Tool Use Execution for strict schema adherence
    const anthropicResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      temperature: 0.2, 
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

    const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    
    if (!toolUseBlock) {
      throw new Error("Claude failed to execute the required JSON structuring tool.");
    }

    const reportData = typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input as any;

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
    console.log(`[SUCCESS] Claude pipeline finalized. Deducted ${RESEARCH_COST} credit(s).`);

    return NextResponse.json({ data: researchData }, { status: 200 });

  } catch (error: any) {
    console.error("[RESEARCH_PIPELINE_CRITICAL_FAULT]:", error);
    return NextResponse.json({ 
      error: error.message || "An unexpected critical fault occurred during the research sequence." 
    }, { status: 500 });
  }
}