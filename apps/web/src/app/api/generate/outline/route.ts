// apps/web/src/app/api/generate/outline/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Rotate approach angles so every re-generation is genuinely different
// ---------------------------------------------------------------------------
const OUTLINE_ANGLES = [
  "practical-how-to guide with step-by-step depth",
  "data-driven analysis with benchmark comparisons",
  "problem-solution framing with real-world case context",
  "beginner-to-expert progression with increasing complexity",
  "myth-busting and contrarian insights format",
];

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
    }

    const { researchData, topic, language, config, brandName, brandDesc, previousHeadings } =
      await req.json();

    if (!researchData || !topic) {
      return NextResponse.json({ error: "Missing research data or topic." }, { status: 400 });
    }

    // ── Dynamic angle rotation ─────────────────────────────────────────────
    const angleIndex = Math.floor(Math.random() * OUTLINE_ANGLES.length);
    const selectedAngle = OUTLINE_ANGLES[angleIndex];

    // ── Previous headings — force model to avoid them ──────────────────────
    const avoidBlock =
      previousHeadings && previousHeadings.length > 0
        ? `\n\nPREVIOUSLY GENERATED HEADINGS — DO NOT REUSE ANY OF THESE:\n${previousHeadings
            .map((h: string) => `- ${h}`)
            .join("\n")}\nEvery single heading in your new output must differ conceptually from the list above.`
        : "";

    const competitorHeadings =
      researchData.competitors
        ?.map((c: any) => c.headings?.map((h: any) => h.text).join(" | "))
        .join("\n") || "";
    const paaQuestions =
      researchData.questions?.map((q: any) => q.text).join(", ") || "";

    const targetWords = parseInt(config?.targetLength || "1500", 10);
    // Rich depth: more H2s and always add H3s
    const maxH2Count = Math.max(5, Math.floor(targetWords / 220));
    const minH2Count = Math.max(4, maxH2Count - 2);

    // ── Brand instructions ─────────────────────────────────────────────────
    let brandInstruction = "";
    if (brandName?.trim()) {
      brandInstruction = `\n7. BRAND INTEGRATION: Weave "${brandName}" naturally into exactly ONE H2 or H3. Educational tone — not promotional.`;
    }
    let ownBrandInstruction = "";
    const isComparison =
      /\b(vs|versus|comparison|alternative|best|top|review|karşılaştırma|alternatif|en iyi|inceleme)\b/i.test(
        topic
      );
    if (brandName?.trim() && isComparison) {
      const desc = brandDesc?.trim() || "The leading solution in this category";
      ownBrandInstruction = `\n8. OWN BRAND FIRST: In the main listicle H2, place "${brandName}" as the FIRST H3 — labeled "${brandName} — ${desc.substring(0, 50)}".`;
    }

    // ── System prompt ──────────────────────────────────────────────────────
    const systemPrompt = `You are a Senior SEO Content Architect. Engineer a comprehensive, deeply structured article outline for: "${topic}".
CONTENT APPROACH THIS RUN: ${selectedAngle}
TARGET LANGUAGE: ${language}
${avoidBlock}

[STRUCTURAL RULES]:
1. LANGUAGE: All headings strictly in ${language}. Native phrasing — no translation feel.
2. VOLUME: Generate EXACTLY ${minH2Count}–${maxH2Count} H2 sections.
3. DEPTH — MANDATORY H3s: Every H2 must have 2–4 H3 sub-headings. Explanatory guides also get H3s.
   - For high-complexity H2s (processes, comparisons): also add H4s inside relevant H3s.
4. ZERO FLUFF: Headings must be specific, punchy, under 9 words.
5. FEATURED SNIPPET TARGETING: At least 30% of H2s phrased as PAA questions.
6. LOGICAL ARC: Introduction Hook → Core Concepts → Data & Benchmarks → Actionable Steps → Advanced Strategies → Conclusion + FAQ.
7. UNIQUENESS: No two headings can share the same core meaning or keyword angle.
8. H3 SPECIFICITY: H3s must go deeper than the H2 — each covering a distinct sub-angle, not a restatement.${brandInstruction}${ownBrandInstruction}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      // Higher temperature ensures variety on re-generation
      temperature: 0.85,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Competitor heading structures:\n${competitorHeadings}\n\nPAA queries:\n${paaQuestions}\n\nGenerate the ${selectedAngle} outline for "${topic}" in ${language}. Remember: approach = "${selectedAngle}".`,
        },
      ],
      tools: [
        {
          name: "generate_seo_outline",
          description: "Outputs the full H2/H3/H4 outline array.",
          input_schema: {
            type: "object",
            properties: {
              headings: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    level: { type: "string", enum: ["h2", "h3", "h4"] },
                    text: {
                      type: "string",
                      description: "Punchy heading. Max 9 words.",
                    },
                  },
                  required: ["level", "text"],
                },
              },
            },
            required: ["headings"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "generate_seo_outline" },
    });

    const toolUseBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolUseBlock) throw new Error("Model failed to return a structured outline.");

    const parsed =
      typeof toolUseBlock.input === "string"
        ? JSON.parse(toolUseBlock.input)
        : toolUseBlock.input;

    return NextResponse.json({ outline: parsed.headings }, { status: 200 });
  } catch (error: any) {
    console.error("[OUTLINE_GENERATION_FAULT]:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error during outline generation." },
      { status: 500 }
    );
  }
}