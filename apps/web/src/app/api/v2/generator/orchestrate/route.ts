// apps/web/src/app/api/v2/generator/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeLanguage } from "@/lib/language";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// Section role types — drive narrative structure
// ---------------------------------------------------------------------------
type SectionRole = "intro" | "body" | "conclusion" | "faq" | "cta";

// ---------------------------------------------------------------------------
// Smart format assignment based on section title semantics
// Far more accurate than blind rotation.
// ---------------------------------------------------------------------------
function assignFormat(title: string, role: SectionRole, index: number): string {
  const t = title.toLowerCase();

  if (role === "intro") return "paragraph";
  if (role === "conclusion" || role === "cta") return "paragraph";
  if (role === "faq") return "bullet_list";

  // Question-style headings → paragraph (answer the question directly)
  if (t.match(/^(what|why|how|when|where|who|which|is |are |does |do |can |should )/)) return "paragraph";

  // Comparison / vs / best / top → table
  if (t.match(/\b(vs|versus|comparison|compare|difference|best|top \d|vs\.|ranked)\b/)) return "html_table";

  // Process / steps / how-to → bullet_list
  if (t.match(/\b(step|how to|process|stages|phases|checklist|guide|tips|ways|methods)\b/)) return "bullet_list";

  // Key takeaways / summary / benefits / advantages → key_points
  if (t.match(/\b(benefit|advantage|takeaway|key|summary|result|outcome|impact|roi)\b/)) return "key_points";

  // Expert opinion / insight / case / story → blockquote
  if (t.match(/\b(case study|insight|expert|opinion|example|story|real.world|lesson)\b/)) return "blockquote";

  // Statistics / data / numbers / benchmark → html_table
  if (t.match(/\b(statistic|data|number|metric|benchmark|kpi|cost|price|revenue|figure)\b/)) return "html_table";

  // Default: alternate between paragraph and bullet_list for variety
  return index % 2 === 0 ? "paragraph" : "bullet_list";
}

// ---------------------------------------------------------------------------
// Assign section role based on position and title semantics
// ---------------------------------------------------------------------------
function assignRole(title: string, index: number, total: number): SectionRole {
  const t = title.toLowerCase();
  if (index === 0) return "intro";
  if (index === total - 1) return "conclusion";
  if (t.match(/\b(faq|frequently|question|q&a|ask)\b/)) return "faq";
  if (t.match(/\b(get started|start|try|demo|contact|cta|next step|action)\b/)) return "cta";
  return "body";
}

// ---------------------------------------------------------------------------
// Match a PAA question to the most relevant section
// ---------------------------------------------------------------------------
function assignPAA(
  sectionTitle: string,
  questions: string[],
  usedQuestions: Set<number>
): string | null {
  if (!questions.length) return null;

  const titleWords = sectionTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  let bestIdx = -1;
  let bestScore = 0;

  questions.forEach((q, idx) => {
    if (usedQuestions.has(idx)) return;
    const qLower = q.toLowerCase();
    const score = titleWords.reduce((acc, w) => acc + (qLower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  // Only assign if there's a meaningful overlap — avoid random assignment
  if (bestIdx >= 0 && bestScore >= 1) {
    usedQuestions.add(bestIdx);
    return questions[bestIdx];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assign the most relevant content gap to a section
// ---------------------------------------------------------------------------
function assignGap(
  sectionTitle: string,
  gaps: string[],
  usedGaps: Set<number>
): string | null {
  if (!gaps.length) return null;

  const titleWords = sectionTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  let bestIdx = -1;
  let bestScore = 0;

  gaps.forEach((g, idx) => {
    if (usedGaps.has(idx)) return;
    const gLower = g.toLowerCase();
    const score = titleWords.reduce((acc, w) => acc + (gLower.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  if (bestIdx >= 0 && bestScore >= 1) {
    usedGaps.add(bestIdx);
    return gaps[bestIdx];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { researchBlueprint, sections } = await req.json();

    const keyword: string = researchBlueprint.keyword || "Topic";
    const language: string = researchBlueprint.language || "en-US";
    const questions: string[] = researchBlueprint.questions || [];
    const gaps: string[] = researchBlueprint.gaps || [];
    const searchIntent: string = researchBlueprint.searchIntent || "Informational";
    const total = sections.length;

    // ── Step 1: Assign roles, formats, PAA, gaps per section ───────────────
    const usedQuestions = new Set<number>();
    const usedGaps = new Set<number>();

    const enrichedSections = sections.map((s: any, i: number) => {
      const role = assignRole(s.title, i, total);
      const requiredFormat = assignFormat(s.title, role, i);
      const assignedPAA = assignPAA(s.title, questions, usedQuestions);
      const contentGap = assignGap(s.title, gaps, usedGaps);
      const prevTitle = i > 0 ? sections[i - 1].title : null;
      const nextTitle = i < total - 1 ? sections[i + 1].title : null;

      return {
        ...s,
        sectionRole: role,
        requiredFormat,
        assignedPAA,
        contentGap,
        prevSectionTitle: prevTitle,
        nextSectionTitle: nextTitle,
      };
    });

    // ── Step 2: Generate narrative thread with Claude ──────────────────────
    // One fast call to get the article's story arc — shared context for all sections
    const langRule = normalizeLanguage(language).isTurkish ? "Turkish" : "American English";

    const narrativeRes = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      temperature: 0.3,
      messages: [{
        role: "user",
        content: `You are an editorial director planning a high-quality ${langRule} article about "${keyword}".
Search intent: ${searchIntent}
Sections in order: ${sections.map((s: any, i: number) => `${i + 1}. ${s.title}`).join(" | ")}

Write a private editorial blueprint with THREE parts. Output ONLY valid JSON, no markdown:

{
  "narrativeThread": "3-4 sentences describing the reader's problem, the journey through the article, and the insight they leave with. Be specific to this exact topic — no generic filler.",
  "storySpine": "The article follows this arc: Section 1-2 establish the problem and why standard approaches fail. Section 3-4 reveal the root cause the reader hasn't considered. Section 5-6 present a practical path forward. Final section drives action. Each section must ADVANCE this arc — never restart from scratch.",
  "uniqueAngle": "In 1-2 sentences, state the single most differentiated angle this article takes that competitors miss. This MUST appear in the intro hook, at least one dedicated H2, and the conclusion. It is non-negotiable."
}`
      }],
    });

    const narrativeBlock = narrativeRes.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    let narrativeThread = "";
    let storySpine = "";
    let uniqueAngle = "";

    try {
      const raw = (narrativeBlock?.text || "").replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(raw);
      narrativeThread = parsed.narrativeThread || "";
      storySpine = parsed.storySpine || "";
      uniqueAngle = parsed.uniqueAngle || "";
    } catch {
      // Fallback: treat entire response as narrative thread
      narrativeThread = narrativeBlock?.text?.trim() || "";
    }

    // ── Step 3: Return enriched blueprint ─────────────────────────────────
    return NextResponse.json({
      narrativeThread,
      storySpine,
      uniqueAngle,
      enrichedSections,
    }, { status: 200 });

  } catch (error: any) {
    console.error("[ORCHESTRATE_ERROR]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}