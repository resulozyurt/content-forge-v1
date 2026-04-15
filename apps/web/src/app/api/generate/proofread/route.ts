// apps/web/src/app/api/generate/proofread/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";

// Initialize the Anthropic SDK
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || "",
});

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
        const PROOFREAD_COST = 2; 

        // 2. Rate Limiting: Prevent abuse of the NLP correction pipeline
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

        console.log(`[PROOFREAD_PIPELINE] Initializing linguistic analysis via Claude 3.5 Sonnet for: ${targetLanguage}`);

        // 5. Advanced System Prompt Engineering for HTML-Preserving Grammatical Correction
        const systemPrompt = `You are an elite, meticulous copy editor and linguistic expert.
Your task is to proofread the provided HTML content and return the corrected HTML.

CRITICAL DIRECTIVES:
1. TARGET LANGUAGE: Ensure the text conforms flawlessly to ${targetLanguage}. If the target is English, enforce Native American English grammar, syntax, vocabulary, and flow exclusively.
2. PRESERVE HTML INTEGRITY: You MUST NOT alter, remove, or break any HTML tags (e.g., <h2>, <p>, <strong>, <a>, <img>). Only modify the text node content within these tags.
3. ENHANCE READABILITY: Correct spelling, punctuation, and grammatical errors. Improve awkward phrasing for a professional, authoritative tone without changing the core meaning or the targeted SEO keywords.`;

        // 6. NLP Processing via Anthropic Tool Use
        const anthropicResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6", 
            max_tokens: 4096,
            system: systemPrompt,
            messages: [
                { role: "user", content: `Please proofread and optimize the following HTML content:\n\n${htmlContent}` }
            ],
            tools: [
                {
                    name: "submit_correction",
                    description: "Submits the structurally sound, linguistically corrected HTML payload.",
                    input_schema: {
                        type: "object",
                        properties: {
                            result: { type: "string", description: "The fully corrected HTML string." }
                        },
                        required: ["result"]
                    }
                }
            ],
            tool_choice: { type: "tool", name: "submit_correction" },
            temperature: 0.2, // Low temperature for high precision and factual consistency
        });

        // 7. Extract and validate the strict Tool Use payload
        const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
        
        if (!toolUseBlock) {
            throw new Error("The NLP engine failed to return a valid correction payload.");
        }

        let parsedData: any = {};
        if (typeof toolUseBlock.input === 'string') {
            try {
                parsedData = JSON.parse(toolUseBlock.input);
            } catch (e) {
                throw new Error("Invalid data format received from the AI engine.");
            }
        } else {
            parsedData = toolUseBlock.input;
        }

        if (!parsedData.result) {
            throw new Error("The returned payload is missing the expected 'result' field.");
        }

        // 8. Finalize Transaction & Deduct Credits
        await BillingGuard.deductCredits(userId, PROOFREAD_COST, "PROOFREAD");
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