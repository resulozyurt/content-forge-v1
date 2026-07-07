// apps/web/src/app/api/v2/generator/seo-meta/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import { normalizeLanguage } from "@/lib/language";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { articleTitle, keyword, selectedKeywords, language, contentSample } = await req.json();

    // Hard language directive from the single source of truth. The content
    // sample handed to this route can be mixed-language; promptRule explicitly
    // overrides the source language so the metadata always matches config.
    const langRule = normalizeLanguage(language).promptRule;

    const systemPrompt = `You are an expert SEO strategist specializing in Rank Math optimization.
${langRule}

Generate precise SEO metadata for a WordPress article. Output ONLY a valid JSON object — no markdown, no explanation.

RULES:
- focusKeyword: The single most important keyword phrase (2–4 words). Must appear in both metaTitle and metaDescription.
- metaTitle: 50–60 characters EXACTLY. Include the focus keyword near the start. Compelling, click-worthy.
- metaDescription: 140–160 characters EXACTLY. Include the focus keyword naturally. Summarize the article's core value. End with an implicit call to action.
- Do NOT use quotes inside the JSON string values.
- Character counts are HARD limits — count carefully.

Return format:
{"focusKeyword":"...","metaTitle":"...","metaDescription":"..."}`;

    const userContent = `Article title: "${articleTitle}"
Primary keyword: "${keyword}"
Related keywords: ${selectedKeywords?.slice(0, 5).join(", ") || keyword}
Content sample: ${contentSample?.slice(0, 1500) || ""}

Generate the Rank Math SEO metadata JSON.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
      temperature: 0.2,
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const raw = (textBlock?.text || "")
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let meta: { focusKeyword: string; metaTitle: string; metaDescription: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      meta = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
    } catch {
      // Fallback: construct from inputs
      meta = {
        focusKeyword: keyword,
        metaTitle: articleTitle.slice(0, 60),
        metaDescription: `Learn everything about ${keyword} — strategies, data, and actionable tips for better results.`.slice(0, 160),
      };
    }

    // Enforce length limits
    if (meta.metaTitle.length > 60) meta.metaTitle = meta.metaTitle.slice(0, 57) + "...";
    if (meta.metaDescription.length > 160) meta.metaDescription = meta.metaDescription.slice(0, 157) + "...";
    if (meta.metaDescription.length < 140) {
      meta.metaDescription = (meta.metaDescription + ` Discover the complete guide to ${meta.focusKeyword} with expert insights and data.`).slice(0, 160);
    }

    return NextResponse.json(meta, { status: 200 });
  } catch (error) {
    console.error("[SEO_META_AGENT_ERROR]", error);
    return NextResponse.json({ error: "SEO metadata generation failed." }, { status: 500 });
  }
}