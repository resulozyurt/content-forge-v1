// apps/web/src/app/api/generate/edit/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import OpenAI from "openai";

const openai = new OpenAI();

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
        const EDIT_COST = 1; // Inline edits are computationally cheaper, deduct 1 credit

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
                systemInstruction = "Rewrite the provided text to improve narrative flow, clarity, and professionalism while preserving the original meaning. Output ONLY the raw HTML paragraph (<p>) without markdown backticks.";
                break;
            case "Expand":
                systemInstruction = "Expand the provided text by adding relevant semantic details, contextual examples, and analytical depth. Maintain a highly professional tone. Output ONLY the raw HTML paragraphs (<p>) without markdown backticks.";
                break;
            case "Condense":
                systemInstruction = "Condense the provided text to be concise, punchy, and highly readable without losing core factual information. Output ONLY the raw HTML paragraph (<p>) without markdown backticks.";
                break;
            default:
                return NextResponse.json({ error: "Invalid transformation action specified." }, { status: 400 });
        }

        console.log(`[EDITOR_PIPELINE] Executing '${action}' operation for user ${userId}.`);

        // 4. Execute the AI transformation (using the faster 'mini' model for low latency)
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [
                {
                    role: "system",
                    content: `You are an elite NLP copy editor. 
                    Context of the broader article: "${context}".
                    
                    CRITICAL RULES: 
                    1. ${systemInstruction}
                    2. You MUST use Native American English formatting and phrasing exclusively.
                    3. Do NOT invent false data or hallucinate statistics.`
                },
                {
                    role: "user",
                    content: `Modify the following text sequence:\n\n${text}`
                }
            ],
            temperature: 0.5,
        });

        // 5. Cleanse the output of any residual markdown formatting
        const resultText = completion.choices[0].message.content?.trim().replace(/```html|```/g, '') || text;

        // 6. Finalize the transaction
        await BillingGuard.deductCredits(userId, EDIT_COST);

        return NextResponse.json({ result: resultText }, { status: 200 });

    } catch (error: any) {
        console.error("[EDIT_PIPELINE_ERROR]:", error);
        return NextResponse.json({ error: error.message || "The AI modification pipeline encountered a critical fault." }, { status: 500 });
    }
}