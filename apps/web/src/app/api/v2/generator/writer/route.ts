// apps/web/src/app/api/v2/generator/writer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeLanguage } from "@/lib/language";
import { getContentTypeInstruction } from "@/lib/content-types";
import { buildAudienceInstruction } from "@/lib/audiences";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// TABLE BUG FIX (root cause): Claude occasionally hits max_tokens mid-<table>
// (especially html_table format + subheadings, which can exceed the token
// budget). The resulting HTML has an unclosed <table>/<tbody>/<tr>/<td> chain.
// When that string is later concatenated with subsequent sections and parsed
// by the browser's HTML5 parser (DOMPurify.sanitize / TipTap setContent),
// the parser's "in cell" insertion mode keeps swallowing all following
// content into that still-open last <td> — which is exactly the reported
// symptom: "content after the table goes into the table's last row."
//
// Fix: generically close any unclosed tag at the end of the generated HTML
// using a stack-based scan. This is the FIRST of three defense layers
// (writer → editor → useContentEngine all apply this same repair).
// ---------------------------------------------------------------------------
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function closeUnclosedHtmlTags(html: string): string {
  if (!html) return html;
  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2].toLowerCase();
    const isSelfClosing = match[3] === "/";

    if (VOID_TAGS.has(tagName) || isSelfClosing) continue;

    if (isClosing) {
      // Pop the nearest matching open tag (tolerant of minor mis-nesting —
      // we care about catching leftover-open structural tags, not full
      // strict HTML validation).
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      stack.push(tagName);
    }
  }

  if (stack.length === 0) return html;

  const closingTags = stack.reverse().map((t) => `</${t}>`).join("");
  console.warn(`[HTML_REPAIR][writer] Unclosed tag(s) auto-closed: ${stack.join(", ")}`);
  return html + closingTags;
}

// ---------------------------------------------------------------------------
// NOTE: Image generation lives in /api/v2/generator/image-generate/route.ts
// (called sequentially by useContentEngine, with retry/backoff on 429).
// The writer only emits an imagePrompt + a placeholder <figure>; it does NOT
// call Gemini directly. The old generateImageWithGemini() here was dead code.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Citation pool reader — reads from pre-fetched citations in research blueprint.
// No Serper call here — saves ~$0.30/article vs per-section fetching.
// ---------------------------------------------------------------------------
interface Citation { url: string; label: string }

const STATIC_CITATION_FALLBACKS: Citation[] = [
  { url: "https://www.mckinsey.com/capabilities/operations/our-insights", label: "McKinsey & Company" },
  { url: "https://www.statista.com/topics/market-research", label: "Statista" },
  { url: "https://www.ibm.com/think/topics/ai-for-business", label: "IBM Institute for Business Value" },
  { url: "https://www.deloitte.com/global/en/about/press-room/deloitte-insights.html", label: "Deloitte Insights" },
  { url: "https://www.gartner.com/en/newsroom/press-releases", label: "Gartner" },
  { url: "https://hbr.org/topic/subject/strategy", label: "Harvard Business Review" },
];

function getCitationFromPool(
  pool: Citation[],
  sectionIndex: number,
  offset: number = 0
): Citation {
  if (!pool || pool.length === 0) {
    return STATIC_CITATION_FALLBACKS[(sectionIndex + offset) % STATIC_CITATION_FALLBACKS.length];
  }
  const idx = ((sectionIndex * 3) + offset) % pool.length;
  return pool[idx];
}

