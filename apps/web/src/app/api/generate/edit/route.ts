// apps/web/src/app/api/generate/edit/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import Anthropic from "@anthropic-ai/sdk";

// Initialize the Anthropic SDK
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

// Set a moderate timeout for inline editing operations
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access. Please log in." }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const EDIT_COST = 1; 

        // 2. Billing Guard validation
        await BillingGuard.checkCredits(userId, EDIT_COST);

        const { action, text, context } = await req.json();

        if (!text || !action) {
            return NextResponse.json({ error: "Missing required payload parameters." }, { status: 400 });
        }

        // 3. Determine specific NLP instructions based on the requested action
        let systemInstruction = "";
        
        switch (action) {
            case "Rewrite":
                systemInstruction = "Rewrite the provided text to improve narrative flow, clarity, and professionalism while preserving the original meaning.";
                break;
            case "Expand":
                systemInstruction = "Expand the provided text by adding relevant semantic details, contextual examples, and analytical depth. Maintain a highly professional tone.";
                break;
            case "Condense":
                systemInstruction = "Condense the provided text to be concise, punchy, and highly readable without losing core factual information.";
                break;
            default:
                return NextResponse.json({ error: "Invalid transformation action specified." }, { status: 400 });
        }

        console.log(`[EDITOR_PIPELINE] Executing '${action}' operation utilizing Claude 3.5 Sonnet.`);

        // 4. Execute the AI transformation utilizing Claude 3.5 Sonnet
        const anthropicResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6", 
            max_tokens: 2048,
            system: `You are an elite NLP copy editor. 
Context of the broader article: "${context}".

CRITICAL RULES: 
1. ${systemInstruction}
2. You MUST use Native American English formatting and phrasing exclusively.
3. Output ONLY the raw HTML paragraphs (<p>, <ul>) without any markdown backticks. Do not include introductory conversational text.
4. Do NOT invent false data or hallucinate statistics.`,
            messages: [
                {
                    role: "user",
                    content: `Modify the following text sequence according to the instructions:\n\n${text}`
                }
            ],
            temperature: 0.5,
        });

        // 5. Extract and cleanse the output
        let resultText = text;
        if (anthropicResponse.content[0].type === 'text') {
            resultText = anthropicResponse.content[0].text.trim().replace(/```html|```/g, '');
        }

        // 6. Finalize the transaction
        await BillingGuard.deductCredits(userId, EDIT_COST, "EDIT");

        return NextResponse.json({ result: resultText }, { status: 200 });

    } catch (error: any) {
        console.error("[EDIT_PIPELINE_ERROR]:", error);
        return NextResponse.json({ error: error.message || "The AI modification pipeline encountered a critical fault." }, { status: 500 });
    }
}