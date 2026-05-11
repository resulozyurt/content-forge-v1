// apps/web/src/app/api/v2/generator/outline/route.ts
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

    const systemPrompt = `You are an expert SEO Content Architect. Create a comprehensive article outline for: "${researchBlueprint.keyword}".
TARGET LANGUAGE: ${researchBlueprint.language}

CRITICAL RULES:
1. NO DUPLICATES: Every section title MUST be 100% unique.
2. EXACTLY 6 SECTIONS: Provide rich, skimmable content.
3. FORMAT VARIETY (mandatory distribution):
   - Exactly 1 section with requiredFormat: "html_table"
   - Exactly 2 sections with requiredFormat: "bullet_list"
   - Exactly 1 section with requiredFormat: "key_points" (3-5 bold takeaways in <ul>)
   - Exactly 1 section with requiredFormat: "blockquote" (expert quote + paragraph)
   - Exactly 1 section with requiredFormat: "paragraph"
4. IMAGES: Set includeImage: true for sections 1, 3, and 5 only.
5. PARAGRAPH CONSTRAINT: Every section must have a maxParagraphSentences value of 1. Hard rule: one sentence per <p> tag.
6. SUB-HEADINGS: Set includeH3: true for sections that benefit from 2-3 sub-points.

Return ONLY a valid JSON object matching this schema. NO MARKDOWN WRAPPERS:
{
  "title": "Article Title",
  "sections": [
    {
      "headingLevel": "h2",
      "title": "Unique Section Title",
      "entitiesToInclude": ["term1", "term2"],
      "requiredFormat": "paragraph",
      "includeImage": true,
      "includeH3": false,
      "maxParagraphSentences": 1
    }
  ]
}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate the JSON outline now." }],
      temperature: 0.2,
    });

    const contentBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    let rawText = (contentBlock?.text || "").replace(/```json/g, "").replace(/```/g, "").trim();

    let parsedOutline;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsedOutline = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
    } catch (e) {
      throw new Error("Failed to parse JSON outline.");
    }

    return NextResponse.json({ outline: parsedOutline }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}