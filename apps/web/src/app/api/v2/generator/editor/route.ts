// apps/web/src/app/api/v2/generator/editor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeLanguage } from "@/lib/language";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// TABLE BUG FIX — Layer 2 (editor agent).
// Same repair function as writer/route.ts (duplicated intentionally: these
// are independent serverless routes with no shared runtime). This is the
// SECOND defense layer: even if a chunk reaches the editor without having
// been repaired upstream (e.g. an older client, or a future writer change),
// it gets structurally closed here before either:
//   (a) passing through as "approved", or
//   (b) being sent to Claude for stylistic auto-correction.
// We ALSO add a real open/close tag-count check (previous code only checked
// for the presence of "<table", not whether it was ever closed) so a
// truncated table actively triggers the existing Claude auto-correct path
// instead of silently passing QA.
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
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      stack.push(tagName);
    }
  }

  if (stack.length === 0) return html;

  const closingTags = stack.reverse().map((t) => `</${t}>`).join("");
  console.warn(`[HTML_REPAIR][editor] Unclosed tag(s) auto-closed: ${stack.join(", ")}`);
  return html + closingTags;
}

// Returns the list of structural tag names that are unbalanced (open count
// != close count) — used to flag truncated tables/lists/blockquotes for the
// Claude auto-correct pass, independent of the deterministic repair above.
function findUnbalancedStructuralTags(html: string): string[] {
  const tracked = ["table", "thead", "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li", "blockquote"];
  const unbalanced: string[] = [];
  for (const tag of tracked) {
    const openCount = (html.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi")) || []).length;
    const closeCount = (html.match(new RegExp(`<\\/${tag}>`, "gi")) || []).length;
    if (openCount !== closeCount) unbalanced.push(`${tag} (open:${openCount} close:${closeCount})`);
  }
  return unbalanced;
}

// ---------------------------------------------------------------------------
// Validates paragraph sentence density from HTML <p> tags.
// Strips all HTML tags (including long inline style="") before counting
// sentences — prevents style attribute strings from corrupting text extraction.
// ---------------------------------------------------------------------------
function validateParagraphDensity(html: string, maxSentences: number): string[] {
  const errors: string[] = [];
  // Match <p> tags including those with long style/class attributes
  const pTagMatches = html.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/gi) || [];

  pTagMatches.forEach((pTag, index) => {
    // Strip ALL inner HTML tags first, then normalize whitespace
    const innerText = pTag.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!innerText || innerText.length < 20) return;

    const sentences = innerText
      .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜA-Za-zÀ-ÖØ-öø-ÿ])/)
      .filter((s) => s.trim().length > 15);

    if (sentences.length > maxSentences) {
      errors.push(
        `<p> tag ${index + 1} contains ${sentences.length} sentences. Max allowed: ${maxSentences}. Split into multiple <p> tags.`
      );
    }
  });

  return errors;
}

