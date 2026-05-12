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
    const language: string = researchBlueprint.language || "en-US";
    const isTurkish = language.toLowerCase().includes("tr");

    const systemPrompt = `You are an expert SEO Content Architect. Create a comprehensive article outline for: "${researchBlueprint.keyword}".
TARGET LANGUAGE: ${language}

STRUCTURAL MANDATE — INTRO / BODY / CONCLUSION ARC:
The outline MUST follow this narrative flow for maximum readability and SEO performance:

PHASE 1 — INTRODUCTION (Section 1):
- requiredFormat: "paragraph"
- Hook the reader with a striking stat or problem statement.
- Define the topic scope clearly.
- Preview what the article covers.
- includeImage: true

PHASE 2 — BODY (Sections 2-5, the core value):
- Section 2: Data/research overview → requiredFormat: "html_table" (comparative data)
- Section 3: Core mechanism/how-it-works → requiredFormat: "bullet_list"
- Section 4: Advanced insights/strategies → requiredFormat: "key_points", includeImage: true
- Section 5: Real-world application/case context → requiredFormat: "blockquote"

PHASE 3 — CONCLUSION (Section 6):
- requiredFormat: "paragraph"
- Synthesize key takeaways, NOT a repeat of the intro.
- End with a clear call-to-action or forward-looking statement.
- includeImage: false

CRITICAL RULES:
1. ALL section titles in target language: ${language}
2. Section titles MUST be unique — zero overlap in meaning or topic.
3. Each title max 8 words. Punchy, specific, keyword-enriched where natural.
4. includeH3: true only for sections 3 and 4 (use H3 for 2-3 sub-points).
5. maxParagraphSentences: 1 for ALL sections — hard constraint.
6. entitiesToInclude: list 2-3 specific terms each section should reference.
7. NO generic titles like "Introduction", "Overview", "Conclusion" — make them descriptive.
8. At least 1 section title should be formatted as a question (PAA targeting).

Return ONLY a valid JSON object. NO markdown, NO explanation:
{
  "title": "Full Article Title (max 12 words, with primary keyword)",
  "sections": [
    {
      "headingLevel": "h2",
      "title": "Specific Section Title",
      "entitiesToInclude": ["term1", "term2"],
      "requiredFormat": "paragraph",
      "includeImage": false,
      "includeH3": false,
      "maxParagraphSentences": 1
    }
  ]
}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate the structured JSON outline now. Strictly follow the Intro/Body/Conclusion arc." }],
      temperature: 0.2,
    });

    const contentBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const rawText = (contentBlock?.text || "").replace(/```json/g, "").replace(/```/g, "").trim();

    let parsedOutline;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsedOutline = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
    } catch {
      throw new Error("Failed to parse JSON outline from model response.");
    }

    // Enforce exactly 6 sections with correct structure
    if (!parsedOutline.sections || parsedOutline.sections.length < 4) {
      throw new Error("Model returned insufficient sections.");
    }

    // Ensure all sections have maxParagraphSentences = 1
    parsedOutline.sections = parsedOutline.sections.map((s: any) => ({
      ...s,
      maxParagraphSentences: 1,
      entitiesToInclude: s.entitiesToInclude || [],
    }));

    return NextResponse.json({ outline: parsedOutline }, { status: 200 });
  } catch (error: any) {
    console.error("[OUTLINE_AGENT_ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}