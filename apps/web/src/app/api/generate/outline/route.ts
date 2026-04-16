// apps/web/src/app/api/generate/outline/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
        }

        // 1. Payload Extraction: We extract 'config' to handle target lengths dynamically.
        const { researchData, topic, language, config } = await req.json();

        if (!researchData || !topic) {
            return NextResponse.json({ error: "Invalid payload: Missing research data or topic." }, { status: 400 });
        }

        const competitorHeadings = researchData.competitors?.map((c: any) => c.headings.map((h: any) => h.text).join(" | ")).join("\n");
        const paaQuestions = researchData.questions?.map((q: any) => q.text).join(", ");

        // 2. Mathematical Pacing: Calculate the optimal number of H2s based on target word count.
        // Rule of thumb: ~250-300 words per H2 section for optimal readability and depth.
        const targetWords = parseInt(config?.targetLength || "1000", 10);
        const maxH2Count = Math.max(4, Math.floor(targetWords / 250));
        const minH2Count = Math.max(3, maxH2Count - 2);

        // 3. Prompt Engineering: Aggressive constraints for SGE, Featured Snippets, and conciseness.
        const systemPrompt = `You are a Senior Silicon Valley SEO Content Architect. Your mission is to engineer a highly optimized, intent-driven article outline for the topic: "${topic}".

[CRITICAL DYNAMIC OUTLINE RULES - DO NOT IGNORE]:
1. TARGET LANGUAGE: Strictly ${language}.
2. MATHEMATICAL PACING: The requested article length is ~${targetWords} words. To prevent "thin content", you MUST generate EXACTLY between ${minH2Count} and ${maxH2Count} main H2 sections. Do not exceed ${maxH2Count} H2s.
3. ZERO FLUFF (CONCISENESS): Headings must be punchy, highly readable, and STRICTLY UNDER 8 WORDS. Never write a heading as a long sentence. 
   - BAD: "What Are The Most Important Features That You Should Look For In A CRM?"
   - GOOD: "Key Features to Look for in a CRM"
4. SGE & FEATURED SNIPPET OPTIMIZATION: AI Overviews (SGE) favor direct answers. Formulate at least 30% of your non-list H2s as exact-match questions based on PAA queries (e.g., "What is [Topic]?", "How Does [Topic] Work?").
5. INTENT ADAPTATION:
   - If Listicle (e.g., "Top 10 Tools"): Create ONE main H2 (e.g., "Top Software Compared") and nest the products as H3s. Do not use H2s for individual products.
   - If Explanatory Guide: Use H3s sparingly, only to break down highly complex H2 steps.
6. LOGICAL FLOW: Introduction -> Core Definition (What/Why) -> Main Problem/Solution -> Actionable Steps/List -> Conclusion & FAQ.`;

        const anthropicResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6", // Keeping your designated model 
            max_tokens: 2048,
            temperature: 0.3, // Lowered temperature for more deterministic, structured, and factual SEO outlines
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: `Competitor Heading Structures:\n${competitorHeadings}\n\nPeople Also Ask (PAA) Queries:\n${paaQuestions}\n\nGenerate the intelligent, intent-aware SEO outline.`
                }
            ],
            tools: [
                {
                    name: "generate_seo_outline",
                    description: "Outputs the structured H2/H3 outline array. ALL headings must be concise and under 8 words.",
                    input_schema: {
                        type: "object",
                        properties: {
                            headings: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        level: { 
                                            type: "string", 
                                            enum: ["h2", "h3"] 
                                        },
                                        text: { 
                                            type: "string", 
                                            description: "The optimized, punchy heading text. Maximum 8 words. No long sentences." 
                                        }
                                    },
                                    required: ["level", "text"]
                                }
                            }
                        },
                        required: ["headings"]
                    }
                }
            ],
            tool_choice: { type: "tool", name: "generate_seo_outline" }
        });

        const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
        if (!toolUseBlock) throw new Error("The AI failed to generate a structured outline tool call.");

        const parsedData = typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input;

        return NextResponse.json({ outline: parsedData.headings }, { status: 200 });

    } catch (error: any) {
        console.error("[OUTLINE_GENERATION_FAULT]:", error);
        return NextResponse.json({ error: error.message || "Internal server error during outline generation." }, { status: 500 });
    }
}