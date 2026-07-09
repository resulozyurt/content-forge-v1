// apps/web/src/app/api/v2/generator/edit/route.ts
//
// v2 INLINE EDIT AGENT — replaces the dead /api/generate/edit path.
//
// Context: ProseEditor's selection toolbar (Rewrite / Expand / Condense) was
// still POSTing to /api/generate/edit, but that route was moved to
// /api/generate_v1_deprecated/edit — every inline AI action 404'd. This route
// restores the feature under the v2 namespace and adds:
//
//   1. LANGUAGE AWARENESS — the old route hard-coded "Native American English";
//      Turkish articles got English rewrites. Now normalizeLanguage() drives
//      the output language exactly like the writer/editor agents.
//   2. "SimplifyBatch" ACTION (Faz 3 readability checklist) — receives an
//      array of plain-text sentences flagged by lib/readability.ts and
//      returns one simplified rewrite per sentence as a JSON array. One API
//      call fixes a whole checklist item; ProseEditor swaps each sentence
//      in-place in the TipTap doc so the live score climbs immediately.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeLanguage } from "@/lib/language";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized access. Please log in." }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const EDIT_COST = 1;
    await BillingGuard.checkCredits(userId, EDIT_COST);

    const { action, text, sentences, context, language } = await req.json();
    const lang = normalizeLanguage(language);

    // ── SimplifyBatch: readability checklist one-click fix ──────────────────
    if (action === "SimplifyBatch") {
      if (!Array.isArray(sentences) || sentences.length === 0) {
        return NextResponse.json({ error: "SimplifyBatch requires a non-empty 'sentences' array." }, { status: 400 });
      }
      // Cap batch size — checklist items are already capped at 8 client-side.
      const batch: string[] = sentences.slice(0, 10).map((s: unknown) => String(s));

      const prompt = `You are a plain-language line editor. Rewrite each sentence below to be easier to read.

${lang.promptRule}

RULES PER SENTENCE:
- If longer than 20 words, split into 2 shorter sentences (keep them together as one string).
- Target 12–15 words per sentence; plain 1–2 syllable words where possible.
- Active voice. Keep every number, statistic, and proper noun EXACTLY as written.
- Do not add new information. Do not drop information.
- Output plain text only — no HTML, no quotes around the sentence.

Return ONLY a JSON array of ${batch.length} strings, same order as input. No explanations, no code fences.

INPUT SENTENCES:
${JSON.stringify(batch, null, 2)}`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      });

      const block = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const rawText = (block?.text || "[]").replace(/```json|```/g, "").trim();

      let results: string[];
      try {
        const parsed = JSON.parse(rawText);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        results = parsed.map((r: unknown) => String(r));
      } catch {
        // Model returned malformed JSON — fail soft with originals so the
        // client can skip the replacement instead of corrupting the doc.
        console.warn("[EDIT_V2] SimplifyBatch JSON parse failed — returning originals");
        results = batch;
      }

      // Length mismatch → pad with originals so indexes always line up.
      while (results.length < batch.length) results.push(batch[results.length]);
      results = results.slice(0, batch.length);

      await BillingGuard.deductCredits(userId, EDIT_COST, "EDIT");
      return NextResponse.json({ results }, { status: 200 });
    }

    // ── Selection toolbar actions (Rewrite / Expand / Condense) ─────────────
    if (!text || !action) {
      return NextResponse.json({ error: "Missing required payload parameters." }, { status: 400 });
    }

    let systemInstruction = "";
    switch (action) {
      case "Rewrite":
        systemInstruction =
          "Rewrite the provided text to improve narrative flow, clarity, and professionalism while preserving the original meaning. Keep sentences short (12–15 words average) and words plain.";
        break;
      case "Expand":
        systemInstruction =
          "Expand the provided text by adding relevant semantic details, contextual examples, and analytical depth. Maintain a professional tone and short, readable sentences.";
        break;
      case "Condense":
        systemInstruction =
          "Condense the provided text to be concise, punchy, and highly readable without losing core factual information.";
        break;
      default:
        return NextResponse.json({ error: "Invalid transformation action specified." }, { status: 400 });
    }

    const anthropicResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: `You are an elite NLP copy editor.
Context of the broader article: "${context}".

CRITICAL RULES:
1. ${systemInstruction}
2. ${lang.promptRule}
3. Output ONLY the raw HTML paragraphs (<p>, <ul>) without any markdown backticks. Do not include introductory conversational text.
4. Do NOT invent false data or hallucinate statistics.
5. Preserve every existing <a> link (href, target, rel) exactly.`,
      messages: [
        {
          role: "user",
          content: `Modify the following text sequence according to the instructions:\n\n${text}`,
        },
      ],
      temperature: 0.5,
    });

    let resultText = text;
    if (anthropicResponse.content[0].type === "text") {
      resultText = anthropicResponse.content[0].text.trim().replace(/```html|```/g, "");
    }

    await BillingGuard.deductCredits(userId, EDIT_COST, "EDIT");
    return NextResponse.json({ result: resultText }, { status: 200 });
  } catch (error: any) {
    console.error("[EDIT_V2_PIPELINE_ERROR]:", error);
    return NextResponse.json(
      { error: error.message || "The AI modification pipeline encountered a critical fault." },
      { status: 500 }
    );
  }
}