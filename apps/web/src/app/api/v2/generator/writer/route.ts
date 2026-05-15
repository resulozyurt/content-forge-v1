// apps/web/src/app/api/v2/generator/writer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// Gemini image generation
// Correct model: gemini-3.1-flash-image-preview (Nano Banana 2)
// Endpoint: v1beta/generateContent
// Timeout: 60s — model needs ~35-50s to generate
// ---------------------------------------------------------------------------
async function generateImageWithGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[GEMINI_IMAGE] GEMINI_API_KEY not set");
    return null;
  }

  const models = [
    "gemini-3.1-flash-image-preview",
    "gemini-2.0-flash-exp-image-generation",
    "gemini-2.5-flash-image-preview",
  ];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        console.warn(`[GEMINI_IMAGE] model=${model} status=${res.status}:`, (await res.text()).slice(0, 150));
        continue;
      }

      const data = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
      if (!imgPart?.inlineData?.data) {
        console.warn(`[GEMINI_IMAGE] model=${model} — no inlineData`);
        continue;
      }

      console.log(`[GEMINI_IMAGE] Success with model=${model}`);
      return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
    } catch (err: any) {
      console.warn(`[GEMINI_IMAGE] model=${model} error:`, err.message);
    }
  }

  console.warn("[GEMINI_IMAGE] All models failed");
  return null;
}

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
// SORUN 4+5 FIX: Her format tipi için zengin HTML çıktısı zorunlu kılındı.
// bullet_list ve key_points formatlarında H3 subheading'ler destekleniyor.
// ---------------------------------------------------------------------------
function getFormatInstruction(requiredFormat: string, maxS: number = 2): string {
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

    default:
      return `OUTPUT FORMAT — SHORT PARAGRAPHS:
- EXACTLY 2–3 <p> blocks. Each <p>: MAX ${maxS} sentences. ABSOLUTE HARD LIMIT.
- Lead with the most critical fact. Use <strong> for 1–2 key data points. Include ONE specific stat.
- After the last <p>, add ONE styled callout:
<div style="background:#faf5ff;border-left:4px solid #8b5cf6;padding:14px 18px;margin:20px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 4px;font-weight:700;color:#8b5cf6;font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;">📊 By the Numbers</p>
  <p style="margin:0;color:#1f2937;font-size:0.95em;line-height:1.6;">[One specific stat — max 20 words]</p>
</div>
- If subheadings are provided, render each as <h3 style="font-size:1.15em;font-weight:700;margin:22px 0 8px;color:#1e293b;">[subheading]</h3> followed by 1–2 <p> blocks.`;
  }
}

function getLangRule(language: string): string {
  return language.toLowerCase().includes("tr")
    ? "LANGUAGE: Fluent natural Turkish. No translation artifacts."
    : "LANGUAGE: Native American English. Active voice, direct, confident.";
}

