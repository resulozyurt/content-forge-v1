// apps/web/src/app/api/v2/generator/writer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// Gemini Imagen — correct endpoint is generateContent, not predict
// Only GEMINI_API_KEY is needed; no additional env vars.
// ---------------------------------------------------------------------------
async function generateImageWithGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[GEMINI_IMAGE] GEMINI_API_KEY not set — falling back to placeholder");
    return null;
  }

  // Imagen 3 fast via the Gemini API — uses generateContent, NOT predict
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
      const errBody = await res.text();
      console.warn(`[GEMINI_IMAGE] API error ${res.status}:`, errBody.slice(0, 300));
      return null;
    }

    const data = await res.json();
    // Response: candidates[0].content.parts[].inlineData.data (base64)
    const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart?.inlineData?.data) {
      console.warn("[GEMINI_IMAGE] No image data in response parts");
      return null;
    }

    const mimeType = imagePart.inlineData.mimeType || "image/png";
    // Return as data URI — works directly in <img src>
    // For production, upload to Cloudflare R2 / S3 and return a CDN URL instead
    return `data:${mimeType};base64,${imagePart.inlineData.data}`;
  } catch (err: any) {
    console.warn("[GEMINI_IMAGE] Request failed:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Authority citation map — real stable URLs, grouped by topic
// ---------------------------------------------------------------------------
const CITATION_MAP: Record<string, { label: string; paths: string[] }> = {
  default: {
    label: "Harvard Business Review",
    paths: [
      "https://hbr.org/2023/05/the-new-rules-of-talent-management",
      "https://hbr.org/2022/11/how-to-future-proof-your-organization",
    ],
  },
  retail: {
    label: "NRF",
    paths: [
      "https://nrf.com/blog/consumer-spending-trends",
      "https://nrf.com/research/state-retail-technology",
    ],
  },
  construction: {
    label: "OSHA",
    paths: [
      "https://www.osha.gov/data/commonstats",
      "https://www.osha.gov/construction/safety-health-topics",
    ],
  },
  tech: {
    label: "TechCrunch",
    paths: [
      "https://techcrunch.com/category/enterprise/",
      "https://venturebeat.com/ai/",
    ],
  },
  marketing: {
    label: "Content Marketing Institute",
    paths: [
      "https://contentmarketinginstitute.com/articles/content-marketing-strategy-guide/",
      "https://contentmarketinginstitute.com/articles/seo-content-strategy/",
    ],
  },
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
// Format instructions per section type
// ---------------------------------------------------------------------------
function getFormatInstruction(requiredFormat: string, maxS: number = 2): string {
  switch (requiredFormat) {
    case "html_table":
      return `OUTPUT: One short <p> intro (max 20 words). A full <table> with <thead>/<tbody>.
Minimum 5 rows, 3–4 columns. REAL benchmark data (%, $, timeframes). After table: citation <p>.`;
    case "bullet_list":
      return `OUTPUT: One intro <p> (max 1 sentence). Then <ul> with 5–7 <li> items.
Each: <strong>Bold Term:</strong> Specific data-backed sentence (max 22 words). No topic overlap.`;
    case "key_points":
      return `OUTPUT: No intro. Exactly 4 styled <li> items inside a <ul>:
<li style="background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 16px;margin:8px 0;border-radius:0 6px 6px 0;list-style:none;">
  <strong style="display:block;color:#1d4ed8;margin-bottom:4px;">Takeaway Title</strong>
  <span style="color:#374151;">One sentence with a specific stat or mechanism.</span>
</li>`;
    case "blockquote":
      return `OUTPUT: One <p> context (max ${maxS} sentences). Then:
<blockquote style="border-left:4px solid #6366f1;background:#f5f3ff;padding:20px 24px;margin:24px 0;border-radius:0 8px 8px 0;">
  <p style="font-style:italic;font-size:1.1em;color:#3730a3;margin:0 0 12px 0;">"[Expert insight with a specific stat]"</p>
  <cite style="font-weight:700;font-style:normal;color:#6366f1;font-size:0.9em;">— Name, Title/Publication, Year</cite>
</blockquote>
One closing <p> (max ${maxS} sentences).`;
    default:
      return `OUTPUT: Exactly 2–3 <p> blocks. Each <p>: MAX ${maxS} sentences. HARD LIMIT.
Lead with the most critical fact. Use <strong> for 1–2 key data points. At least one stat.`;
  }
}

function getLangRule(language: string) {
  return language.toLowerCase().includes("tr")
    ? "LANGUAGE: Fluent natural Turkish. No translation artifacts. Perfect grammar."
    : "LANGUAGE: Native American English. Active voice, direct, confident. Contractions OK.";
}

// ---------------------------------------------------------------------------
// Lead summary — prepended before the first H2 of the article
// ---------------------------------------------------------------------------
async function generateLeadSummary(
  keyword: string,
  articleTitle: string,
  sections: string[],
  language: string
): Promise<string> {
  const langRule = language.toLowerCase().includes("tr")
    ? "Akıcı, doğal Türkçe."
    : "Native American English. Journalistic, direct.";

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    temperature: 0.4,
    messages: [{
      role: "user",
      content: `Write a styled HTML lead summary for an article titled "${articleTitle}" about "${keyword}".
Sections covered: ${sections.slice(0, 6).join(", ")}.
${langRule}

Open with a STRIKING stat or problem statement. Preview 3 key takeaways.
Use this exact structure (inline styles only — no classes):

<div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:12px;padding:24px 28px;margin:24px 0 32px;">
  <p style="font-size:1.05em;color:#1e293b;line-height:1.8;margin:0 0 16px 0;"><strong style="color:#1d4ed8;">[Hook with specific stat].</strong> [2 sentences expanding the challenge].</p>
  <ul style="margin:0;padding:0 0 0 20px;list-style:disc;">
    <li style="color:#374151;margin-bottom:6px;line-height:1.6;"><strong>[Key takeaway 1]</strong></li>
    <li style="color:#374151;margin-bottom:6px;line-height:1.6;"><strong>[Key takeaway 2]</strong></li>
    <li style="color:#374151;line-height:1.6;"><strong>[Key takeaway 3]</strong></li>
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

    const language: string = researchBlueprint.language || "en-US";
    const keyword: string = researchBlueprint.keyword || "Topic";
    const articleTitle: string = researchBlueprint.articleTitle || keyword;
    const selectedKeywords: string[] = researchBlueprint.selectedKeywords || [];
    const isFirstSection = sectionIndex === 0;

    // Sub-headings the user placed under this H2 in Outline Architect
    const subHeadings: string[] = sectionPlan.subHeadings || [];

    // ── Internal link ────────────────────────────────────────────────────
    const internalLinks: string[] = researchBlueprint.extractedContext?.availableInternalLinks || [];
    let linkInstruction = "";
    if (internalLinks.length > 0) {
      const link = internalLinks[sectionIndex % internalLinks.length];
      linkInstruction = `[INTERNAL LINK — MANDATORY]: Embed ONCE as a natural anchor:
<a href="${link}" style="color:#2563eb;text-decoration:underline;">[3–5 word relevant anchor text — never "click here"]</a>\n\n`;
    }

    // ── External citations — 2 per section, real URLs ───────────────────
    const cite1 = getCitation(keyword, sectionIndex);
    const cite2 = FALLBACK_CITATIONS[(sectionIndex + 2) % FALLBACK_CITATIONS.length];

    linkInstruction += `[EXTERNAL CITATIONS — MANDATORY — USE BOTH]:
1. According to <a href="${cite1.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite1.label}</a>, [specific plausible stat with a real number].
2. Use <a href="${cite2.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite2.label}</a> in a different paragraph or table note.

RULES: Both links must appear. Embed in natural prose. Stats must include specific numbers. Use ONLY these exact URLs.`;

    // ── Keyword density ─────────────────────────────────────────────────
    const kwInstruction = selectedKeywords.length > 0
      ? `[KEYWORD OPTIMIZATION]: Naturally use these keywords (1–2% density, no stuffing): ${selectedKeywords.slice(0, 6).join(", ")}.`
      : "";

    // ── Sub-heading structure — expand user's H3/H4 into content ────────
    const subHeadingInstruction = subHeadings.length > 0
      ? `[SUB-SECTIONS REQUIRED]: The user specifically requested these sub-topics inside this section.
Cover each one with a styled <h3> or <h4> heading followed by 1–2 paragraphs of content:
${subHeadings.map((sh, idx) => `  ${idx + 1}. ${sh}`).join("\n")}
Do NOT skip any of these sub-topics.`
      : "";

    // ── Callout blocks (paragraph sections, alternating) ────────────────
    const calloutColors = [
      { bg: "#faf5ff", border: "#8b5cf6", label: "📊 By the Numbers" },
      { bg: "#f0fdf4", border: "#22c55e", label: "✅ Pro Tip" },
      { bg: "#eff6ff", border: "#3b82f6", label: "ℹ️ Key Insight" },
      { bg: "#fffbeb", border: "#f59e0b", label: "⚡ Quick Win" },
    ];
    const cc = calloutColors[sectionIndex % 4];
    const calloutInstruction =
      sectionPlan.requiredFormat === "paragraph" && sectionIndex % 2 === 0
        ? `[CALLOUT — ADD AFTER MAIN PARAGRAPHS]:
<div style="background:${cc.bg};border-left:4px solid ${cc.border};padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 6px 0;font-weight:700;color:${cc.border};font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em;">${cc.label}</p>
  <p style="margin:0;color:#1f2937;line-height:1.7;">[One specific compelling stat — max 25 words]</p>
</div>`
        : "";

    // ── System prompt ────────────────────────────────────────────────────
    const systemPrompt = `You are an elite WordPress SEO Content Specialist.
SECTION: "${sectionPlan.title}"
KEYWORD: "${keyword}"
${getLangRule(language)}

════════════ ABSOLUTE RULES ════════════
1. RAW HTML ONLY — Zero Markdown. No **bold**, no [link](url).
2. NO <h2> — System adds the section heading. Output body content only.
3. TECHNICAL ACCURACY — Real plausible numbers. No vague claims.
4. NO REPETITION — Cover angles not already stated in the section title.
5. WORDPRESS INLINE STYLES — All style="" with double quotes. No class= on new elements.
6. COVER ALL SUB-TOPICS — If sub-headings are listed below, every one must appear.
════════════════════════════════════════

${getFormatInstruction(sectionPlan.requiredFormat, sectionPlan.maxParagraphSentences)}

${subHeadingInstruction}

${linkInstruction}

${kwInstruction}

${calloutInstruction}

Return ONLY the inner HTML. No <h2>. No wrapper <div>. No code fences.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2400,
      system: systemPrompt,
      messages: [{ role: "user", content: `Write HTML for: "${sectionPlan.title}"` }],
      temperature: 0.45,
    });

    const contentBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // ── Image — Gemini Imagen via generateContent endpoint ───────────────
    let imgHtml = "";
    if (sectionPlan.includeImage) {
      try {
        // Step 1: Generate an optimized image prompt with Claude
        const imgPromptRes = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 100,
          messages: [{
            role: "user",
            content: `Photorealistic editorial image for "${sectionPlan.title}" about "${keyword}". Professional quality, no text in image. Under 80 characters.`,
          }],
          temperature: 0.7,
        });
        const imgPromptBlock = imgPromptRes.content.find(
          (b): b is Anthropic.TextBlock => b.type === "text"
        );
        const imgPrompt = (imgPromptBlock?.text || `Professional photo about ${keyword}`).slice(0, 80);

        // Step 2: Generate image with Gemini (falls back to placeholder if unavailable)
        const imageDataUri = await generateImageWithGemini(imgPrompt);
        const imgSrc = imageDataUri
          ?? `https://placehold.co/1200x630/1e40af/ffffff?text=${encodeURIComponent(imgPrompt.slice(0, 60))}`;

        imgHtml = `<!-- wp:image {"sizeSlug":"large"} -->
<figure style="margin:32px 0;text-align:center;">
  <img src="${imgSrc}" alt="${sectionPlan.title.replace(/"/g, "&quot;")}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.10);" loading="lazy" width="1200" height="630" />
  <figcaption style="text-align:center;font-size:0.85em;color:#6b7280;font-style:italic;margin-top:8px;">${sectionPlan.title}</figcaption>
</figure>
<!-- /wp:image -->`;
      } catch {
        // Image failure must never block content delivery
      }
    }

    // ── Lead summary (first section only) ───────────────────────────────
    let leadSummaryHtml = "";
    if (isFirstSection && allSectionTitles?.length > 0) {
      try {
        leadSummaryHtml = await generateLeadSummary(
          keyword, articleTitle, allSectionTitles, language
        );
      } catch { /* non-critical */ }
    }

    // ── Assemble final chunk ─────────────────────────────────────────────
    const h2 = `<h2 style="font-size:1.6em;font-weight:700;margin:40px 0 20px;padding-bottom:8px;border-bottom:2px solid #e0e7ff;color:#1e293b;">${sectionPlan.title}</h2>`;
    const imageBlock = imgHtml ? `\n${imgHtml}\n` : "";
    const leadBlock = leadSummaryHtml ? `\n${leadSummaryHtml}\n` : "";

    const finalChunk = isFirstSection
      ? `${leadBlock}${h2}${imageBlock}\n${generatedHtml}`
      : `${h2}${imageBlock}\n${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk }, { status: 200 });
  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}