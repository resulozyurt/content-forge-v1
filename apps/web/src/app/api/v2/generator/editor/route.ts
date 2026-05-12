// apps/web/src/app/api/v2/generator/editor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

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
    const matches = content.match(new RegExp(`\\b${word}\\b`, "g")) || [];
    if (matches.length > 4) titleWordRepeats++;
  });

  if (titleWordRepeats > 2) {
    errors.push(
      "REPETITION DETECTED: Section title words appear too frequently in body text. Vary your vocabulary."
    );
  }

  return errors;
}

export async function POST(req: NextRequest) {
  let parsedBody: any = {};

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    parsedBody = await req.json();
    const { generatedChunk, sectionPlan, language } = parsedBody;

    // Guard: malformed or missing chunk — pass through immediately
    if (!generatedChunk || typeof generatedChunk !== "string" || generatedChunk.length < 10) {
      return NextResponse.json({ status: "approved", chunk: generatedChunk || "" }, { status: 200 });
    }

    const validationErrors: string[] = [];
    const lowerChunk = generatedChunk.toLowerCase();
    const maxSentences = sectionPlan?.maxParagraphSentences || 1;

    // ── Format validations ──────────────────────────────────────────────────
    if (sectionPlan?.requiredFormat === "html_table" && !lowerChunk.includes("<table")) {
      validationErrors.push("MISSING TABLE: Section requires an HTML <table> with <thead> and <tbody>. Generate a data-rich comparison table.");
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

    // ── All checks passed ───────────────────────────────────────────────────
    if (validationErrors.length === 0) {
      return NextResponse.json({ status: "approved", chunk: generatedChunk }, { status: 200 });
    }

    // ── Auto-correct via Claude ─────────────────────────────────────────────
    const isTurkish = (language || "").toLowerCase().includes("tr");
    const langRule = isTurkish
      ? "Output language: Akıcı, doğal Türkçe. Çeviri kokusu olmamalı."
      : "Output language: Natural, native American English. Direct and confident tone.";

    const correctionPrompt = `You are a strict HTML Content Editor. Fix ALL the listed errors in the draft HTML.

ERRORS TO FIX:
${validationErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

ABSOLUTE RULES:
1. ${langRule}
2. PRESERVE unchanged: <h2>, <figure>, <img>, <figcaption>, existing <a> links.
3. Each <p> tag: MAX ${maxSentences} sentences. Split longer text into multiple <p> tags.
4. Zero Markdown — only raw HTML output.
5. If adding a citation link, use: <a href="[URL]" target="_blank" rel="nofollow" style="color:#2563eb;text-decoration:underline;">[Publication Name]</a>
6. Output ONLY the corrected HTML. No explanations, no code fences.

DRAFT TO CORRECT:
---
${generatedChunk}
---`;

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: correctionPrompt }],
        temperature: 0.1,
      });

      const contentBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      const correctedChunk = (contentBlock?.text || generatedChunk)
        .replace(/^```html\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();

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