// ---------------------------------------------------------------------------
// Format instructions per section type
// SORUN 2 FIX: "By the Numbers" callout artık sadece paragraph formatında
// VE sectionIndex > 0 olduğunda ekleniyor. Her section'da çıkmasın diye
// fonksiyona sectionIndex parametresi eklendi.
// ---------------------------------------------------------------------------
function getFormatInstruction(
  requiredFormat: string,
  maxS: number = 2,
  sectionIndex: number = 0
): string {
  switch (requiredFormat) {
    case "html_table":
      return `OUTPUT FORMAT — DATA TABLE:
- ONE intro <p> (max 15 words). Then a <table> with <thead>/<tbody>.
- Min 5 rows, 3–4 columns. REAL benchmark data (%, $, timeframes).
- After table: ONE citation <p>.
- If subheadings are provided, render each as an <h3> with its own mini-table or paragraph BEFORE the main table.`;

    case "bullet_list":
      return `OUTPUT FORMAT — BULLET LIST:
- ONE intro <p> (max 1 sentence, 15 words). Then <ul> with 4–6 <li> items.
- Each <li>: <strong>Bold Term:</strong> ONE sentence (max 18 words). No topic overlap.
- If subheadings are provided, render each as <h3 style="font-size:1.15em;font-weight:700;margin:22px 0 8px;color:#1e293b;">[subheading]</h3> followed by its own <ul> with 2–3 <li> items.`;

    case "key_points":
      return `OUTPUT FORMAT — KEY TAKEAWAYS:
- No intro paragraph. Render styled takeaway cards:
<ul style="list-style:none;padding:0;margin:0;">
  <li style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 14px;margin:0 0 10px;border-radius:0 6px 6px 0;">
    <strong style="display:block;color:#1d4ed8;margin-bottom:3px;">Short Takeaway (max 6 words)</strong>
    <span style="color:#374151;font-size:0.9em;">One sentence with a specific stat. Max 20 words.</span>
  </li>
</ul>
- Minimum 3 cards, maximum 5 cards.
- If subheadings are provided, group cards under <h3 style="font-size:1.15em;font-weight:700;margin:22px 0 8px;color:#1e293b;">[subheading]</h3> separators.`;

    case "blockquote":
      return `OUTPUT FORMAT — EXPERT QUOTE:
- ONE context <p> (max 2 sentences, 30 words total).
- ONE styled blockquote:
<blockquote style="border-left:4px solid #6366f1;background:#f5f3ff;padding:18px 22px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="font-style:italic;font-size:1.05em;color:#3730a3;margin:0 0 10px 0;">"[Expert insight with a specific stat. Max 40 words.]"</p>
  <cite style="font-weight:700;font-style:normal;color:#6366f1;font-size:0.85em;">— Name, Title/Publication, Year</cite>
</blockquote>
- ONE closing <p> (max 2 sentences, 25 words).
- If subheadings are provided, render each as <h3> with its own blockquote.`;

    default: {
      // SORUN 2 FIX: "By the Numbers" callout sadece body section'larda (index > 0)
      // gösterilsin. Intro (index=0) ve conclusion bu callout'u almaz.
      const byTheNumbers = sectionIndex > 0
        ? `\n- After the last <p>, add ONE styled callout:
<div style="background:#faf5ff;border-left:4px solid #8b5cf6;padding:14px 18px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 4px;font-weight:700;color:#8b5cf6;font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;">📊 By the Numbers</p>
  <p style="margin:0;color:#1f2937;font-size:0.95em;line-height:1.6;">[One specific stat — max 20 words]</p>
</div>`
        : "\n- Do NOT add a 'By the Numbers' callout in this section.";

      return `OUTPUT FORMAT — SHORT PARAGRAPHS:
- EXACTLY 2–3 <p> blocks. Each <p>: MAX ${maxS} sentences. ABSOLUTE HARD LIMIT.
- Lead with the most critical fact. Use <strong> for 1–2 key data points. Include ONE specific stat.${byTheNumbers}
- If subheadings are provided, render each as <h3 style="font-size:1.15em;font-weight:700;margin:22px 0 8px;color:#1e293b;">[subheading]</h3> followed by 1–2 <p> blocks.`;
    }
  }
}

function getLangRule(language: string): string {
  // Hard, heading-overriding language directive from the single source of
  // truth. Returning promptRule (not a soft one-liner) is what stops a
  // foreign-language section title from dragging the body into that language.
  return normalizeLanguage(language).promptRule;
}

