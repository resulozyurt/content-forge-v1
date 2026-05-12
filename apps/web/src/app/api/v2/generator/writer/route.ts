// apps/web/src/app/api/v2/generator/writer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// Gemini Imagen — correct endpoint is generateContent (not predict)
// Only GEMINI_API_KEY env var needed.
// ---------------------------------------------------------------------------
async function generateImageWithGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model = "gemini-2.0-flash-preview-image-generation";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      console.warn(`[GEMINI_IMAGE] ${res.status}:`, (await res.text()).slice(0, 200));
      return null;
    }

    const data = await res.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
    if (!img?.inlineData?.data) return null;

    return `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`;
  } catch (err: any) {
    console.warn("[GEMINI_IMAGE] Request failed:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authority citation map — real, stable URLs
// ---------------------------------------------------------------------------
const CITATION_MAP: Record<string, { label: string; paths: string[] }> = {
  default:      { label: "Harvard Business Review", paths: ["https://hbr.org/2023/05/the-new-rules-of-talent-management", "https://hbr.org/2022/11/how-to-future-proof-your-organization"] },
  retail:       { label: "NRF", paths: ["https://nrf.com/blog/consumer-spending-trends", "https://nrf.com/research/state-retail-technology"] },
  construction: { label: "OSHA", paths: ["https://www.osha.gov/data/commonstats", "https://www.osha.gov/construction/safety-health-topics"] },
  tech:         { label: "TechCrunch", paths: ["https://techcrunch.com/category/enterprise/", "https://venturebeat.com/ai/"] },
  marketing:    { label: "Content Marketing Institute", paths: ["https://contentmarketinginstitute.com/articles/content-marketing-strategy-guide/", "https://contentmarketinginstitute.com/articles/seo-content-strategy/"] },
};

const FALLBACK_CITATIONS = [
  { url: "https://www.mckinsey.com/capabilities/operations/our-insights", label: "McKinsey & Company" },
  { url: "https://www.statista.com/topics/market-research", label: "Statista" },
  { url: "https://www.ibm.com/think/topics/ai-for-business", label: "IBM Institute for Business Value" },
  { url: "https://www.deloitte.com/global/en/about/press-room/deloitte-insights.html", label: "Deloitte Insights" },
  { url: "https://www.gartner.com/en/newsroom/press-releases", label: "Gartner" },
];

function getCitation(keyword: string, index: number) {
  const kw = keyword.toLowerCase();
  let pool = CITATION_MAP.default;
  if (kw.match(/retail|shelf|category|merchandis|store/)) pool = CITATION_MAP.retail;
  else if (kw.match(/construc|safety|inspect|osha|hazard/)) pool = CITATION_MAP.construction;
  else if (kw.match(/tech|software|ai|cloud|saas/)) pool = CITATION_MAP.tech;
  else if (kw.match(/market|seo|content|brand/)) pool = CITATION_MAP.marketing;
  return { url: pool.paths[index % pool.paths.length], label: pool.label };
}

// ---------------------------------------------------------------------------
// Format instructions — strict brevity rules per format type
// ---------------------------------------------------------------------------
function getFormatInstruction(requiredFormat: string, maxS: number = 2): string {
  switch (requiredFormat) {
    case "html_table":
      return `OUTPUT FORMAT — DATA TABLE:
- ONE intro <p> (max 15 words). Then a <table> with <thead>/<tbody>.
- Minimum 5 rows, 3–4 columns. REAL benchmark data (%, $, timeframes).
- After the table: ONE <p> with a citation link.
- No additional prose blocks.`;

    case "bullet_list":
      return `OUTPUT FORMAT — BULLET LIST:
- ONE intro <p> (max 1 sentence, 15 words max).
- <ul> with 4–6 <li> items. Each <li>: <strong>Bold Term:</strong> ONE concise sentence (max 18 words). No topic overlap.
- Total output must read in under 60 seconds.`;

    case "key_points":
      return `OUTPUT FORMAT — KEY TAKEAWAYS:
- No intro. Exactly 4 styled <li> inside a <ul>:
  <li style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 14px;margin:6px 0;border-radius:0 6px 6px 0;list-style:none;">
    <strong style="display:block;color:#1d4ed8;margin-bottom:3px;">Short Takeaway (max 6 words)</strong>
    <span style="color:#374151;font-size:0.9em;">One sentence with a specific stat. Max 20 words.</span>
  </li>
- Each takeaway must contain a real number or percentage.`;

    case "blockquote":
      return `OUTPUT FORMAT — EXPERT QUOTE:
- ONE context <p> (max 2 sentences, 30 words total).
- ONE <blockquote style="border-left:4px solid #6366f1;background:#f5f3ff;padding:18px 22px;margin:20px 0;border-radius:0 8px 8px 0;">
    <p style="font-style:italic;font-size:1.05em;color:#3730a3;margin:0 0 10px 0;">"[Expert insight with a specific stat or mechanism. Max 40 words.]"</p>
    <cite style="font-weight:700;font-style:normal;color:#6366f1;font-size:0.85em;">— Name, Title/Publication, Year</cite>
  </blockquote>
- ONE closing <p> (max 2 sentences, 25 words total).
- Three blocks maximum. No more prose.`;

    default: // paragraph
      return `OUTPUT FORMAT — SHORT PARAGRAPHS:
- EXACTLY 2–3 <p> blocks. Each <p>: MAX ${maxS} sentences. ABSOLUTE HARD LIMIT — no exceptions.
- Each sentence: max 20 words. Active voice.
- Lead with the most critical fact in sentence 1.
- Use <strong> for exactly 1–2 key data points per section. No more.
- Include ONE specific stat (%, $, timeframes) somewhere in the output.
- After the last <p>, add ONE of these inline decorative elements based on context:

  Option A — Stat callout:
  <div style="background:#faf5ff;border-left:4px solid #8b5cf6;padding:14px 18px;margin:20px 0;border-radius:0 8px 8px 0;">
    <p style="margin:0 0 4px;font-weight:700;color:#8b5cf6;font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;">📊 By the Numbers</p>
    <p style="margin:0;color:#1f2937;font-size:0.95em;line-height:1.6;">[One specific stat — max 20 words]</p>
  </div>

  Option B — Pro tip:
  <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;margin:20px 0;border-radius:0 8px 8px 0;">
    <p style="margin:0 0 4px;font-weight:700;color:#22c55e;font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;">✅ Pro Tip</p>
    <p style="margin:0;color:#1f2937;font-size:0.95em;line-height:1.6;">[Actionable tip — max 20 words]</p>
  </div>

  Pick whichever fits the section's context. Use Option A for data-heavy sections, Option B for how-to sections.`;
  }
}

function getLangRule(language: string): string {
  return language.toLowerCase().includes("tr")
    ? "LANGUAGE: Fluent natural Turkish. No translation artifacts. Perfect grammar. Concise sentences."
    : "LANGUAGE: Native American English. Active voice, direct, confident. Short sentences preferred.";
}

// ---------------------------------------------------------------------------
// Lead summary — prepended before first H2 only
// ---------------------------------------------------------------------------
async function generateLeadSummary(
  keyword: string, articleTitle: string, sections: string[], language: string
): Promise<string> {
  const langRule = language.toLowerCase().includes("tr")
    ? "Akıcı, kısa Türkçe. Her madde max 10 kelime."
    : "Crisp American English. Each bullet point under 12 words.";

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    temperature: 0.4,
    messages: [{
      role: "user",
      content: `Write a concise HTML lead summary for an article titled "${articleTitle}" about "${keyword}".
Sections: ${sections.slice(0, 5).join(", ")}.
${langRule}

Rules:
- Hook: ONE sentence with a specific stat (max 20 words).
- Preview: exactly 3 bullet points, each under 12 words.
- Total output must be scannable in under 15 seconds.

Structure (inline styles only):
<div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:12px;padding:20px 24px;margin:20px 0 28px;">
  <p style="font-size:1em;color:#1e293b;line-height:1.7;margin:0 0 12px 0;"><strong style="color:#1d4ed8;">[Hook with stat].</strong> [One follow-up sentence max 15 words].</p>
  <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">
    <li style="color:#374151;margin-bottom:5px;line-height:1.5;font-size:0.95em;"><strong>[Takeaway 1 — max 10 words]</strong></li>
    <li style="color:#374151;margin-bottom:5px;line-height:1.5;font-size:0.95em;"><strong>[Takeaway 2 — max 10 words]</strong></li>
    <li style="color:#374151;line-height:1.5;font-size:0.95em;"><strong>[Takeaway 3 — max 10 words]</strong></li>
  </ul>
</div>

Return ONLY the raw HTML. No code fences.`,
    }],
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

    const language: string   = researchBlueprint.language || "en-US";
    const keyword: string    = researchBlueprint.keyword || "Topic";
    const articleTitle: string = researchBlueprint.articleTitle || keyword;
    const selectedKeywords: string[] = researchBlueprint.selectedKeywords || [];
    const isFirstSection = sectionIndex === 0;

    // Sub-headings the user added under this H2 in Outline Architect
    const subHeadings: string[] = sectionPlan.subHeadings || [];

    // ── Internal link ────────────────────────────────────────────────────
    const internalLinks: string[] = researchBlueprint.extractedContext?.availableInternalLinks || [];
    let linkInstruction = "";
    if (internalLinks.length > 0) {
      const link = internalLinks[sectionIndex % internalLinks.length];
      linkInstruction = `[INTERNAL LINK]: Embed ONCE naturally:
<a href="${link}" style="color:#2563eb;text-decoration:underline;">[3–5 word relevant anchor text]</a>
Never "click here" or bare URL.\n\n`;
    }

    // ── External citations — 2 per section ──────────────────────────────
    const cite1 = getCitation(keyword, sectionIndex);
    const cite2 = FALLBACK_CITATIONS[(sectionIndex + 2) % FALLBACK_CITATIONS.length];

    linkInstruction += `[CITATIONS — MANDATORY — BOTH]:
1. According to <a href="${cite1.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite1.label}</a>, [specific plausible stat with a real number].
2. Use <a href="${cite2.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite2.label}</a> in a different paragraph. Embed in natural prose. Both must appear.`;

    // ── Keyword density ─────────────────────────────────────────────────
    const kwInstruction = selectedKeywords.length > 0
      ? `[KEYWORDS]: Use naturally (1–2% density): ${selectedKeywords.slice(0, 5).join(", ")}.`
      : "";

    // ── Sub-heading structure — expand user's H3/H4 ─────────────────────
    const subHeadingInstruction = subHeadings.length > 0
      ? `[SUB-SECTIONS REQUIRED]: Cover each with a styled heading + content:
${subHeadings.map((sh, i) => `  ${i + 1}. ${sh}`).join("\n")}

For each sub-section:
- Use <h3 style="font-size:1.2em;font-weight:600;margin:24px 0 10px;color:#1e293b;"> or <h4> as appropriate.
- Follow the heading with 1–2 SHORT <p> blocks (max 2 sentences each, max 20 words per sentence).
- No padding, no filler. Get to the point immediately.`
      : "";

    // ── System prompt ────────────────────────────────────────────────────
    const systemPrompt = `You are a concise, data-driven WordPress SEO content writer.
SECTION: "${sectionPlan.title}"
KEYWORD: "${keyword}"
${getLangRule(language)}

═══════════ CONTENT RULES ═══════════
1. RAW HTML ONLY — Zero Markdown. No **bold**, no [link](url).
2. NO <h2> — System adds the heading. Body content only.
3. BREVITY IS NON-NEGOTIABLE — Shorter is better. Readers skim.
   - Each <p> under H2: MAX ${Math.min(sectionPlan.maxParagraphSentences || 2, 2)} sentences.
   - Each <p> under H3/H4: MAX 2 sentences. Absolute limit.
   - Each sentence: max 20 words.
4. NO REPETITION — Don't restate the section title in the first sentence.
5. REAL DATA — At least one specific number, %, or $ in the section.
6. WORDPRESS INLINE STYLES — All style="" with double quotes. No class= on new elements.
═════════════════════════════════════

${getFormatInstruction(sectionPlan.requiredFormat, Math.min(sectionPlan.maxParagraphSentences || 2, 2))}

${subHeadingInstruction}

${linkInstruction}

${kwInstruction}

Return ONLY the inner HTML. No <h2>. No wrapper div. No code fences.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Write HTML for: "${sectionPlan.title}"` }],
      temperature: 0.4,
    });

    const contentBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // ── Image — Gemini Imagen via generateContent ────────────────────────
    let imgHtml = "";
    if (sectionPlan.includeImage) {
      try {
        const imgPromptRes = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 100,
          messages: [{
            role: "user",
            content: `Photorealistic editorial image for "${sectionPlan.title}" about "${keyword}". Professional, no text in image. Under 80 characters.`,
          }],
          temperature: 0.7,
        });
        const imgPromptBlock = imgPromptRes.content.find((b): b is Anthropic.TextBlock => b.type === "text");
        const imgPrompt = (imgPromptBlock?.text || `Professional editorial photo about ${keyword}`).slice(0, 80);
        const imageDataUri = await generateImageWithGemini(imgPrompt);
        const imgSrc = imageDataUri
          ?? `https://placehold.co/1200x630/1e40af/ffffff?text=${encodeURIComponent(imgPrompt.slice(0, 60))}`;

        imgHtml = `<!-- wp:image {"sizeSlug":"large"} -->
<figure style="margin:28px 0;text-align:center;">
  <img src="${imgSrc}" alt="${sectionPlan.title.replace(/"/g, "&quot;")}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);" loading="lazy" width="1200" height="630" />
  <figcaption style="text-align:center;font-size:0.82em;color:#6b7280;font-style:italic;margin-top:6px;">${sectionPlan.title}</figcaption>
</figure>
<!-- /wp:image -->`;
      } catch { /* image failure must never block content delivery */ }
    }

    // ── Lead summary (section 0 only) ───────────────────────────────────
    let leadSummaryHtml = "";
    if (isFirstSection && allSectionTitles?.length > 0) {
      try {
        leadSummaryHtml = await generateLeadSummary(keyword, articleTitle, allSectionTitles, language);
      } catch { /* non-critical */ }
    }

    // ── Assemble ─────────────────────────────────────────────────────────
    const h2 = `<h2 style="font-size:1.6em;font-weight:700;margin:36px 0 18px;padding-bottom:8px;border-bottom:2px solid #e0e7ff;color:#1e293b;">${sectionPlan.title}</h2>`;
    const imageBlock = imgHtml ? `\n${imgHtml}\n` : "";
    const leadBlock  = leadSummaryHtml ? `\n${leadSummaryHtml}\n` : "";

    const finalChunk = isFirstSection
      ? `${leadBlock}${h2}${imageBlock}\n${generatedHtml}`
      : `${h2}${imageBlock}\n${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk }, { status: 200 });
  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}