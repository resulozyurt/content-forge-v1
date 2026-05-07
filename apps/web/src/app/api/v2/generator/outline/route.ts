import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { researchBlueprint } = await req.json();

    const systemPrompt = `You are an expert SEO Content Architect. Create an article outline for: "${researchBlueprint.keyword}".
TARGET LANGUAGE: ${researchBlueprint.language}

CRITICAL RULES:
1. NO DUPLICATES: Every section title MUST be 100% unique.
2. EXACTLY 4 SECTIONS: Keep it concise.
3. FORMAT: Include exactly 1 'html_table' section and 1 'bullet_list' section.
4. IMAGES: Alternate the 'includeImage' flag (true, false, true, false).

Return ONLY a valid JSON object matching this schema. NO MARKDOWN:
{
  "title": "Article Title",
  "sections": [
    {
      "headingLevel": "h2",
      "title": "Unique Section Title",
      "entitiesToInclude": ["term"],
      "requiredFormat": "paragraph", 
      "includeImage": true
    }
  ]
}`;

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6", // MODEL DÜZELTİLDİ
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: "Generate the JSON outline now." }],
        temperature: 0.2
    });

    const contentBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    let rawText = (contentBlock?.text || "").replace(/```json/g, '').replace(/```/g, '').trim();

    let parsedOutline;
    try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        parsedOutline = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
    } catch(e) {
        throw new Error("Failed to parse JSON.");
    }

    return NextResponse.json({ outline: parsedOutline }, { status: 200 });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}