// ---------------------------------------------------------------------------
// Checks whether section title keywords are over-repeated in the body text.
// ---------------------------------------------------------------------------
function detectRepetition(html: string, sectionTitle: string): string[] {
  const errors: string[] = [];
  const titleWords = sectionTitle.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const content = html.replace(/<[^>]+>/g, " ").toLowerCase();

  let titleWordRepeats = 0;
  titleWords.forEach((word) => {
    // Escape special regex characters so titles like "OSA?" or "causes)" don't crash RegExp
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = content.match(new RegExp(`\\b${escaped}\\b`, "g")) || [];
    if (matches.length > 4) titleWordRepeats++;
  });

  if (titleWordRepeats > 2) {
    errors.push(
      "REPETITION DETECTED: Section title words appear too frequently in body text. Vary your vocabulary."
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// LANGUAGE VALIDATION (Fix #3): catches the reported failure where a section
// silently comes back in the wrong language (most often Spanish, dragged in by
// a foreign-language competitor heading). This is not full language ID — it
// only looks for high-signal markers of a language the target can NOT be
// (target is always en or tr). A hit routes the chunk into the Claude
// auto-correct path below, which now carries the hard promptRule and rewrites
// the section into the target language. Thresholds are deliberately
// conservative to avoid false positives on the odd loanword.
// ---------------------------------------------------------------------------
const SPANISH_MARKERS = [
  "que", "para", "una", "más", "pero", "esta", "este", "también", "según",
  "además", "porque", "cómo", "qué", "dónde", "por", "sus",
];
function detectLanguageMismatch(html: string, isTurkish: boolean, targetLabel: string): string[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase().trim();
  if (text.length < 40) return []; // too short to judge reliably

  // Unambiguous Spanish punctuation/diacritics weigh heavily; function words
  // add up on top. Target is only ever English or Turkish, so any strong
  // Spanish footprint is a mismatch either way.
  let spanishHits = (text.match(/[¿¡ñ]/g) || []).length;
  for (const w of SPANISH_MARKERS) {
    spanishHits += (text.match(new RegExp(`\\b${w}\\b`, "g")) || []).length;
  }
  if (spanishHits >= 5) {
    return [
      `LANGUAGE MISMATCH: The section body appears to be in the wrong language (Spanish markers detected). Rewrite the ENTIRE section in ${targetLabel}. Preserve every HTML tag, <a> href, and %%FIGURE_N%%/%%IMG_N%% placeholder exactly — translate only the human-readable text.`,
    ];
  }

  // Turkish target but zero Turkish signal alongside a clear English footprint
  // → likely English-when-Turkish.
  if (isTurkish) {
    const trHits = (text.match(/[çğışöü]/g) || []).length +
      (text.match(/\b(ve|bir|bu|için|ile|olarak|daha|gibi|çok)\b/g) || []).length;
    const enHits = (text.match(/\b(the|and|for|with|that|this|are|your|from|will)\b/g) || []).length;
    if (trHits === 0 && enHits >= 6) {
      return [
        `LANGUAGE MISMATCH: The section is expected in Turkish but appears to be in another language. Rewrite the ENTIRE section in ${targetLabel}, preserving all HTML tags, <a> hrefs, and %%FIGURE_N%%/%%IMG_N%% placeholders.`,
      ];
    }
  }

  return [];
}

export async function POST(req: NextRequest) {
  let parsedBody: any = {};

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    parsedBody = await req.json();
    const { generatedChunk: rawChunk, sectionPlan, language } = parsedBody;
    const lang = normalizeLanguage(language);

    // Guard: malformed or missing chunk — pass through immediately
    if (!rawChunk || typeof rawChunk !== "string" || rawChunk.length < 10) {
      return NextResponse.json({ status: "approved", chunk: rawChunk || "" }, { status: 200 });
    }

    // TABLE BUG FIX: deterministically close any unclosed tag the moment the
    // chunk arrives — before any validation logic runs. Whatever happens
    // downstream (approved as-is, or sent to Claude for correction), the
    // structural integrity of table/list/blockquote tags is guaranteed.
    const generatedChunk = closeUnclosedHtmlTags(rawChunk);

    const validationErrors: string[] = [];
    const lowerChunk = generatedChunk.toLowerCase();
    const maxSentences = sectionPlan?.maxParagraphSentences || 1;

    // ── Format validations ──────────────────────────────────────────────────
    if (sectionPlan?.requiredFormat === "html_table" && !lowerChunk.includes("<table")) {
      validationErrors.push("MISSING TABLE: Section requires an HTML <table> with <thead> and <tbody>. Generate a data-rich comparison table.");
    }

    // TABLE BUG FIX: the old check only looked for "<table" presence, never
    // for whether it (or any other structural tag) was actually closed. A
    // truncated table previously sailed through as "approved". This forces
    // it into the Claude auto-correct path instead, with the exact tag
    // imbalance named so Claude can fix it precisely.
    const unbalancedTags = findUnbalancedStructuralTags(generatedChunk);
    if (unbalancedTags.length > 0) {
      validationErrors.push(
        `UNCLOSED/MISMATCHED TAGS DETECTED: ${unbalancedTags.join(", ")}. Every opening tag must have a matching closing tag — rebuild the structure so it is fully balanced.`
      );
      console.warn(`[EDITOR] Unbalanced structural tags in section "${sectionPlan?.title}": ${unbalancedTags.join(", ")}`);
    }

    if (
      (sectionPlan?.requiredFormat === "bullet_list" || sectionPlan?.requiredFormat === "key_points") &&
      !lowerChunk.includes("<ul")
    ) {
      validationErrors.push("MISSING LIST: Section requires an HTML <ul> with <li> items. Generate the list structure.");
    }

    if (sectionPlan?.requiredFormat === "blockquote" && !lowerChunk.includes("<blockquote")) {
      validationErrors.push("MISSING BLOCKQUOTE: Section requires a <blockquote> element with expert quote and citation.");
    }

    // ── Paragraph density ───────────────────────────────────────────────────
    validationErrors.push(...validateParagraphDensity(generatedChunk, maxSentences));

    // ── Markdown remnants ───────────────────────────────────────────────────
    if (/\*\*(.+?)\*\*/.test(generatedChunk)) {
      validationErrors.push("MARKDOWN: Found **bold** syntax. Convert ALL instances to <strong> tags.");
    }
    if (/\[([^\]]+)\]\(([^)]+)\)/.test(generatedChunk)) {
      validationErrors.push("MARKDOWN LINK: Found [text](url) syntax. Convert to <a href='...'> tags.");
    }
    if (/^\s*#{1,3}\s/m.test(generatedChunk)) {
      validationErrors.push("MARKDOWN HEADING: Found # heading syntax. Remove all heading markdown — headings are added by the system.");
    }

    // ── Repetition check ────────────────────────────────────────────────────
    validationErrors.push(...detectRepetition(generatedChunk, sectionPlan?.title || ""));

    // ── Citation presence check ─────────────────────────────────────────────
    const hasExternalLink = /<a[^>]+(?:target="_blank"|rel="nofollow")[^>]*>/i.test(generatedChunk);
    if (!hasExternalLink && sectionPlan?.requiredFormat !== "key_points") {
      validationErrors.push("MISSING CITATION: Add at least one external authority link with target='_blank' rel='nofollow'.");
    }

    // ── Language validation (Fix #3) ─────────────────────────────────────────
    validationErrors.push(...detectLanguageMismatch(generatedChunk, lang.isTurkish, lang.label));

    // ── All checks passed ───────────────────────────────────────────────────
    if (validationErrors.length === 0) {
      return NextResponse.json({ status: "approved", chunk: generatedChunk }, { status: 200 });
    }

    // ── Auto-correct via Claude ─────────────────────────────────────────────
    // Strip <figure>/<img> blocks before sending to Claude — base64 images
    // can exceed 1M tokens and crash the API. Re-inject them after correction.
    const figureRegex = /<figure[\s\S]*?<\/figure>/gi;
    const extractedFigures: string[] = [];
    let chunkForClaude = generatedChunk.replace(figureRegex, (match: string) => {
      extractedFigures.push(match);
      return `%%FIGURE_${extractedFigures.length - 1}%%`;
    });

    // Also strip standalone <img> tags not wrapped in <figure>
    const imgRegex = /<img(?:[^>]*)src="data:[^"]{100,}"[^>]*>/gi;
    const extractedImgs: string[] = [];
    chunkForClaude = chunkForClaude.replace(imgRegex, (match: string) => {
      extractedImgs.push(match);
      return `%%IMG_${extractedImgs.length - 1}%%`;
    });

    const langRule = lang.promptRule;

    const correctionPrompt = `You are a strict HTML Content Editor. Fix ALL the listed errors in the draft HTML.

ERRORS TO FIX:
${validationErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

ABSOLUTE RULES:
1. ${langRule}
2. PRESERVE unchanged: <h2>, %%FIGURE_N%% placeholders, %%IMG_N%% placeholders, existing <a> links.
3. Each <p> tag: MAX ${maxSentences} sentences. Split longer text into multiple <p> tags.
4. Zero Markdown — only raw HTML output.
5. If adding a citation link, use: <a href="[URL]" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">[Publication Name]</a>
6. Output ONLY the corrected HTML. No explanations, no code fences.

DRAFT TO CORRECT:
---
${chunkForClaude}
---`;

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: correctionPrompt }],
        temperature: 0.1,
      });

      const contentBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      let correctedChunk = (contentBlock?.text || chunkForClaude)
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

      // Re-inject extracted figures and images back into corrected content
      extractedFigures.forEach((fig, idx) => {
        correctedChunk = correctedChunk.replace(`%%FIGURE_${idx}%%`, fig);
      });
      extractedImgs.forEach((img, idx) => {
        correctedChunk = correctedChunk.replace(`%%IMG_${idx}%%`, img);
      });

      // TABLE BUG FIX: final safety net — Claude's correction pass could in
      // theory still leave something unclosed (e.g. if it ran out of its own
      // max_tokens). Repair once more before returning.
      correctedChunk = closeUnclosedHtmlTags(correctedChunk);

      return NextResponse.json({ status: "corrected", chunk: correctedChunk }, { status: 200 });
    } catch (claudeErr) {
      // Claude correction failed — return the original draft so pipeline doesn't crash
      console.warn("[EDITOR] Claude correction call failed, returning draft:", claudeErr);
      return NextResponse.json({ status: "draft_fallback", chunk: generatedChunk }, { status: 200 });
    }
  } catch (error) {
    console.error("[EDITOR_AGENT_ERROR]", error);
    // Never return 500 — pipeline must continue even if this agent fails.
    // Pass through whatever chunk we received so content generation doesn't halt.
    return NextResponse.json(
      { status: "error_fallback", chunk: parsedBody?.generatedChunk || "" },
      { status: 200 }
    );
  }
}