// apps/web/src/app/api/generate/proofread/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import OpenAI from "openai";

const openai = new OpenAI();

// Extended timeout for full document proofreading
export const maxDuration = 120;

export async function POST(req: Request) {
    try {
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access. Please log in." }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const PROOFREAD_COST = 2; // Full document analysis is more resource-intensive

        // 2. Billing Guard validation
        await BillingGuard.checkCredits(userId, PROOFREAD_COST);

        const { htmlContent, language } = await req.json();

        if (!htmlContent) {
            return NextResponse.json({ error: "Missing required document payload." }, { status: 400 });
        }

        const targetLanguage = language || "English (US)";

        console.log(`[PROOFREAD_PIPELINE] Initiating full document grammar analysis for user ${userId}. Language: ${targetLanguage}`);

        // 3. Execute the AI proofreading analysis
        const completion = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [
                {
                    role: "system",
                    content: `You are an elite linguistic editor and proofreader. Your task is to analyze the provided HTML document and correct any grammatical errors, typos, punctuation mistakes, and awkward phrasing.
                    
                    CRITICAL RULES:
                    1. Target Language: EXACTLY ${targetLanguage}. If English, utilize flawless Native American English phrasing and spelling exclusively.
                    2. Maintain the exact structural integrity of the HTML (<p>, <h2>, <h3>, <img>, etc.). Do NOT strip or alter HTML tags, attributes, or structural classes.
                    3. Output ONLY the corrected raw HTML without markdown wrappers (e.g., no \`\`\`html). Do not add any explanatory text.`
                },
                {
                    role: "user",
                    content: `Please proofread and refine the following HTML content:\n\n${htmlContent}`
                }
            ],
            temperature: 0.2, // Low temperature for high precision and structural fidelity
        });

        // 4. Sanitize the output from residual markdown artifacts
        const sanitizedResult = completion.choices[0].message.content?.trim().replace(/```html|```/g, '') || htmlContent;

        // 5. Finalize the ledger transaction
        await BillingGuard.deductCredits(userId, PROOFREAD_COST);
        console.log(`[SUCCESS] Document proofreading completed. Deducted ${PROOFREAD_COST} credits.`);

        return NextResponse.json({ result: sanitizedResult }, { status: 200 });

    } catch (error: any) {
        console.error("[PROOFREAD_PIPELINE_ERROR]:", error);
        return NextResponse.json({ error: error.message || "The proofreading pipeline encountered a critical fault." }, { status: 500 });
    }
}