// ---------------------------------------------------------------------------
// Lead summary — first section only
// SORUN 1+2+3 FIX:
//   - <details> kaldırıldı — TipTap desteklemiyor, tüm içerik tek <li>'ya giriyordu
//   - "What this article covers" düz <ul> olarak render ediliyor
//   - Rakip analizi sonrası "Key Takeaways" tarzı tasarım — başlık + bullet + bottom line
//   - Tüm HTML TipTap-safe: sadece block-level elementler, no <details>/<summary>
// ---------------------------------------------------------------------------
async function generateLeadSummary(
  keyword: string, articleTitle: string, sections: string[], language: string
): Promise<string> {
  const isTr = language.toLowerCase().includes("tr");
  const langRule = isTr
    ? "Akıcı, doğal Türkçe. Kısa ve net. Her madde max 12 kelime."
    : "Crisp American English. Direct, no fluff. Each bullet under 14 words.";

  const sectionCount = sections.length;
  const estWords     = sectionCount * 250;
  const readingMins  = Math.max(3, Math.round(estWords / 238));
  const readingLabel = isTr ? `${readingMins} dakika okuma` : `${readingMins} min read`;

  // Article map — rendered as plain <ul>, NOT <details> (TipTap-safe)
  const mapItems = sections
    .slice(0, 6)
    .map((s) => `<li style="color:#374151;margin:0 0 4px;font-size:0.88em;line-height:1.5;">${s}</li>`)
    .join("\n");

  const coverLabel   = isTr ? "Bu makalede neler var:" : "What this article covers:";
  const bottomLabel  = isTr ? "Ana sonuç:" : "Key takeaway:";
  const sectionLabel = isTr ? "✦ Temel Çıkarımlar" : "✦ Key Takeaways";

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 700, temperature: 0.4,
    messages: [{ role: "user", content:
      `Write an HTML lead summary block for the article titled "${articleTitle}" about "${keyword}".
${langRule}

Sections in this article: ${sections.slice(0, 8).join(" | ")}

Produce EXACTLY this HTML structure. Fill in ONLY the bracketed placeholders. Keep ALL inline styles exactly as shown. Do NOT add <details>, <summary>, or any interactive elements.

<div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:12px;padding:24px 28px;margin:20px 0 32px;">

  <p style="font-size:0.72em;font-weight:800;color:#6366f1;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 12px 0;">${sectionLabel} · ${readingLabel}</p>

  <p style="font-size:1.08em;color:#1e293b;line-height:1.7;margin:0 0 16px 0;">
    <strong style="color:#1d4ed8;">[ONE hook sentence with a concrete stat — max 22 words. Start with a number or surprising fact. Be specific to "${keyword}".]</strong>
  </p>

  <ul style="margin:0 0 20px 0;padding:0;list-style:none;">
    <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
      <span style="color:#6366f1;font-weight:700;font-size:1em;flex-shrink:0;">→</span>
      <span style="color:#374151;font-size:0.95em;line-height:1.5;"><strong>[Key insight 1 — max 12 words. Data point or consequence.]</strong></span>
    </li>
    <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
      <span style="color:#6366f1;font-weight:700;font-size:1em;flex-shrink:0;">→</span>
      <span style="color:#374151;font-size:0.95em;line-height:1.5;"><strong>[Key insight 2 — max 12 words. Different angle from #1.]</strong></span>
    </li>
    <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
      <span style="color:#6366f1;font-weight:700;font-size:1em;flex-shrink:0;">→</span>
      <span style="color:#374151;font-size:0.95em;line-height:1.5;"><strong>[Key insight 3 — max 12 words. Actionable or surprising.]</strong></span>
    </li>
    <li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
      <span style="color:#6366f1;font-weight:700;font-size:1em;flex-shrink:0;">→</span>
      <span style="color:#374151;font-size:0.95em;line-height:1.5;"><strong>[Key insight 4 — max 12 words. Only if genuinely distinct from above.]</strong></span>
    </li>
  </ul>

  <div style="margin-bottom:18px;">
    <p style="font-size:0.78em;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:0.06em;margin:0 0 8px 0;">${coverLabel}</p>
    <ul style="margin:0;padding:0 0 0 4px;list-style:none;">
${mapItems}
    </ul>
  </div>

  <p style="margin:0;font-size:0.9em;color:#374151;border-top:1px solid #c7d2fe;padding-top:14px;line-height:1.6;">
    <strong style="color:#1d4ed8;">${bottomLabel}</strong> [One sentence — the single most important takeaway. Max 20 words. Opinionated, no hedge words.]
  </p>

</div>

RULES:
- 3 bullets minimum, 4 maximum. Omit bullet 4 if it repeats bullets 1-3.
- Each bullet must cover a DIFFERENT angle (data, cost, time, risk, adoption).
- Hook stat must include a %, $, or multiplier — be specific.
- Bottom line must be opinionated — not a restatement of the hook.
- Do NOT use <details>, <summary>, or interactive HTML elements.
- Do NOT add anything outside the outer <div>. Return ONLY the raw HTML.` }],
  });
  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return (block?.text || "").replace(/^```html\s*/i, "").replace(/```\s*$/i, "").trim();
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
    const articleTitle: string       = researchBlueprint.articleTitle || keyword;
    const selectedKeywords: string[] = researchBlueprint.selectedKeywords || [];
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

    // ── Sub-headings (SORUN 4 FIX) ─────────────────────────────────────────
    // H3'ler artık format instruction içinde de zorunlu kılınıyor.
    // subHeadingInstruction format talimatını TAMAMLAR, ezmez.
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

    // ── Narrative + quality instructions ─────────────────────────────────
    const narrativeInstruction = [
      uniqueAngle ? `[REQUIRED CONTENT ANGLE — NON-NEGOTIABLE]:
"${uniqueAngle}"
This angle MUST be reflected in this section if it is the intro, the section most directly related to this angle, or the conclusion. Do not let generic SEO content override this perspective.` : "",

      storySpine ? `[STORY ARC CONTEXT]:
${storySpine}
Your section advances this arc. Do NOT restart from the beginning — assume the reader has read everything before this.` : "",

      prevSectionSummary ? `[BRIDGE FROM PREVIOUS SECTION — MANDATORY]:
The previous section ended with this context: "${prevSectionSummary}"
Your OPENING SENTENCE must logically continue from this — not start a new topic from scratch.
DO NOT use: "In this section...", "Now let's look at...", "Another important..."
INSTEAD: Open with an insight or consequence that flows naturally from what was just established.` : "",

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

      `[VOICE]: Write as an experienced practitioner talking to a peer — not as a researcher citing literature. Be direct, specific, and opinionated. Avoid hedging language like "it can be argued that" or "research suggests".`,

      assignedPAA ? `[PAA ANSWER]: Directly answer within the first 2 sentences (featured snippet format): "${assignedPAA}"` : "",
      contentGap ? `[COMPETITOR GAP — EXPLOIT THIS]: No competitor covers this angle — make it central to this section: "${contentGap}"` : "",

      promisedCount ? `[COMPLETION REQUIREMENT]: Your heading promises ${promisedCount} items. You MUST deliver exactly ${promisedCount} — count them before finishing. If you cannot fit all ${promisedCount} in the token budget, reduce the last number you can complete and note it clearly.` : "",

    ].filter(Boolean).join("\n\n");

    // ── System prompt ─────────────────────────────────────────────────────
    const systemPrompt = `You are a concise, data-driven WordPress SEO content writer.
SECTION: "${sectionPlan.title}"
KEYWORD: "${keyword}"
${getLangRule(language)}

════════ CONTENT RULES ════════
1. RAW HTML ONLY — No Markdown.
2. NO <h2> — System adds the heading.
3. BREVITY — Each <p>: MAX ${Math.min(sectionPlan.maxParagraphSentences || 2, 2)} sentences, max 20 words each.
4. NO REPETITION — Don't restate the section title in sentence 1.
5. REAL DATA — At least one specific number, %, or $.
6. INLINE STYLES ONLY — All style="" with double quotes.
7. RICH FORMAT — Use the format instruction below. Tables, bullets, blockquotes, and H3s make content scannable and valuable. DO NOT flatten everything into paragraphs.
═══════════════════════════════

${getFormatInstruction(sectionPlan.requiredFormat, Math.min(sectionPlan.maxParagraphSentences || 2, 2))}

${subHeadingInstruction}

${linkInstruction}

${kwInstruction}

${brandInstruction}

${narrativeInstruction}

Return ONLY the inner HTML. No <h2>. No wrapper div. No code fences.`;

    // Token budget: numbered headings get more room; subheadings also need more
    const hasSubHeadings = subHeadings.length > 0;
    const sectionMaxTokens = (promisedCount && promisedCount >= 4) || hasSubHeadings ? 3200 : 2000;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: sectionMaxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: `Write HTML for: "${sectionPlan.title}"` }],
      temperature: 0.4,
    });
    const contentBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // ── Image — 1-4-7 rule + async decoupling ─────────────────────────────
    const shouldGenerateImage = sectionIndex % 3 === 0;
    const imagePrompt = shouldGenerateImage
      ? `Professional DSLR photo: ${sectionPlan.title} — ${keyword}. Natural lighting, no text.`.slice(0, 100)
      : null;

    const imgHtml = shouldGenerateImage
      ? `<!-- wp:image {"sizeSlug":"large"} -->
<figure data-img-placeholder="${sectionIndex}" style="margin:28px 0;text-align:center;">
  <img src="https://placehold.co/1200x630/e0e7ff/6366f1?text=Generating+image..." alt="${sectionPlan.title.replace(/"/g, "&quot;")}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);opacity:0.5;" loading="lazy" width="1200" height="630" />
  <figcaption style="text-align:center;font-size:0.82em;color:#6b7280;font-style:italic;margin-top:6px;">${sectionPlan.title}</figcaption>
</figure>
<!-- /wp:image -->`
      : "";

    // ── Lead summary (section 0 only) ─────────────────────────────────────
    let leadSummaryHtml = "";
    if (isFirstSection && (allSectionTitles?.length ?? 0) > 0) {
      try { leadSummaryHtml = await generateLeadSummary(keyword, articleTitle, allSectionTitles, language); }
      catch { /* non-critical */ }
    }

    // ── Context chain summary ─────────────────────────────────────────────
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
Output ONLY the 2-sentence summary. No labels, no quotes.`,
        }],
      });
      const summaryBlock = summaryRes.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      sectionSummary = summaryBlock?.text?.trim() || "";
    } catch { /* non-critical */ }

    // ── Heading number sync ───────────────────────────────────────────────
    let finalTitle = sectionPlan.title;
    if (promisedCount) {
      const liCount = (generatedHtml.match(/<li[\s>]/gi) || []).length;
      const deliveredCount = liCount > 0 ? liCount : promisedCount;
      if (deliveredCount < promisedCount && deliveredCount > 0) {
        finalTitle = sectionPlan.title.replace(/\d+/, String(deliveredCount));
        console.log(`[HEADING_SYNC] "${sectionPlan.title}" → "${finalTitle}" (delivered ${deliveredCount}/${promisedCount})`);
      }
    }

    // ── Assemble ──────────────────────────────────────────────────────────
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