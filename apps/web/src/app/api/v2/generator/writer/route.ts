// apps/web/src/app/api/v2/generator/writer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// Authority citation domains by topic
// ---------------------------------------------------------------------------
const AUTHORITY_DOMAINS: Record<string, string[]> = {
  default: [
    "https://hbr.org",
    "https://www.mckinsey.com/insights",
    "https://www.gartner.com/en/newsroom",
    "https://www.statista.com",
    "https://www.forbes.com",
    "https://www.ibm.com/think",
    "https://www.deloitte.com/insights",
    "https://www.pwc.com/gx/en/insights",
  ],
  retail: ["https://www.retaildive.com", "https://nrf.com/blog", "https://www.fmi.org"],
  tech: ["https://techcrunch.com", "https://venturebeat.com", "https://www.wired.com"],
  marketing: [
    "https://contentmarketinginstitute.com",
    "https://moz.com/blog",
    "https://blog.hubspot.com",
  ],
  finance: ["https://www.bloomberg.com", "https://www.wsj.com"],
};

function getDomainPool(keyword: string): string[] {
  const kw = keyword.toLowerCase();
  if (kw.match(/retail|shop|store|shelf|category|merchandis/))
    return [...AUTHORITY_DOMAINS.retail, ...AUTHORITY_DOMAINS.default];
  if (kw.match(/tech|software|ai|data|cloud|cyber/))
    return [...AUTHORITY_DOMAINS.tech, ...AUTHORITY_DOMAINS.default];
  if (kw.match(/market|seo|content|social|brand/))
    return [...AUTHORITY_DOMAINS.marketing, ...AUTHORITY_DOMAINS.default];
  if (kw.match(/finance|invest|bank|crypto|stock/))
    return [...AUTHORITY_DOMAINS.finance, ...AUTHORITY_DOMAINS.default];
  return AUTHORITY_DOMAINS.default;
}

// ---------------------------------------------------------------------------
// WordPress-compatible decorative HTML blocks
// ---------------------------------------------------------------------------
function getWPCalloutBlock(type: "info" | "warning" | "tip" | "stat"): string {
  const configs = {
    info: {
      bg: "#eff6ff",
      border: "#3b82f6",
      icon: "ℹ️",
      label: "Key Insight",
      darkBg: "#1e3a5f",
    },
    warning: {
      bg: "#fffbeb",
      border: "#f59e0b",
      icon: "⚠️",
      label: "Important",
      darkBg: "#3d2e00",
    },
    tip: {
      bg: "#f0fdf4",
      border: "#22c55e",
      icon: "✅",
      label: "Pro Tip",
      darkBg: "#0f2e1a",
    },
    stat: {
      bg: "#faf5ff",
      border: "#8b5cf6",
      icon: "📊",
      label: "By the Numbers",
      darkBg: "#2d1b69",
    },
  };
  const c = configs[type];
  return `\n<!-- wp:html -->
<div style="background:${c.bg};border-left:4px solid ${c.border};padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
  <p style="margin:0 0 6px 0;font-weight:700;color:${c.border};font-size:0.85em;text-transform:uppercase;letter-spacing:0.05em;">${c.icon} ${c.label}</p>
  <p style="margin:0;color:#1f2937;line-height:1.7;">{{CALLOUT_CONTENT}}</p>
</div>
<!-- /wp:html -->\n`;
}

// ---------------------------------------------------------------------------
// Format instructions per section type
// ---------------------------------------------------------------------------
function getFormatInstruction(requiredFormat: string, maxSentences: number = 2): string {
  const maxS = maxSentences || 2;

  switch (requiredFormat) {
    case "html_table":
      return `OUTPUT FORMAT — DATA TABLE:
- One short <p> intro sentence (max 20 words).
- HTML <table> with proper <thead> and <tbody>.
- At least 5 data rows, 3–4 columns.
- Every cell must contain REAL, specific data (percentages, dollar amounts, time periods — all plausible industry benchmarks).
- After the table, one attribution <p> with an external source link.
- NO other block elements.`;

    case "bullet_list":
      return `OUTPUT FORMAT — VISUAL BULLET LIST:
- One short intro <p> (max 1 sentence, 20 words hard limit).
- Then a <ul> list.
- Exactly 5–7 items. Each item: <li><strong>Bold key term:</strong> One specific, data-backed sentence.</li>
- Items must cover distinct angles — zero overlap in meaning.
- NO additional paragraphs after the list.`;

    case "key_points":
      return `OUTPUT FORMAT — KEY TAKEAWAYS:
- NO intro paragraph.
- A <ul> list with 4 items, each styled as a visual callout:
  <li style="background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 16px;margin:8px 0;border-radius:0 6px 6px 0;list-style:none;">
    <strong style="display:block;color:#1d4ed8;margin-bottom:4px;">Specific Takeaway Title</strong>
    <span style="color:#374151;">Supporting sentence with a concrete statistic or fact.</span>
  </li>
- Each takeaway must include a REAL quantitative claim.
- NO additional block elements.`;

    case "blockquote":
      return `OUTPUT FORMAT — EXPERT INSIGHT + CONTEXT:
- ONE short <p> (max ${maxS} sentences) setting context.
- A <blockquote> styled for WordPress:
  <blockquote style="border-left:4px solid #6366f1;background:#f5f3ff;padding:20px 24px;margin:24px 0;border-radius:0 8px 8px 0;">
    <p style="font-style:italic;font-size:1.1em;color:#3730a3;margin:0 0 12px 0;">"[Specific, data-rich expert insight — not a generic platitude. Include a real stat or mechanism.]"</p>
    <cite style="font-weight:700;font-style:normal;color:#6366f1;font-size:0.9em;">— Expert Name, Title/Publication, Year</cite>
  </blockquote>
- ONE closing <p> (max ${maxS} sentences) with actionable implication.`;

    default: // paragraph
      return `OUTPUT FORMAT — SHORT PARAGRAPHS:
- Lead the FIRST <p> with the most critical fact or claim (inverted pyramid).
- Write EXACTLY 2–3 <p> blocks. Each <p>: MAX ${maxS} sentences. HARD LIMIT.
- Use <strong> for 1–2 key terms or data points per section.
- Include at least ONE specific statistic or percentage.
- If includeH3 applies, add ONE descriptive <h3> between paragraphs.`;
  }
}

