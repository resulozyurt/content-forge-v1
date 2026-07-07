// apps/web/src/app/api/generate/outline/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeLanguage } from "@/lib/language";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Search intent detection — drives H2 count + depth decisions
// ---------------------------------------------------------------------------
function detectSearchIntent(topic: string): {
  intent: "informational" | "commercial" | "transactional";
  maxH2: number;
  allowDeepH3: boolean;
  depthLabel: string;
} {
  const t = topic.toLowerCase();

  // Commercial: comparison, best-of, reviews, alternatives
  if (/\b(vs|versus|comparison|compare|best|top \d|alternative|review|ranked|karşılaştırma|alternatif|en iyi|inceleme)\b/.test(t)) {
    return { intent: "commercial", maxH2: 6, allowDeepH3: true, depthLabel: "commercial comparison" };
  }

  // Transactional: software, tool, buy, pricing, platform
  if (/\b(software|tool|platform|app|pricing|buy|get|download|yazılım|araç|fiyat)\b/.test(t)) {
    return { intent: "transactional", maxH2: 5, allowDeepH3: false, depthLabel: "transactional product" };
  }

  // Informational: what is, how to, why, guide, tips
  return { intent: "informational", maxH2: 5, allowDeepH3: false, depthLabel: "informational guide" };
}

