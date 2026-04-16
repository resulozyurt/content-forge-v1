import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database"; 

// Strict validation schema for the incoming payload
const requestSchema = z.object({
  seedKeyword: z.string().min(2, "Keyword is too short").max(100, "Keyword is too long"),
});

// System prompt strictly formatted for JSON output
const KEYWORD_LAB_SYSTEM_PROMPT = `
You are an expert SEO strategist. When given a seed keyword, you return ONLY a valid JSON object.
No explanation, no markdown, no preamble. Only raw JSON.

The JSON structure must follow this exact schema:
{
  "clusterKeywords": [
    { "keyword": "string", "intent": "informational" | "commercial" | "transactional" }
  ],
  "seoOpportunities": [
    { "keyword": "string", "type": "long-tail" | "lsi" | "question", "format": "string", "competition": "low" | "medium" | "high" }
  ],
  "aiOverviewKeywords": [
    { "keyword": "string", "reason": "string" }
  ],
  "topicIdeas": [
    { "title": "string", "targetAudience": "string", "angle": "string", "format": "guide" | "comparison" | "case-study" | "listicle" | "tutorial" }
  ],
  "tacticalTips": [
    { "tip": "string", "category": "on-page" | "technical" | "ai-optimization" }
  ]
}
`;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload provided" }, { status: 400 });
    }

    const { seedKeyword } = parsed.data;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      temperature: 0.1,
      system: KEYWORD_LAB_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Seed Keyword: "${seedKeyword}"`,
        },
      ],
    });

    const textResponse = message.content[0].type === "text" ? message.content[0].text : "";
    let jsonResponse;
    
    try {
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      const rawJson = jsonMatch ? jsonMatch[0] : textResponse;
      jsonResponse = JSON.parse(rawJson);
    } catch (parseError) {
      return NextResponse.json({ error: "AI returned malformed data" }, { status: 500 });
    }

    // NEW: Save the valid response to the KeywordSession table
    // This allows users to revisit their analysis in the future
    const savedSession = await prisma.keywordSession.create({
      data: {
        userId: session.user.id,
        seedKeyword: seedKeyword,
        results: jsonResponse,
      },
    });

    return NextResponse.json({
      id: savedSession.id,
      ...jsonResponse
    }, { status: 200 });

  } catch (error) {
    console.error("Keyword Lab API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}