// ---------------------------------------------------------------------------
// Language rules
// ---------------------------------------------------------------------------
function getLanguageRule(language: string): string {
  if (language.toLowerCase().includes("tr")) {
    return `DİL: Akıcı, doğal Türkçe. Özne-yüklem uyumu tam olmalı. Teknik terimlerde Türkçe karşılık kullan. Resmi ama sıcak ton. Çeviri kokusu kesinlikle olmamalı.`;
  }
  return `LANGUAGE: Native American English. Active voice. Direct, confident. Contractions allowed (it's, you'll). Concrete nouns over abstracts.`;
}

// ---------------------------------------------------------------------------
// Lead summary block — generated ONLY for the first section (introduction)
// ---------------------------------------------------------------------------
async function generateLeadSummary(
  keyword: string,
  articleTitle: string,
  sections: string[],
  language: string
): Promise<string> {
  const isTurkish = language.toLowerCase().includes("tr");
  const langRule = isTurkish
    ? "Akıcı, doğal Türkçe. Resmi ama erişilebilir ton."
    : "Native American English. Direct, journalistic style.";

  const prompt = `You are writing a "lead summary" block for a professional SEO article.
Article title: "${articleTitle}"
Primary keyword: "${keyword}"
Main sections covered: ${sections.slice(0, 5).join(", ")}
${langRule}

Write a visually structured HTML lead summary — a 3-5 sentence executive overview placed BEFORE the first H2.
Requirements:
1. Open with a striking statistic or problem statement (first sentence = the hook).
2. Briefly preview the 3 most valuable things the reader will learn.
3. Output as a styled WordPress-compatible HTML div — NO Markdown:

<div style="background:linear-gradient(135deg,#1e40af08,#7c3aed08);border:1px solid #e0e7ff;border-radius:12px;padding:24px 28px;margin:32px 0;">
  <p style="font-size:1.05em;color:#1e293b;line-height:1.8;margin:0 0 16px 0;"><strong style="color:#1d4ed8;">[Hook sentence with specific stat].</strong> [2–3 sentences expanding the key tension or opportunity].</p>
  <ul style="margin:0;padding:0 0 0 20px;list-style:disc;">
    <li style="color:#374151;margin-bottom:6px;line-height:1.6;"><strong>What you'll learn #1</strong></li>
    <li style="color:#374151;margin-bottom:6px;line-height:1.6;"><strong>What you'll learn #2</strong></li>
    <li style="color:#374151;line-height:1.6;"><strong>What you'll learn #3</strong></li>
  </ul>
</div>

Return ONLY the raw HTML div. No code fences. No explanation.`;

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
  });

  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return (block?.text || "")
    .replace(/^```html\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Main route
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { researchBlueprint, sectionPlan, allSectionTitles, sectionIndex } = await req.json();

    const language: string = researchBlueprint.language || "en-US";
    const keyword: string = researchBlueprint.keyword || "Topic";
    const articleTitle: string = researchBlueprint.articleTitle || keyword;
    const isFirstSection: boolean = sectionIndex === 0;

    // ── Internal link ────────────────────────────────────────────────────
    const internalLinks: string[] =
      researchBlueprint.extractedContext?.availableInternalLinks || [];
    let linkInstruction = "";
    if (internalLinks.length > 0) {
      const link = internalLinks[sectionIndex % internalLinks.length];
      linkInstruction = `[INTERNAL LINK]: Embed ONCE as a natural anchor: <a href="${link}" style="color:#2563eb;text-decoration:underline;">3–5 word anchor text</a>. Anchor must be topically relevant — never "click here" or raw URL.`;
    }

    // ── External citation ──────────────────────────────────────────────────
    const domainPool = getDomainPool(keyword);
    const citationDomain = domainPool[Math.floor(Math.random() * domainPool.length)];
    linkInstruction += `\n[EXTERNAL CITATION — MANDATORY]: Include ONE external citation using domain: ${citationDomain}
Format: According to <a href="${citationDomain}" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">[Publication Name]</a>, [specific plausible statistic or finding].`;

    // ── Format + Language ──────────────────────────────────────────────────
    const formatInstruction = getFormatInstruction(
      sectionPlan.requiredFormat,
      sectionPlan.maxParagraphSentences
    );
    const languageRule = getLanguageRule(language);

    // ── Decorative callout — inject for every 2nd paragraph section ──────
    const calloutTypes: Array<"info" | "tip" | "stat" | "warning"> = [
      "stat",
      "tip",
      "info",
      "tip",
    ];
    const calloutTemplate =
      sectionPlan.requiredFormat === "paragraph" && sectionIndex % 2 === 0
        ? getWPCalloutBlock(calloutTypes[sectionIndex % 4])
        : "";

    // ── System prompt ────────────────────────────────────────────────────
    const systemPrompt = `You are an elite WordPress SEO Content Specialist.
SECTION: "${sectionPlan.title}"
KEYWORD: "${keyword}"
${languageRule}

═══════════════════════════ ABSOLUTE RULES ═══════════════════════════
1. RAW HTML ONLY — Zero Markdown. No **bold**, no [link](url).
2. NO <h2> TAG — Do NOT write the section title. System adds it.
3. NO DUPLICATE IDEAS — Content must cover angles NOT stated in the section title.
4. TECHNICAL ACCURACY — Use real, plausible statistics. Prefer specific numbers.
5. SCANNABILITY — Readers must skim successfully. Enforce format below.
6. WORDPRESS COMPATIBILITY — All inline styles use double quotes. No class= attributes.
══════════════════════════════════════════════════════════════════════

${formatInstruction}

${linkInstruction}

${
  calloutTemplate
    ? `[CALLOUT BLOCK — MANDATORY]: After your main content, include this WordPress callout block. Replace {{CALLOUT_CONTENT}} with a specific, relevant stat or insight (1 sentence, under 25 words):
${calloutTemplate}`
    : ""
}

Return ONLY the inner HTML. No <h2>. No wrapper <div>. No code fences.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2200,
      system: systemPrompt,
      messages: [
        { role: "user", content: `Write the HTML content for section: "${sectionPlan.title}"` },
      ],
      temperature: 0.45,
    });

    const contentBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    // ── Image block (placeholder until real image API integrated) ────────
    let imgHtml = "";
    if (sectionPlan.includeImage) {
      try {
        const imgRes = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 100,
          messages: [
            {
              role: "user",
              content: `Describe a photorealistic editorial image for: "${sectionPlan.title}" about "${keyword}". Under 80 characters. No text in image. Output ONLY the description.`,
            },
          ],
          temperature: 0.7,
        });
        const imgBlock = imgRes.content.find((b): b is Anthropic.TextBlock => b.type === "text");
        const desc = (imgBlock?.text || sectionPlan.title).slice(0, 80);
        const encoded = encodeURIComponent(desc.slice(0, 60));

        imgHtml = `<!-- wp:image {"sizeSlug":"large"} -->
<figure class="wp-block-image size-large" style="margin:32px 0;">
  <img src="https://placehold.co/1200x630/1e3a8a/ffffff?text=${encoded}" alt="${sectionPlan.title.replace(/"/g, "&quot;")}" style="width:100%;height:auto;border-radius:8px;" loading="lazy" width="1200" height="630" />
  <figcaption style="text-align:center;font-size:0.85em;color:#6b7280;font-style:italic;margin-top:8px;">${sectionPlan.title}</figcaption>
