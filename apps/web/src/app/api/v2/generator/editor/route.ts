import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { generatedChunk, sectionPlan, language } = await req.json();
    const validationErrors: string[] = [];
    
    if (sectionPlan.requiredFormat === "html_table" && !generatedChunk.toLowerCase().includes("<table")) {
      validationErrors.push("Failed to include an HTML table. Use <table> tags.");
    }
    if (sectionPlan.requiredFormat === "bullet_list" && !generatedChunk.toLowerCase().includes("<ul")) {
      validationErrors.push("Failed to include an HTML bulleted list (<ul>/<li>).");
    }

    const cleanText = generatedChunk.replace(/<[^>]*>?/gm, '');
    const paragraphs = cleanText.split("\n\n").filter((p: string) => p.trim().length > 0);
    
    paragraphs.forEach((para: string, index: number) => {
      const sentenceCount = para.split(/[.!?]+(?=\s|$)/).filter((s: string) => s.trim().length > 0).length;
      if (sentenceCount > 4) { 
        validationErrors.push(`Paragraph ${index + 1} is too dense (${sentenceCount} sentences). Maximum allowed is 3 sentences per <p> tag.`);
      }
    });

    if (validationErrors.length === 0) {
      return NextResponse.json({ status: "approved", chunk: generatedChunk }, { status: 200 });
    }

    const correctionPrompt = `You are a strict Content Editor. The writer failed these rules:
${validationErrors.join("\n")}

Here is the draft:
---
${generatedChunk}
---
REWRITE this section in ${language} fixing the errors. 
CRITICAL: You MUST perfectly preserve the <h2> tag and any <figure>/<img> tags exactly as they appear. Output ONLY the fixed HTML.`;

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6", // MODEL DÜZELTİLDİ
        max_tokens: 1500,
        messages: [{ role: "user", content: correctionPrompt }],
        temperature: 0.1
    });

    const contentBlock = response.content.find((block: any) => block.type === 'text');
    return NextResponse.json({ status: "corrected", chunk: contentBlock?.text || generatedChunk }, { status: 200 });

  } catch (error) {
    return NextResponse.json({ error: "QA failed." }, { status: 500 });
  }
}