// ---------------------------------------------------------------------------
// Lead summary — first section only
// SORUN 1 FIX (final): Claude artık HTML üretmiyor — sadece 4 kısa metin
// parçası üretiyor (hook + 3-4 bullet + bottom line). Bu metinler statik
// HTML şablonuna TypeScript tarafında enjekte ediliyor.
// Böylece tag kapanma hatası imkansız hale geliyor.
// ---------------------------------------------------------------------------
async function generateLeadSummary(
  keyword: string, articleTitle: string, sections: string[], language: string
): Promise<string> {
  const isTr = normalizeLanguage(language).isTurkish;

  const sectionCount = sections.length;
  const estWords     = sectionCount * 250;
  const readingMins  = Math.max(3, Math.round(estWords / 238));
  const readingLabel = isTr ? `${readingMins} dakika okuma` : `${readingMins} min read`;
  const sectionLabel = isTr ? "✦ Temel Çıkarımlar" : "✦ Key Takeaways";
  const coverLabel   = isTr ? "Bu makalede:" : "In this article:";
  const bottomLabel  = isTr ? "Ana sonuç:" : "Key takeaway:";

  // Claude sadece JSON üretiyor — HTML yok, tag yok
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 400, temperature: 0.4,
    messages: [{ role: "user", content:
      `You are writing a lead summary for an article about "${keyword}".
Sections: ${sections.slice(0, 8).join(" | ")}
Language: ${language}

Return ONLY valid JSON. No markdown, no explanation, no code fences.

{
  "hook": "ONE sentence starting with a number or surprising fact. Include %, $, or multiplier. Max 22 words. Specific to '${keyword}'.",
  "bullets": [
    "Key insight 1 — max 10 words. Data point or consequence.",
    "Key insight 2 — max 10 words. Different angle from #1.",
    "Key insight 3 — max 10 words. Actionable or surprising."
  ],
  "bottomLine": "ONE opinionated sentence. The single most important takeaway. Max 18 words. No hedge words."
}

RULES:
- bullets: 3 items minimum, 4 maximum. Each must cover a DIFFERENT angle.
- hook must include a real number, %, or multiplier.
- bottomLine must NOT restate the hook.
${getLangRule(language)}` }],
  });

  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  const rawText = (block?.text || "").replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let hook = "";
  let bullets: string[] = [];
  let bottomLine = "";

  try {
    const parsed = JSON.parse(rawText);
    hook       = parsed.hook || "";
    bullets    = Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 4) : [];
    bottomLine = parsed.bottomLine || "";
  } catch {
    // Fallback: return minimal summary if JSON parse fails
    console.warn("[LEAD_SUMMARY] JSON parse failed — using fallback");
    hook = `${keyword} is shaping how businesses operate in measurable ways.`;
    bullets = ["Understanding this topic gives you a measurable advantage.", "Most teams overlook the key factors covered here."];
    bottomLine = "The frameworks in this article are ready to apply immediately.";
  }

  // Article map — rendered as plain <li> list (TipTap-safe, no <details>)
  const mapItems = sections
    .slice(0, 6)
    .map((s) => `<li style="color:#374151;margin:0 0 4px 0;font-size:0.87em;line-height:1.5;list-style:none;padding-left:0;">${s}</li>`)
    .join("\n      ");

  // Bullet items — assembled in TypeScript, no Claude HTML generation
  const bulletItems = bullets
    .map((b) => `<li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;list-style:none;">
        <span style="color:#6366f1;font-weight:700;font-size:1em;flex-shrink:0;line-height:1.5;">→</span>
        <span style="color:#374151;font-size:0.95em;line-height:1.5;"><strong>${b}</strong></span>
      </li>`)
    .join("\n      ");

  // Full HTML assembled in TypeScript — no Claude-generated tags
  return `<div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:12px;padding:24px 28px;margin:20px 0 32px;">
  <p style="font-size:0.72em;font-weight:800;color:#6366f1;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 12px 0;">${sectionLabel} · ${readingLabel}</p>
  <p style="font-size:1.08em;color:#1e293b;line-height:1.7;margin:0 0 16px 0;"><strong style="color:#1d4ed8;">${hook}</strong></p>
  <ul style="margin:0 0 20px 0;padding:0;">
      ${bulletItems}
  </ul>
  <div style="margin-bottom:16px;">
    <p style="font-size:0.78em;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 8px 0;">${coverLabel}</p>
    <ul style="margin:0;padding:0;">
      ${mapItems}
    </ul>
  </div>
  <p style="margin:0;font-size:0.9em;color:#374151;border-top:1px solid #c7d2fe;padding-top:14px;line-height:1.6;"><strong style="color:#1d4ed8;">${bottomLabel}</strong> ${bottomLine}</p>
</div>`;
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { researchBlueprint, sectionPlan, sectionIndex, allSectionTitles } = await req.json();
    const language: string           = researchBlueprint.language || "en-US";
    const keyword: string            = researchBlueprint.keyword || "Topic";
    const contentType: string        = researchBlueprint.contentType || "blog_post";
    const articleTitle: string       = researchBlueprint.articleTitle || keyword;
    const selectedKeywords: string[] = researchBlueprint.selectedKeywords || [];
    const audienceInstruction        = buildAudienceInstruction(researchBlueprint.targetAudience, researchBlueprint.customTargetAudience);
    const isFirstSection             = sectionIndex === 0;
    const subHeadings: string[]      = sectionPlan.subHeadings || [];
    const brand                      = researchBlueprint.brandGuidelines || {};
    const brandEnabled: boolean      = brand.isEnabled === true;
    const brandName: string          = brand.brandName || "";
    const brandCta: string           = brand.callToAction || "";

    // Narrative context from orchestrator
    const narrativeThread: string    = researchBlueprint.narrativeThread || "";
    const storySpine: string         = researchBlueprint.storySpine || "";
    const uniqueAngle: string        = researchBlueprint.uniqueAngle || "";
    const sectionRole: string        = sectionPlan.sectionRole || "body";
    const assignedPAA: string|null   = sectionPlan.assignedPAA || null;
    const contentGap: string|null    = sectionPlan.contentGap || null;
    const prevTitle: string|null     = sectionPlan.prevSectionTitle || null;
    const nextTitle: string|null     = sectionPlan.nextSectionTitle || null;
    const prevSectionSummary: string|null = sectionPlan.prevSectionSummary || null;

    // ── Image config (Faz 5): single global toggle + editable style guidance ──
    // Threaded via researchBlueprint (article-level). Backward compatible: if
    // absent, images stay ON with the default style — i.e. prior behavior.
    const imageConfig = researchBlueprint.imageConfig || {};
    const imagesEnabled: boolean = imageConfig.enabled !== false;
    const imageStyleGuidance: string =
      (imageConfig.styleGuidance || "").trim() ||
      "Professional DSLR photo, natural lighting, no text";

    // Detect if heading promises a numbered list (e.g. "5 Myths", "7 Steps", "3 Types")
    const numberedHeadingMatch = sectionPlan.title.match(/(\d+)\s+(myth|step|way|strateg|tip|reason|sign|mistake|lesson|factor|tool|question|example|benefit|advantage|type|kind|method|approach|technique|stage|phase|component|element)/i);
    const promisedCount: number | null = numberedHeadingMatch ? parseInt(numberedHeadingMatch[1], 10) : null;

    // ── Internal link — topic-aware semantic scoring ──────────────────────
    const stopWords = new Set([
      "with","that","this","from","have","will","your","their","which","about",
      "into","more","also","such","each","than","when","were","been","they",
      "what","where","some","these","those","both","after","being","there",
      "through","during","before","between","should","could","would",
    ]);

    type RawLink = string | { url: string; topic?: string };
    const rawInternalLinks: RawLink[] = researchBlueprint.extractedContext?.availableInternalLinks || [];
    const normalizedLinks = rawInternalLinks.map((item) =>
      typeof item === "string"
        ? { url: item, topic: "" }
        : { url: item.url ?? "", topic: item.topic ?? "" }
    ).filter((l) => (l.url?.length ?? 0) > 0);

    let linkInstruction = "";
    const internalLinkSlot = Math.floor(sectionIndex / 2);
    const maxInternalLinks = 5;

    if ((normalizedLinks.length ?? 0) > 0 && internalLinkSlot < maxInternalLinks) {
      const queryTerms = `${sectionPlan.title} ${keyword}`
        .toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));

      const scoredLinks = normalizedLinks.map(({ url, topic }) => {
        try {
          const urlObj = new URL(url, "https://placeholder-base.com");
          const haystack = (
            urlObj.pathname + " " + urlObj.hostname + " " + topic
          ).toLowerCase().replace(/[-_/]/g, " ");
          const score = queryTerms.reduce(
            (acc, term) =>
              acc +
              (haystack.includes(term) ? 2 : 0) +
              (url.toLowerCase().includes(term) ? 1 : 0),
            0
          );
          return { url, score };
        } catch { return { url, score: 0 }; }
      });

      scoredLinks.sort((a, b) => b.score - a.score || a.url.length - b.url.length);
      const relevantLinks = scoredLinks.filter((l) => l.score > 0);

      if ((relevantLinks.length ?? 0) === 0) {
        console.log(`[INTERNAL_LINK] slot:${internalLinkSlot} → no relevant match, using placeholder`);
        linkInstruction = `[INTERNAL LINK]: No highly relevant internal URL was matched to this section. Do NOT force an irrelevant link. Instead, write a natural sentence that could serve as an internal link anchor in the future — wrap the 3–5 word noun phrase in: <a href="#" style="color:#2563eb;text-decoration:underline;">[anchor text]</a> as a placeholder.\n\n`;
      } else {
        const pickIndex = internalLinkSlot % relevantLinks.length;
        const picked = relevantLinks[pickIndex];
        console.log(`[INTERNAL_LINK] slot:${internalLinkSlot} score:${picked.score} candidates:${relevantLinks.length} → ${picked.url}`);
        linkInstruction = `[INTERNAL LINK — MANDATORY]: Embed this URL ONCE as a short inline anchor inside a sentence:
<a href="${picked.url}" style="color:#2563eb;text-decoration:underline;">[3–5 word anchor text]</a>
CRITICAL RULES:
- The <a> tag must wrap ONLY 3–5 words — NEVER an entire sentence, paragraph, or <li> element.
- Correct: "...which is why <a href="...">retail execution tools</a> matter..."
- WRONG:  <a href="..."><li>Entire bullet point text here...</li></a>
- Anchor text must be a natural noun phrase describing the destination page.

`;
      }
    }

    // ── Citations from pre-fetched pool ──────────────────────────────────
    const citationPool: Citation[] = researchBlueprint.preFetchedCitations || [];
    const cite1 = getCitationFromPool(citationPool, sectionIndex, 0);
    const cite2 = getCitationFromPool(citationPool, sectionIndex, 1);

    linkInstruction += `[CITATIONS — MANDATORY — USE BOTH]:
1. According to <a href="${cite1.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite1.label}</a>, [specific plausible stat with a real number].
2. In a different paragraph: <a href="${cite2.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite2.label}</a> — embed in natural prose.
RULES: Both links MUST appear. Stats must include real numbers. Use ONLY these exact URLs.`;

    // ── Keyword density ────────────────────────────────────────────────
    const kwInstruction = selectedKeywords.length > 0
      ? `[KEYWORDS]: Use naturally (1–2% density): ${selectedKeywords.slice(0, 5).join(", ")}.`
      : "";

    // ── Brand voice ───────────────────────────────────────────────────
    const brandDesc: string     = brand.description || "";
    const brandFeatures: string = brand.keyFeatures || brand.features || "";

    const isBrandSection = brandEnabled && brandName && (
      sectionIndex >= 4 ||
      sectionRole === "conclusion" ||
      sectionRole === "cta"
    );

    const brandInstruction = isBrandSection
      ? `[BRAND VOICE RULES — READ CAREFULLY]:
Allowed mention types ONLY:
1. Capability: "${brandName} does X, which solves Y" — tie to a specific claim
2. Differentiator: "Unlike [category], ${brandName} approaches X by..."
3. CTA (conclusion/cta sections only): "${brandCta}"

NOT allowed:
- Casual name-drops without a capability claim
- Mentioning ${brandName} in definition or educational paragraphs
- More than 1 mention in this section

${sectionRole === "conclusion" || sectionRole === "cta"
  ? `[CONCLUSION CTA — STRICT FORMAT]:
