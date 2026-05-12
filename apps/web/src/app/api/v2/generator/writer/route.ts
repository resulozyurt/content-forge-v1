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
// Live citation lookup via Serper — returns real article URLs, not homepages
// ---------------------------------------------------------------------------
interface Citation { url: string; label: string }

const STATIC_FALLBACKS: Citation[] = [
  { url: "https://www.mckinsey.com/capabilities/operations/our-insights", label: "McKinsey & Company" },
  { url: "https://www.statista.com/topics/market-research", label: "Statista" },
  { url: "https://www.ibm.com/think/topics/ai-for-business", label: "IBM Institute for Business Value" },
  { url: "https://www.deloitte.com/global/en/about/press-room/deloitte-insights.html", label: "Deloitte Insights" },
  { url: "https://www.gartner.com/en/newsroom/press-releases", label: "Gartner" },
  { url: "https://hbr.org/topic/subject/strategy", label: "Harvard Business Review" },
];

const PREFERRED_DOMAINS = [
  "hbr.org", "mckinsey.com", "deloitte.com", "ibm.com", "gartner.com",
  "statista.com", "nrf.com", "osha.gov", "constructiondive.com",
  "contentmarketinginstitute.com", "moz.com", "hubspot.com",
  "techcrunch.com", "venturebeat.com", "forbes.com",
];

const BLOCKED_DOMAINS = [
  "reddit.com", "quora.com", "linkedin.com", "facebook.com", "twitter.com",
  "pinterest.com", "amazon.", "youtube.com", "ideawake.com", "g2.com",
];

async function fetchLiveCitation(keyword: string, sectionTitle: string, fallbackIndex: number): Promise<Citation> {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) return STATIC_FALLBACKS[fallbackIndex % STATIC_FALLBACKS.length];

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `${sectionTitle} ${keyword} statistics data research`, num: 10 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const results: any[] = (await res.json()).organic || [];

    const cleanResults = results.filter(
      (r) => r.link && !BLOCKED_DOMAINS.some((d) => (r.link as string).toLowerCase().includes(d))
    );
    const preferred = cleanResults.find((r) =>
      PREFERRED_DOMAINS.some((d) => (r.link as string).toLowerCase().includes(d))
    );
    const candidate = preferred ?? cleanResults[0];

    if (candidate?.link) {
      const domain = new URL(candidate.link).hostname.replace(/^www\./, "");
      const label = domain.split(".").slice(0, -1).join(" ")
        .replace(/-/g, " ").split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || domain;
      console.log(`[CITATION_LIVE] "${sectionTitle}" → ${candidate.link}`);
      return { url: candidate.link, label };
    }
  } catch (err: any) {
    console.warn("[CITATION_LIVE] Serper failed:", err.message);
  }
  return STATIC_FALLBACKS[fallbackIndex % STATIC_FALLBACKS.length];
}

