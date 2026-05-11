// apps/web/src/app/api/v2/generator/editor/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// HTML <p> taglarını doğru şekilde parse edip cümle sayısını kontrol eder
// ---------------------------------------------------------------------------
function validateParagraphDensity(html: string, maxSentences: number): string[] {
  const errors: string[] = [];
  // <p> tagları arasındaki içeriği çıkar
  const pTagMatches = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];

  pTagMatches.forEach((pTag, index) => {
    // İçindeki HTML taglarını temizle, salt metni al
    const innerText = pTag.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!innerText) return;

    // Cümleleri say: . ! ? ile biten ve ardından büyük harf/boşluk gelen yapılar
    const sentences = innerText
      .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜA-Z\u00C0-\u024F])/)
      .filter((s) => s.trim().length > 10);

    if (sentences.length > maxSentences) {
      errors.push(
        `Paragraph ${index + 1} has ${sentences.length} sentences. Max allowed: ${maxSentences}.`
      );
    }
  });

  return errors;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { generatedChunk, sectionPlan, language } = await req.json();
    const validationErrors: string[] = [];

    // -----------------------------------------------------------------------
    // Format doğrulamaları
    // -----------------------------------------------------------------------
    const lowerChunk = generatedChunk.toLowerCase();

    if (sectionPlan.requiredFormat === "html_table" && !lowerChunk.includes("<table")) {
      validationErrors.push("MISSING TABLE: Section requires an HTML <table>. Add a <table> with <thead> and <tbody>.");
    }

    if (
      (sectionPlan.requiredFormat === "bullet_list" || sectionPlan.requiredFormat === "key_points") &&
      !lowerChunk.includes("<ul")
    ) {
      validationErrors.push("MISSING LIST: Section requires an HTML <ul> with <li> items.");
    }

    if (sectionPlan.requiredFormat === "blockquote" && !lowerChunk.includes("<blockquote")) {
      validationErrors.push("MISSING BLOCKQUOTE: Section requires a <blockquote> element.");
    }

    // -----------------------------------------------------------------------
    // Paragraf yoğunluğu — HTML <p> taglarını doğru parse et
    // -----------------------------------------------------------------------
    const maxSentences = sectionPlan.maxParagraphSentences || 1;
    const densityErrors = validateParagraphDensity(generatedChunk, maxSentences);
    validationErrors.push(...densityErrors);

    // -----------------------------------------------------------------------
    // Markdown kalıntısı kontrolü
    // -----------------------------------------------------------------------
    if (/\*\*(.*?)\*\*/.test(generatedChunk)) {
      validationErrors.push("MARKDOWN DETECTED: Found **bold** syntax. Convert to <strong> tags.");
    }
    if (/\[([^\]]+)\]\(([^)]+)\)/.test(generatedChunk)) {
      validationErrors.push("MARKDOWN LINK DETECTED: Found [text](url) syntax. Convert to <a href> tags.");
    }
    if (/^\s*#{1,3}\s/.test(generatedChunk)) {
      validationErrors.push("MARKDOWN HEADING DETECTED: Found # heading syntax. Remove it (headings are added by the system).");
    }

    // -----------------------------------------------------------------------
    // Sorun yoksa onayla
    // -----------------------------------------------------------------------
    if (validationErrors.length === 0) {
      return NextResponse.json({ status: "approved", chunk: generatedChunk }, { status: 200 });
    }

    // -----------------------------------------------------------------------
    // Hata varsa Editor Agent devreye girer — SADECE içeriği düzeltir,
    // <h2> ve <figure>/<img> taglarına DOKUNMAZ
    // -----------------------------------------------------------------------
    const correctionPrompt = `You are a strict HTML Content Editor. Fix the following errors in the draft HTML:

ERRORS TO FIX:
${validationErrors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

ABSOLUTE RULES FOR YOUR REWRITE:
1. Output language: ${language}
2. PRESERVE EXACTLY — Do NOT modify these tags: <h2>, <figure>, <img>, <figcaption>
3. Each <p> tag: MAX ${maxSentences} sentences. Split longer paragraphs into separate <p> tags.
4. Zero Markdown — only raw HTML
5. Output ONLY the corrected HTML. No explanations, no code block wrappers.

DRAFT TO FIX:
---
${generatedChunk}
---`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      messages: [{ role: "user", content: correctionPrompt }],
      temperature: 0.1,
    });

    const contentBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );

    let correctedChunk = (contentBlock?.text || generatedChunk)
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    return NextResponse.json({ status: "corrected", chunk: correctedChunk }, { status: 200 });
  } catch (error) {
    console.error("[EDITOR_AGENT_ERROR]", error);
    return NextResponse.json({ error: "QA failed." }, { status: 500 });
  }
}