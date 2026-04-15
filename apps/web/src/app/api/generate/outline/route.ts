// apps/web/src/app/api/generate/outline/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export const maxDuration = 60; // Outline generation is relatively fast

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
CRITICAL RULES:
1. Target Language: ${language}.
2. AI Search Optimization: H2 headings MUST primarily be formulated as questions (What, How, Why, Guide) to rank in AI Overviews (SGE) and Perplexity.
3. Hierarchy: Use H2 for main sections and H3 for sub-sections.
4. Completeness: Cover the topic comprehensively from start to finish. Include an introduction and conclusion contextually if needed.
5. Do NOT just copy competitors; synthesize a better, more logical flow.`;

        const anthropicResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            temperature: 0.4,
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: `Competitor Heading Structures:\n${competitorHeadings}\n\nPeople Also Ask (PAA) Queries:\n${paaQuestions}\n\nGenerate the perfect SEO outline.`
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
                                        text: { type: "string", description: "The optimized heading text (preferably question-based for H2s)." }
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