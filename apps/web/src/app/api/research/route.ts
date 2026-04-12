// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth"; // Adjust the import path based on your project structure
import { BillingGuard } from "@/lib/billing"; // Adjust the import path
import OpenAI from "openai";
import * as cheerio from "cheerio";

const openai = new OpenAI();
export const maxDuration = 60; // Vercel execution timeout limit

interface ScrapedData {
  url: string;
  title: string;
  wordCount: number;
  headings: { level: string; text: string }[];
}

export async function POST(req: Request) {
  try {
    // 1. Authentication & Session Validation
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized access. Please log in to continue." },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id;
    const RESEARCH_COST = 1; // Deduct 1 credit for the research phase

    // 2. Billing Guard: Check if the user has enough credits before any API calls
    await BillingGuard.checkCredits(userId, RESEARCH_COST);

    const { topic, config } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: "A valid research topic is required." },
        { status: 400 }
      );
    }

    const serperApiKey = process.env.SERPER_API_KEY;
    if (!serperApiKey) {
      console.error("[CRITICAL] SERPER_API_KEY is missing from environment variables.");
      return NextResponse.json(
        { error: "Internal server error regarding search configuration." },
        { status: 500 }
      );
    }

    const language = config?.language || "English";
    const contentDepth = config?.depth || "Comprehensive";
    
    console.log(`[STAGE 1] Fetching live SERP data for topic: "${topic}"...`);

    // 3. Fetch Google SERP Data via Serper.dev
    const serperResponse = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: topic,
        num: 10, // Fetch the top 10 organic results
      }),
    });

    if (!serperResponse.ok) {
      throw new Error("Failed to retrieve data from the search provider.");
    }

    const serperData = await serperResponse.json();
    
    if (!serperData.organic || serperData.organic.length === 0) {
      return NextResponse.json(
        { error: "No organic search results found for this topic." },
        { status: 404 }
      );
    }

    const topUrls = serperData.organic.map((res: any) => res.link).slice(0, 10);
    console.log(`[STAGE 2] Located ${topUrls.length} URLs. Initializing parallel scraping...`);

    // 4. Scrape individual URLs concurrently
    const scrapePromises = topUrls.map(async (url: string) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second hard timeout per URL

        const response = await fetch(url, { 
          signal: controller.signal,
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
          }
        });
        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const html = await response.text();
        const $ = cheerio.load(html);

        // Strip out noisy elements to calculate an accurate word count
        $("script, style, noscript, iframe, img, svg, nav, footer, header, aside").remove();
        const textContent = $("body").text().replace(/\s+/g, " ").trim();
        const wordCount = textContent.split(" ").length;

        const headings: { level: string; text: string }[] = [];
        $("h1, h2, h3").each((_, el) => {
          const text = $(el).text().trim();
          // Filter out extremely short or excessively long headings (likely navigation or junk)
          if (text.length > 5 && text.length < 150) {
            headings.push({
              level: el.tagName.toLowerCase(),
              text: text
            });
          }
        });

        const pageTitle = $("title").text() || url;

        return {
          url,
          title: pageTitle.substring(0, 60),
          wordCount,
          headings: headings.slice(0, 20) // Cap at 20 headings to avoid token bloat
        } as ScrapedData;

      } catch (err) {
        // Silently ignore failed fetches (CORS, anti-bot defenses, timeouts) to keep the pipeline moving
        return null;
      }
    });

    const scrapedResultsRaw = await Promise.all(scrapePromises);
    const validScrapedResults = scrapedResultsRaw.filter(Boolean) as ScrapedData[];

    if (validScrapedResults.length === 0) {
      return NextResponse.json(
        { error: "Unable to parse competitor sites. They may be protected by anti-bot measures." },
        { status: 422 }
      );
    }

    console.log(`[STAGE 3] Successfully scraped ${validScrapedResults.length} competitors. Passing data to the NLP engine...`);

    // 5. Pass scraped data to OpenAI for NLP Analysis
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
          1. The output language for the analysis MUST be: ${language}.
          2. Use American English spelling and phrasing natively if the target language is English.
          3. Analyze the competitor headings to extract highly relevant LSI/NLP keywords.
          4. Return EXACTLY the competitors provided in the user prompt; do NOT hallucinate new ones.
          5. Content depth context: ${contentDepth}. Provide comprehensive keyword coverage based on this.`
        },
        {
          role: "user",
          content: `Here is the live SERP data for the query "${topic}":\n\n${JSON.stringify(validScrapedResults, null, 2)}`
        }
      ],
      temperature: 0.5,
    });

    const rawContent = completion.choices[0].message.content;
    
    if (!rawContent) {
      throw new Error("Failed to receive a valid response from the NLP engine.");
    }

    const researchData = JSON.parse(rawContent);
    
    // 6. Billing Guard: Deduct credits only after a fully successful operation
    await BillingGuard.deductCredits(userId, RESEARCH_COST);
    console.log(`[SUCCESS] Research pipeline complete. Deducted ${RESEARCH_COST} credit(s) from user ${userId}.`);

    return NextResponse.json({ data: researchData }, { status: 200 });

  } catch (error: any) {
    console.error("[RESEARCH_PIPELINE_ERROR]:", error);
    return NextResponse.json(
      { error: error.message || "An unexpected error occurred during the research phase." },
      { status: 500 }
    );
  }
}