// ---------------------------------------------------------------------------
// Format instructions per section type
// ---------------------------------------------------------------------------
function getFormatInstruction(requiredFormat: string, maxS: number = 2): string {
  switch (requiredFormat) {
    case "html_table":
      return `OUTPUT FORMAT — DATA TABLE:
- ONE intro <p> (max 15 words). A <table> with <thead>/<tbody>.
- Min 5 rows, 3–4 columns. REAL benchmark data (%, $, timeframes).
- After table: ONE citation <p>.`;
    case "bullet_list":
      return `OUTPUT FORMAT — BULLET LIST:
- ONE intro <p> (max 1 sentence, 15 words). Then <ul> with 4–6 <li> items.
- Each <li>: <strong>Bold Term:</strong> ONE sentence (max 18 words). No topic overlap.`;
    case "key_points":
      return `OUTPUT FORMAT — KEY TAKEAWAYS:
- No intro. Exactly 4 styled <li> inside <ul>:
  <li style="background:#eff6ff;border-left:3px solid #3b82f6;padding:10px 14px;margin:6px 0;border-radius:0 6px 6px 0;list-style:none;">
    <strong style="display:block;color:#1d4ed8;margin-bottom:3px;">Short Takeaway (max 6 words)</strong>
    <span style="color:#374151;font-size:0.9em;">One sentence with a specific stat. Max 20 words.</span>
  </li>`;
    case "blockquote":
      return `OUTPUT FORMAT — EXPERT QUOTE:
- ONE context <p> (max 2 sentences, 30 words total).
- ONE <blockquote style="border-left:4px solid #6366f1;background:#f5f3ff;padding:18px 22px;margin:20px 0;border-radius:0 8px 8px 0;">
    <p style="font-style:italic;font-size:1.05em;color:#3730a3;margin:0 0 10px 0;">"[Expert insight with a specific stat. Max 40 words.]"</p>
    <cite style="font-weight:700;font-style:normal;color:#6366f1;font-size:0.85em;">— Name, Title/Publication, Year</cite>
  </blockquote>
- ONE closing <p> (max 2 sentences, 25 words).`;
    default:
      return `OUTPUT FORMAT — SHORT PARAGRAPHS:
- EXACTLY 2–3 <p> blocks. Each <p>: MAX ${maxS} sentences. ABSOLUTE HARD LIMIT.
- Lead with the most critical fact. Use <strong> for 1–2 key data points. Include ONE specific stat.
- After the last <p>, add ONE styled callout:
  <div style="background:#faf5ff;border-left:4px solid #8b5cf6;padding:14px 18px;margin:20px 0;border-radius:0 8px 8px 0;">
    <p style="margin:0 0 4px;font-weight:700;color:#8b5cf6;font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;">📊 By the Numbers</p>
    <p style="margin:0;color:#1f2937;font-size:0.95em;line-height:1.6;">[One specific stat — max 20 words]</p>
  </div>`;
  }
}

function getLangRule(language: string): string {
  return language.toLowerCase().includes("tr")
    ? "LANGUAGE: Fluent natural Turkish. No translation artifacts."
    : "LANGUAGE: Native American English. Active voice, direct, confident.";
}

