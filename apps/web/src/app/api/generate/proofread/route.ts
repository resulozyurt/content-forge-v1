// apps/web/src/app/api/generate/proofread/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import OpenAI from "openai";

// Initialize the OpenAI SDK
const openai = new OpenAI();

// Extend serverless execution timeout to accommodate comprehensive document analysis
export const maxDuration = 120; 

export async function POST(req: Request) {
    try {
        // 1. Authentication & Session Validation
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { error: "Unauthorized access. Authentication is required." }, 
                { status: 401 }
            );
        }

        const userId = (session.user as any).id;
        const PROOFREAD_COST = 2; // Economical cost relative to full generation

        // 2. Rate Limiting: Prevent abuse of the NLP correction pipeline (15 requests per hour)
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`proofread_${userId}_${ip}`, 15, 60 * 60 * 1000);

        if (!limiter.success) {
            return NextResponse.json(
                { error: "Proofreading quota exceeded. Please try again later." }, 
                { 
                    status: 429, 
                    headers: getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) 
                }
            );
        }

        // 3. Billing Guard Assessment
        await BillingGuard.checkCredits(userId, PROOFREAD_COST);

        // 4. Payload Extraction
        const { htmlContent, language } = await req.json();

        if (!htmlContent || typeof htmlContent !== 'string') {
            return NextResponse.json(
                { error: "Invalid payload: HTML content is required for proofreading." }, 
                { status: 400 }
            );
        }

        const targetLanguage = language || "English (US)";

        console.log(`[PROOFREAD_PIPELINE] Initializing linguistic analysis for language context: ${targetLanguage}`);

        // 5. Advanced System Prompt Engineering for HTML-Preserving Grammatical Correction
        const systemPrompt = `You are an elite, meticulous copy editor and linguistic expert.
Your task is to proofread the provided HTML content and return the corrected HTML.

CRITICAL DIRECTIVES:
1. TARGET LANGUAGE: Ensure the text conforms flawlessly to ${targetLanguage}. If the target is English, enforce Native American English grammar, syntax, vocabulary, and flow exclusively.
2. PRESERVE HTML INTEGRITY: You MUST NOT alter, remove, or break any HTML tags (e.g., <h2>, <p>, <strong>, <a>, <img>). Only modify the text node content within these tags.
3. ENHANCE READABILITY: Correct spelling, punctuation, and grammatical errors. Improve awkward phrasing for a professional, authoritative tone without changing the core meaning or the targeted SEO keywords.
4. JSON OUTPUT FORMAT: Return your response ONLY as a valid JSON object matching this schema:
{
  "result": "The fully corrected HTML string."
}
5. NO MARKDOWN: Do not wrap the JSON output in markdown backticks (e.g., \`\`\`json). Return the raw JSON string directly.`;

        // 6. NLP Processing via OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o", // Utilizing the most capable model for nuanced linguistic tasks
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Please proofread and optimize the following HTML content:\n\n${htmlContent}` }
            ],
            temperature: 0.3, // Low temperature for high precision and factual consistency
        });

        const rawContent = completion.choices[0].message.content;
        
        if (!rawContent) {
            throw new Error("The NLP engine failed to return a valid correction payload.");
        }

        // Robust parsing to handle potential model anomalies
        const cleanedRaw = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsedData = JSON.parse(cleanedRaw);

        if (!parsedData.result) {
            throw new Error("The returned payload is missing the expected 'result' field.");
        }

        // 7. Finalize Transaction & Deduct Credits
        await BillingGuard.deductCredits(userId, PROOFREAD_COST);
        console.log(`[SUCCESS] Document proofreading completed. Deducted ${PROOFREAD_COST} credit(s) from user ${userId}.`);

        return NextResponse.json({ result: parsedData.result }, { status: 200 });

    } catch (error: any) {
        console.error("[PROOFREAD_PIPELINE_CRITICAL_FAULT]:", error);
        return NextResponse.json(
            { error: error.message || "An unexpected error occurred during the proofreading sequence." }, 
            { status: 500 }
        );
    }
}