</figure>
<!-- /wp:image -->`;
      } catch {
        // Fail silently
      }
    }

    // ── Lead summary — only for the very first section ──────────────────
    let leadSummaryHtml = "";
    if (isFirstSection && allSectionTitles?.length > 0) {
      try {
        leadSummaryHtml = await generateLeadSummary(
          keyword,
          articleTitle,
          allSectionTitles,
          language
        );
      } catch {
        // Non-critical
      }
    }

    // ── Assemble: H2 + optional lead summary + optional image + content ──
    const imageBlock = imgHtml ? `\n\n${imgHtml}\n\n` : "\n\n";
    const leadBlock = leadSummaryHtml ? `\n\n${leadSummaryHtml}\n\n` : "";

    // Lead summary goes BEFORE the first H2
    const finalChunk = isFirstSection
      ? `${leadBlock}<h2 style="font-size:1.6em;font-weight:700;margin:40px 0 20px;padding-bottom:8px;border-bottom:2px solid #e0e7ff;color:#1e293b;">${sectionPlan.title}</h2>${imageBlock}${generatedHtml}`
      : `<h2 style="font-size:1.6em;font-weight:700;margin:40px 0 20px;padding-bottom:8px;border-bottom:2px solid #e0e7ff;color:#1e293b;">${sectionPlan.title}</h2>${imageBlock}${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk }, { status: 200 });
  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}