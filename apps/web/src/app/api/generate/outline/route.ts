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

        const { researchData, topic, language } = await req.json();

        if (!researchData || !topic) {
            return NextResponse.json({ error: "Invalid payload: Missing research data or topic." }, { status: 400 });
        }

        const competitorHeadings = researchData.competitors?.map((c: any) => c.headings.map((h: any) => h.text).join(" | ")).join("\n");
        const paaQuestions = researchData.questions?.map((q: any) => q.text).join(", ");

        const systemPrompt = `You are a Senior SEO Architect. Your task is to generate a highly optimized article outline for the topic: "${topic}".

CRITICAL DYNAMIC OUTLINE RULES:
1. Target Language: ${language}.
2. ANALYZE THE INTENT: Determine if the topic is a "Listicle/Comparison" (e.g., "Top 10 Tools") OR an "Explanatory Guide" (e.g., "How to do X").
3. ADAPTIVE HIERARCHY:
   - If Listicle: Create a main H2 (e.g., "Top Software Options") and add as many H3s as needed to list the products/tools. Do not restrict the number of products.
   - If Guide: Use H3s sparingly only to break down complex H2 steps.
4. H2 LIMITS & SGE: Keep main H2 sections between 5 to 8. Formulate non-product H2s as questions (What, How, Why) to rank in AI Overviews (SGE) and Perplexity.
5. FLOW: Intro -> Core Problem -> Solutions/List -> Conclusion. Do NOT just copy competitors; synthesize a better flow.`;

        const anthropicResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            temperature: 0.4,
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
                    description: "Outputs the structured H2/H3 outline array.",
                    input_schema: {
                        type: "object",
                        properties: {
                            headings: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        level: { type: "string", enum: ["h2", "h3"] },
                                        text: { type: "string", description: "The optimized heading text." }
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
        if (!toolUseBlock) throw new Error("Outline generation failed.");

        const parsedData = typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input;

        return NextResponse.json({ outline: parsedData.headings }, { status: 200 });

    } catch (error: any) {
        console.error("[OUTLINE_GENERATION_FAULT]:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}