// ---------------------------------------------------------------------------
// Rotate approach angles so every re-generation is genuinely different
// ---------------------------------------------------------------------------
const OUTLINE_ANGLES = [
  "practical-how-to guide with actionable depth",
  "data-driven analysis with benchmark comparisons",
  "problem-solution framing with real-world context",
  "myth-busting and contrarian insights format",
  "beginner-friendly progression with clear milestones",
];

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
    }

    const { researchData, topic, language: rawLanguage, config, brandName, brandDesc, previousHeadings } =
      await req.json();

    if (!researchData || !topic) {
      return NextResponse.json({ error: "Missing research data or topic." }, { status: 400 });
    }

    // Canonical target language — independent of whatever string format the
    // caller sent. Every ${language} interpolation below now resolves to the
    // single source of truth, so AI-drafted headings can't drift languages.
    const language = normalizeLanguage(rawLanguage).label;

    // ── Intent detection — drives structure decisions ──────────────────────
    const { intent, maxH2, allowDeepH3, depthLabel } = detectSearchIntent(topic);

    // ── Dynamic angle rotation ─────────────────────────────────────────────
    const angleIndex = Math.floor(Math.random() * OUTLINE_ANGLES.length);
    const selectedAngle = OUTLINE_ANGLES[angleIndex];

    // ── Previous headings — force model to avoid them ──────────────────────
    const avoidBlock =
      (previousHeadings?.length ?? 0) > 0
        ? `\n\nPREVIOUSLY GENERATED HEADINGS — DO NOT REUSE ANY OF THESE:\n${previousHeadings
            .map((h: string) => `- ${h}`)
            .join("\n")}\nEvery heading in your output must differ conceptually from the list above.`
        : "";

    const competitorHeadings =
      researchData.competitors
        ?.map((c: any) => c.headings?.map((h: any) => h.text).join(" | "))
        .join("\n") || "";
    const paaQuestions =
      researchData.questions?.map((q: any) => q.text).join(", ") || "";

    // ── Brand instructions ─────────────────────────────────────────────────
    let brandInstruction = "";
    if (brandName?.trim()) {
      brandInstruction = `\nBRAND INTEGRATION: Weave "${brandName}" naturally into exactly ONE H2 or H3. Educational tone — not promotional.`;
    }
    let ownBrandInstruction = "";
    const isComparison =
      /\b(vs|versus|comparison|alternative|best|top|review|karşılaştırma|alternatif|en iyi|inceleme)\b/i.test(topic);
    if (brandName?.trim() && isComparison) {
      const desc = brandDesc?.trim() || "The leading solution in this category";
      ownBrandInstruction = `\nOWN BRAND FIRST: In the main listicle H2, place "${brandName}" as the FIRST H3 — labeled "${brandName} — ${desc.substring(0, 50)}".`;
    }

    // ── System prompt ──────────────────────────────────────────────────────
    const systemPrompt = `You are a Senior SEO Content Architect. Your job is to create a focused, reader-first article outline for: "${topic}".

DETECTED INTENT: ${depthLabel}
CONTENT APPROACH: ${selectedAngle}
TARGET LANGUAGE: ${language}
${avoidBlock}

════════ READER-FIRST PHILOSOPHY ════════
This article is written for a real person who searched for "${topic}".
They have a specific question or problem. Your outline must answer THAT question — nothing more, nothing less.
A shorter, focused outline that fully satisfies the reader ALWAYS beats a longer outline that overwhelms them.
═════════════════════════════════════════

[STRUCTURAL RULES]:

1. LANGUAGE
   All headings strictly in ${language}. Native phrasing — no translation artifacts.

2. H2 COUNT — HARD LIMIT
   Generate EXACTLY 4–${maxH2} H2 sections (intro + body + conclusion).
   Do NOT exceed ${maxH2} H2s regardless of topic complexity.
   If you feel the urge to add more — that content belongs in a separate article. Add it as a placeholder H3 instead.

3. SCOPE BOUNDARY TEST — APPLY TO EVERY H2
   Before finalizing each H2, ask: "Could this heading be the title of its own separate blog post?"
   → YES: Either remove it entirely, OR reduce it to a single mention inside an existing H2 (not a standalone section).
   → NO: Keep it as H2.
   This is the most important rule. Enforce it strictly.

4. READER JOURNEY TEST — APPLY TO EVERY H2
   Each H2 must answer: "What does the reader need to know RIGHT NOW to move forward?"
   → If the H2 answers a question the reader won't have until they read a more advanced article: REMOVE it.
   → If the H2 repeats an angle already covered by another H2: MERGE or REMOVE it.

5. H3 RULES — CLARIFY, DON'T EXPAND
   H3s are allowed ONLY when they CLARIFY the parent H2 — never to expand its scope.
   ✅ ALLOWED: "3 Core Components of X" → H3s: Component 1, Component 2, Component 3
   ❌ FORBIDDEN: "What is X" → H3s: "History of X", "Technical Architecture of X", "X in Enterprise Settings"
   ${allowDeepH3
      ? `This is a ${depthLabel} topic — H3s may go slightly deeper where direct comparison or feature breakdown is needed.`
      : `This is a ${depthLabel} topic — keep H3s tight. Max 2 H3s per H2. Each H3 under 7 words.`}
   H4s only if the H3 itself contains a discrete, enumerable sub-list (e.g. step-by-step process).

6. CONTENT FRESHNESS — NO GENERIC ANGLES
   The following H2 types are BANNED unless directly required by the PAA data:
   - "What is [Topic]" as the first H2 (use the intro section for this instead)
   - "History of [Topic]" or "Evolution of [Topic]"
   - "Why [Topic] Matters" or "Benefits of [Topic]" as standalone H2s (weave these into other sections)
   - "Future of [Topic]" or "Trends in [Topic]" unless the keyword is explicitly about trends
   - "Common Mistakes" or "Best Practices" as generic catch-alls

7. HEADING QUALITY
   - Max 9 words per heading.
   - At least 25% of H2s phrased as PAA questions (use the provided PAA data).
   - Zero overlap in meaning between any two headings.
   - Specific > generic: "3 Proven Ways to Cut Field Audit Time" beats "Improving Audit Efficiency".

8. LOGICAL ARC
   Section 1 (intro): Frame the problem/opportunity. Hook with a stat or consequence.
   Sections 2–${maxH2 - 1} (body): Each section moves the reader ONE step forward. No backtracking.
   Section ${maxH2} (conclusion): Synthesize + action. Never a summary of the intro.
${brandInstruction}${ownBrandInstruction}

════════ DIMINISHING RETURNS CHECK ════════
Before finalizing: read all H2s in order. If removing the last H2 doesn't leave a gap in the reader's understanding → remove it.
If two H2s feel like they cover the same territory from slightly different angles → merge them.
The goal: a reader finishes this article feeling satisfied, not exhausted.
════════════════════════════════════════════`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Competitor heading structures for reference (do NOT copy — use to identify gaps):\n${competitorHeadings}\n\nPAA queries to incorporate:\n${paaQuestions}\n\nGenerate a focused, reader-first outline for "${topic}" in ${language}.\nApproach: "${selectedAngle}"\nIntent: ${depthLabel}\nRemember: ${maxH2} H2s maximum. Scope boundary test on every H2.`,
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
                      description: "Punchy, specific heading. Max 9 words.",
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