Structure the closing in this EXACT order (max 3 sentences total):
  1. PROBLEM: Name the core pain the reader came here to solve (1 sentence, specific).
  2. CAPABILITY: What ${brandName} does that resolves that exact pain — a concrete capability, not a category label (1 sentence).
  3. OUTCOME + CTA: The measurable result + action: "${brandCta}" (1 sentence).

BANNED PHRASES — never use these, ever:
- "all-in-one", "all in one"
- "centralized hub", "central hub", "single hub"
- "end-to-end", "end to end"
- "comprehensive solution", "complete solution"
- "one-stop", "one stop shop"
- "seamlessly", "effortlessly", "streamline your workflow"

EXAMPLE STRUCTURE (adapt to your topic — do NOT copy verbatim):
WRONG: "${brandName} is an all-in-one centralized hub for end-to-end content operations."
RIGHT: "Most teams lose 30% of production time to format inconsistency — ${brandName} enforces brand rules at the point of creation, so every asset ships publication-ready without a review cycle. ${brandCta}"`
  : `This is section ${sectionIndex + 1}. The reader now understands the problem. Introduce ${brandName} as a solution with a specific capability claim.`}

Brand facts: ${brandDesc ? brandDesc.slice(0, 150) : ""} ${brandFeatures ? `| Key features: ${brandFeatures.slice(0, 150)}` : ""}`
      : "";

    // ── Sub-headings ──────────────────────────────────────────────────
    const subHeadingInstruction = subHeadings.length > 0
      ? `[SUB-SECTIONS — MANDATORY H3 RENDERING]:
You MUST render each sub-section below as a proper <h3> heading followed by content:
${subHeadings.map((sh, i) => `  ${i + 1}. ${sh}`).join("\n")}

For each sub-section:
- Render: <h3 style="font-size:1.2em;font-weight:700;margin:28px 0 10px;color:#1e293b;border-left:3px solid #6366f1;padding-left:10px;">[sub-section title]</h3>
- Then: 1–2 <p> blocks (max 2 sentences each, max 20 words per sentence).
- Or if the format is bullet_list/key_points: render the list under the <h3>.
DO NOT collapse sub-sections into a single paragraph. Each MUST have its own <h3>.`
      : "";

    // ── Narrative + quality instructions ─────────────────────────────
    const narrativeInstruction = [
      uniqueAngle ? `[REQUIRED CONTENT ANGLE — NON-NEGOTIABLE]:
"${uniqueAngle}"
This angle MUST be reflected in this section if it is the intro, the section most directly related to this angle, or the conclusion. Do not let generic SEO content override this perspective.` : "",

      storySpine ? `[STORY ARC CONTEXT]:
${storySpine}
Your section advances this arc. Do NOT restart from the beginning — assume the reader has read everything before this.` : "",

      // SORUN 4 FIX: Bridge instruction güncellendi — başlık tekrarını açıkça yasakla
      prevSectionSummary ? `[BRIDGE FROM PREVIOUS SECTION — MANDATORY]:
The previous section ended with this context: "${prevSectionSummary}"
Your OPENING SENTENCE must logically continue from this — not start a new topic from scratch.
STRICT RULES:
- Do NOT repeat or restate the section title (not even in italic or bold).
- Do NOT use: "In this section...", "Now let's look at...", "Another important...", "${sectionPlan.title}..."
- Do NOT open with the section title as an italic or emphasized phrase.
- INSTEAD: Open directly with an insight, fact, or consequence that flows from the previous section.` : "",

      nextTitle ? `[CLOSING HOOK — MANDATORY]:
End this section with ONE sentence that makes the reader need what comes next: "${nextTitle}"
Do NOT write: "In the next section we will..." — instead, end with an insight or open question that makes "${nextTitle}" feel inevitable.` : "",

      sectionRole === "intro" ? `[INTRO ROLE]: Open with a striking stat or problem that immediately identifies with the reader's pain. Preview the article's value — don't give everything away. NO brand mentions here.` : "",
      sectionRole === "conclusion" ? `[CONCLUSION ROLE]: Synthesize 2–3 actionable takeaways. Do NOT repeat earlier content verbatim — elevate it with a new perspective. End with a forward-looking statement or CTA.` : "",

      `[STATISTICAL DISCIPLINE]:
- Maximum 2 statistics in this section
- Each stat must directly support the argument — not replace it
- Do NOT open a sentence with "According to [source]"
- Integrate data into your argument: WRONG: "According to CMU, 80% of costs are locked in preconstruction." RIGHT: "Over 80% of a project's final cost is locked in before ground is broken — which is why most cost control efforts arrive too late."
- Source attribution in parentheses after the insight, not as the sentence opener`,

      `[READABILITY — HARD TARGET: Flesch Reading Ease 60+]:
- Average sentence length: 12–15 words. Mix short (5–8 word) sentences between longer ones.
- One idea per sentence. If a sentence needs a comma-chain, split it in two.
- Prefer 1–2 syllable words: "use" not "utilize", "help" not "facilitate", "fix" not "remediate", "start" not "implement", "show" not "demonstrate".
- Industry terms the reader searches for (the keyword itself) are fine — but explain them in plain words, and never stack 3+ multi-syllable words in one sentence.
- Active voice. "Teams lose 30% of stock" — not "30% of stock is lost by teams".
- Zero filler: "in order to" → "to", "due to the fact that" → "because".`,

      `[VOICE]: Write as an experienced practitioner talking to a peer — not as a researcher citing literature. Be direct, specific, and opinionated. Avoid hedging language like "it can be argued that" or "research suggests". Plain language is NOT dumbed-down language — keep the expertise, drop the jargon.`,

      assignedPAA ? `[PAA ANSWER]: Directly answer within the first 2 sentences (featured snippet format): "${assignedPAA}"` : "",
      contentGap ? `[COMPETITOR GAP — EXPLOIT THIS]: No competitor covers this angle — make it central to this section: "${contentGap}"` : "",

      promisedCount ? `[COMPLETION REQUIREMENT]: Your heading promises ${promisedCount} items. You MUST deliver exactly ${promisedCount} — count them before finishing. If you cannot fit all ${promisedCount} in the token budget, reduce the last number you can complete and note it clearly.` : "",

    ].filter(Boolean).join("\n\n");

    // ── System prompt ─────────────────────────────────────────────────
    const systemPrompt = `You are a concise, data-driven WordPress SEO content writer.
SECTION: "${sectionPlan.title}"
KEYWORD: "${keyword}"
${getLangRule(language)}

════════ CONTENT RULES ════════
1. RAW HTML ONLY — No Markdown.
2. NO <h2> — System adds the heading.
3. BREVITY — Each <p>: MAX ${Math.min(sectionPlan.maxParagraphSentences || 2, 2)} sentences. Sentences average 12–15 words; NEVER exceed 20 words.
4. NO REPETITION — Don't restate the section title in sentence 1. Never open with the title in italic or bold.
5. REAL DATA — At least one specific number, %, or $.
6. INLINE STYLES ONLY — All style="" with double quotes.
7. RICH FORMAT — Use the format instruction below. Tables, bullets, blockquotes, and H3s make content scannable and valuable. DO NOT flatten everything into paragraphs.
8. PLAIN LANGUAGE — Prefer short, common words. Write for a smart 8th grader (Flesch Reading Ease 60+).
═══════════════════════════════

${getContentTypeInstruction(contentType)}

${audienceInstruction}

${getFormatInstruction(sectionPlan.requiredFormat, Math.min(sectionPlan.maxParagraphSentences || 2, 2), sectionIndex)}

${subHeadingInstruction}

${linkInstruction}

${kwInstruction}

${brandInstruction}

${narrativeInstruction}

Return ONLY the inner HTML. No <h2>. No wrapper div. No code fences.`;

    // Token budget: numbered headings and subheadings need more room.
    // TABLE BUG FIX: html_table is the #1 truncation source — min 5 rows ×
    // 3-4 cols + optional per-subheading mini-tables routinely exceeds 3200.
    // Bump its floor independently of the subheading/numbered-heading bonus.
    const hasSubHeadings = subHeadings.length > 0;
    const isTableFormat = sectionPlan.requiredFormat === "html_table";
    let sectionMaxTokens = (promisedCount && promisedCount >= 4) || hasSubHeadings ? 3200 : 2000;
    if (isTableFormat) {
      sectionMaxTokens = hasSubHeadings ? 4096 : 3200;
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: sectionMaxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: `Write HTML for: "${sectionPlan.title}"\n\n${getLangRule(language)}` }],
      temperature: 0.4,
    });

    // TABLE BUG FIX: detect truncation explicitly. If Claude hit the token
    // ceiling mid-tag, the close-tag repair below still saves the DOM, but we
    // log it so truncation frequency is visible (and can inform future
    // max_tokens tuning) instead of failing silently.
    if (response.stop_reason === "max_tokens") {
      console.warn(
        `[WRITER_TRUNCATED] section="${sectionPlan.title}" format=${sectionPlan.requiredFormat} ` +
        `maxTokens=${sectionMaxTokens} — response hit max_tokens, output may be cut mid-tag.`
      );
    }

    const contentBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // TABLE BUG FIX — Layer 1: deterministically close any unclosed tag
    // (table/tr/td/ul/li/blockquote/etc.) before this HTML ever gets
    // concatenated with the next section or parsed by a browser DOM parser.
    generatedHtml = closeUnclosedHtmlTags(generatedHtml);

    // ── Image — 1-4-7 rule + async decoupling ─────────────────────────
    // Faz 5: also gated by the global image toggle. When images are disabled,
    // no placeholder <figure> and no imagePrompt are emitted, so useContentEngine
    // never calls image-generate for this article.
    const shouldGenerateImage = imagesEnabled && sectionIndex % 3 === 0;
    const imagePrompt = shouldGenerateImage
      ? `${imageStyleGuidance}. Subject: ${sectionPlan.title} — ${keyword}.`.slice(0, 480)
      : null;

    const imgHtml = shouldGenerateImage
      ? `<!-- wp:image {"sizeSlug":"large"} -->
<figure data-img-placeholder="${sectionIndex}" style="margin:28px 0;text-align:center;">
  <img src="https://placehold.co/1200x630/e0e7ff/6366f1?text=Generating+image..." alt="${sectionPlan.title.replace(/"/g, "&quot;")}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);opacity:0.5;" loading="lazy" width="1200" height="630" />
  <figcaption style="text-align:center;font-size:0.82em;color:#6b7280;font-style:italic;margin-top:6px;">${sectionPlan.title}</figcaption>
</figure>
<!-- /wp:image -->`
      : "";

    // ── Lead summary (section 0 only) ─────────────────────────────────
    let leadSummaryHtml = "";
    if (isFirstSection && (allSectionTitles?.length ?? 0) > 0) {
      try { leadSummaryHtml = await generateLeadSummary(keyword, articleTitle, allSectionTitles, language); }
      catch { /* non-critical */ }
    }

    // ── Context chain summary ─────────────────────────────────────────
    let sectionSummary = "";
    try {
      const summaryRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 120,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: `Summarize the closing argument of this section in exactly 2 sentences (max 30 words total). 
Write as if ending the section's thought — the next section will continue from here.
Section title: "${sectionPlan.title}"
Section content (plain text): ${generatedHtml.replace(/<[^>]+>/g, " ").slice(0, 600)}
Output ONLY the 2-sentence summary. No labels, no quotes.
${getLangRule(language)}`,
        }],
      });
      const summaryBlock = summaryRes.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      sectionSummary = summaryBlock?.text?.trim() || "";
    } catch { /* non-critical */ }

    // ── Heading number sync ───────────────────────────────────────────
    let finalTitle = sectionPlan.title;
    if (promisedCount) {
      const liCount = (generatedHtml.match(/<li[\s>]/gi) || []).length;
      const deliveredCount = liCount > 0 ? liCount : promisedCount;
      if (deliveredCount < promisedCount && deliveredCount > 0) {
        finalTitle = sectionPlan.title.replace(/\d+/, String(deliveredCount));
        console.log(`[HEADING_SYNC] "${sectionPlan.title}" → "${finalTitle}" (delivered ${deliveredCount}/${promisedCount})`);
      }
    }

    // ── Assemble ──────────────────────────────────────────────────────
    const h2 = `<h2 style="font-size:1.6em;font-weight:700;margin:36px 0 18px;padding-bottom:8px;border-bottom:2px solid #e0e7ff;color:#1e293b;">${finalTitle}</h2>`;
    const finalChunk = isFirstSection
      ? `\n${leadSummaryHtml}\n${h2}\n${imgHtml}\n${generatedHtml}`
      : `${h2}\n${imgHtml}\n${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk, sectionSummary, imagePrompt, sectionIndex }, { status: 200 });
  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}