// ---------------------------------------------------------------------------
// Lead summary — first section only
// ---------------------------------------------------------------------------
async function generateLeadSummary(
  keyword: string, articleTitle: string, sections: string[], language: string
): Promise<string> {
  const langRule = language.toLowerCase().includes("tr")
    ? "Akıcı, kısa Türkçe. Her madde max 10 kelime."
    : "Crisp American English. Each bullet under 12 words.";
  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 400, temperature: 0.4,
    messages: [{ role: "user", content:
      `Write a concise HTML lead summary for "${articleTitle}" about "${keyword}".
Sections: ${sections.slice(0, 5).join(", ")}. ${langRule}
Hook: ONE sentence with a specific stat (max 20 words). Preview: 3 bullets, each under 12 words.

<div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:12px;padding:20px 24px;margin:20px 0 28px;">
  <p style="font-size:1em;color:#1e293b;line-height:1.7;margin:0 0 12px 0;"><strong style="color:#1d4ed8;">[Hook with stat].</strong> [One follow-up sentence max 15 words].</p>
  <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">
    <li style="color:#374151;margin-bottom:5px;line-height:1.5;font-size:0.95em;"><strong>[Takeaway 1 — max 10 words]</strong></li>
    <li style="color:#374151;margin-bottom:5px;line-height:1.5;font-size:0.95em;"><strong>[Takeaway 2 — max 10 words]</strong></li>
    <li style="color:#374151;line-height:1.5;font-size:0.95em;"><strong>[Takeaway 3 — max 10 words]</strong></li>
  </ul>
</div>
Return ONLY the raw HTML. No code fences.` }],
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
    const narrativeThread: string  = researchBlueprint.narrativeThread || "";
    const sectionRole: string      = sectionPlan.sectionRole || "body";
    const assignedPAA: string|null = sectionPlan.assignedPAA || null;
    const contentGap: string|null  = sectionPlan.contentGap || null;
    const prevTitle: string|null   = sectionPlan.prevSectionTitle || null;
    const nextTitle: string|null   = sectionPlan.nextSectionTitle || null;

    // ── Internal link — semantic scoring + guaranteed uniqueness ──────────
    const stopWords = new Set([
      "with","that","this","from","have","will","your","their","which","about",
      "into","more","also","such","each","than","when","were","been","they",
      "what","where","some","these","those","both","after","being","there",
      "through","during","before","between","should","could","would",
    ]);
    const allInternalLinks: string[] = researchBlueprint.extractedContext?.availableInternalLinks || [];
    let linkInstruction = "";
    const internalLinkSlot = Math.floor(sectionIndex / 2);
    const maxInternalLinks = 5;

    if (allInternalLinks.length > 0 && internalLinkSlot < maxInternalLinks) {
      const queryTerms = `${sectionPlan.title} ${keyword}`
        .toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));

      const scoredLinks = allInternalLinks.map((url) => {
        try {
          const urlObj = new URL(url);
          const path = (urlObj.pathname + " " + urlObj.hostname).toLowerCase().replace(/[-_/]/g, " ");
          const score = queryTerms.reduce(
            (acc, term) => acc + (path.includes(term) ? 2 : 0) + (url.toLowerCase().includes(term) ? 1 : 0), 0
          );
          return { url, score };
        } catch { return { url, score: 0 }; }
      });

      scoredLinks.sort((a, b) => b.score - a.score || a.url.length - b.url.length);

      // Prime-number offset guarantees a different URL per section slot
      const pickIndex = (internalLinkSlot * 7) % scoredLinks.length;
      const link = scoredLinks[pickIndex].url;
      console.log(`[INTERNAL_LINK] slot:${internalLinkSlot} score:${scoredLinks[pickIndex].score} → ${link}`);

      linkInstruction = `[INTERNAL LINK — MANDATORY]: Embed this URL ONCE as a short inline anchor inside a sentence:
<a href="${link}" style="color:#2563eb;text-decoration:underline;">[3–5 word anchor text]</a>
CRITICAL RULES:
- The <a> tag must wrap ONLY 3–5 words — NEVER an entire sentence, paragraph, or <li> element.
- Correct: "...which is why <a href="...">retail execution tools</a> matter..."
- WRONG:  <a href="..."><li>Entire bullet point text here...</li></a>
- Anchor text must be a natural noun phrase describing the destination page.

`;
    }

    // ── Live citations — two per section, parallel fetch ─────────────────
    const [cite1, cite2] = await Promise.all([
      fetchLiveCitation(keyword, sectionPlan.title, sectionIndex),
      fetchLiveCitation(keyword, `${sectionPlan.title} data statistics`, sectionIndex + 10),
    ]);

    linkInstruction += `[CITATIONS — MANDATORY — USE BOTH]:
1. According to <a href="${cite1.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite1.label}</a>, [specific plausible stat with a real number].
2. In a different paragraph: <a href="${cite2.url}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">${cite2.label}</a> — embed in natural prose.
RULES: Both links MUST appear. Stats must include real numbers. Use ONLY these exact URLs.`;

    // ── Keyword density ──────────────────────────────────────────────────
    const kwInstruction = selectedKeywords.length > 0
      ? `[KEYWORDS]: Use naturally (1–2% density): ${selectedKeywords.slice(0, 5).join(", ")}.`
      : "";

    // ── Brand voice — distributed, not last-paragraph-only ───────────────
    const brandDesc: string     = brand.description || "";
    const brandFeatures: string = brand.keyFeatures || brand.features || "";
    const isBrandSection = brandEnabled && brandName &&
      (sectionIndex === 1 || sectionIndex === 3 || sectionIndex >= 5);

    const brandInstruction = isBrandSection
      ? `[BRAND VOICE — REQUIRED IN THIS SECTION]:
Weave "${brandName}" into the narrative NATURALLY — not in the last paragraph.
1. EARLY placement: Mention ${brandName} within the first or second paragraph.
2. CONTEXTUAL framing: Connect the brand to the specific problem discussed here.
   Patterns: "Platforms like ${brandName} address this by..." / "Teams using ${brandName} report..."
3. Brand facts for credibility: ${brandDesc ? brandDesc.slice(0, 150) : ""} ${brandFeatures ? `| Features: ${brandFeatures.slice(0, 150)}` : ""}
4. ONE mention only — make it earn its place with a real benefit claim.
5. Only add CTA if this section concludes a point: "${brandCta}"`
      : "";

    // ── Sub-headings ──────────────────────────────────────────────────────
    const subHeadingInstruction = subHeadings.length > 0
      ? `[SUB-SECTIONS REQUIRED]:
${subHeadings.map((sh, i) => `  ${i + 1}. ${sh}`).join("\n")}
For each: <h3> or <h4> heading + 1–2 short <p> (max 2 sentences, max 20 words each).`
      : "";

    // ── Narrative context instructions ────────────────────────────────────
    const narrativeInstruction = [
      narrativeThread ? `[ARTICLE NARRATIVE — EDITORIAL BRIEF]:\n"${narrativeThread}"\nEvery sentence should feel like it belongs in this story arc.` : "",
      sectionRole === "intro" ? "[INTRO ROLE]: Hook the reader with a striking stat or problem in the very first sentence. Preview the article's value without giving everything away." : "",
      sectionRole === "conclusion" ? "[CONCLUSION ROLE]: Synthesize key insights into 2–3 actionable takeaways. Do NOT repeat earlier content verbatim — elevate it. End with a forward-looking statement." : "",
      assignedPAA ? `[PAA ANSWER — REQUIRED]: Directly answer this question within the first 2 sentences (featured snippet format), then expand: "${assignedPAA}"` : "",
      contentGap ? `[COMPETITOR GAP TO EXPLOIT]: No competitor covers this — make it a strength of this section: "${contentGap}"` : "",
      prevTitle ? `[TRANSITION FROM PREVIOUS]: The previous section covered "${prevTitle}". Open with a brief connective sentence bridging from that topic.` : "",
      nextTitle ? `[SETUP FOR NEXT]: The next section covers "${nextTitle}". Close with a sentence that naturally sets up that transition.` : "",
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
═══════════════════════════════

${getFormatInstruction(sectionPlan.requiredFormat, Math.min(sectionPlan.maxParagraphSentences || 2, 2))}

${subHeadingInstruction}

${linkInstruction}

${kwInstruction}

${brandInstruction}

${narrativeInstruction}

Return ONLY the inner HTML. No <h2>. No wrapper div. No code fences.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: `Write HTML for: "${sectionPlan.title}"` }],
      temperature: 0.4,
    });
    const contentBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    // ── Image — every section ─────────────────────────────────────────────
    let imgHtml = "";
    try {
      const imgPromptRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 100,
        messages: [{ role: "user", content:
          `Photorealistic editorial image for "${sectionPlan.title}" about "${keyword}". Professional, no text in image. Max 80 chars.` }],
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

    // ── Lead summary (section 0 only) ─────────────────────────────────────
    let leadSummaryHtml = "";
    if (isFirstSection && allSectionTitles?.length > 0) {
      try { leadSummaryHtml = await generateLeadSummary(keyword, articleTitle, allSectionTitles, language); }
      catch { /* non-critical */ }
    }

    // ── Assemble ──────────────────────────────────────────────────────────
    const h2 = `<h2 style="font-size:1.6em;font-weight:700;margin:36px 0 18px;padding-bottom:8px;border-bottom:2px solid #e0e7ff;color:#1e293b;">${sectionPlan.title}</h2>`;
    const finalChunk = isFirstSection
      ? `\n${leadSummaryHtml}\n${h2}\n${imgHtml}\n${generatedHtml}`
      : `${h2}\n${imgHtml}\n${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk }, { status: 200 });
  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}