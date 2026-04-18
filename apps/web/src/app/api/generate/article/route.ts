// apps/web/src/app/api/generate/article/route.ts
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { BillingGuard } from "@/lib/billing";
import { rateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { headers } from "next/headers";
import { z } from "zod";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@contentforge/database"; 

const openai = new OpenAI();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
export const maxDuration = 300;

const generationPayloadSchema = z.object({
    outlineData: z.object({
        headings: z.array(z.object({
            id: z.string().optional(),
            text: z.string(),
            level: z.enum(['h2', 'h3'])
        })).min(1, "The outline must contain at least one valid heading."),
        selectedKeywords: z.array(z.string()).optional().default([]),
        sourceUrls: z.array(z.string()).optional().default([]), 
    }),
    config: z.object({
        contentType: z.string().optional().default("blog_post"),
        language: z.string().optional().default("English (US)"),
        tone: z.string().optional().default("Highly Professional, Data-Driven, Authoritative"),
        depth: z.string().optional().default("Comprehensive"),
        engine: z.string().optional().default("claude-sonnet-4-6"),
        wpSitemap: z.string().optional().default(""),
        targetLength: z.string().optional().default("1000"), 
        enableBrandVoice: z.boolean().optional().default(false) 
    }).passthrough()
});

export async function POST(req: NextRequest) {
    let currentJobId: string | null = null;
    let areCreditsDeducted = false;
    const ARTICLE_COST = 5;
    let currentUserId = "";

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return new Response(JSON.stringify({ message: "Unauthorized access." }), { status: 401 });
        
        currentUserId = (session.user as any).id;
        const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
        const limiter = await rateLimit(`gen_article_${currentUserId}_${ip}`, 10, 60 * 60 * 1000);

        if (!limiter.success) return new Response(JSON.stringify({ message: "Generation quota reached." }), { status: 429 });

        let rawBody;
        try {
            rawBody = await req.json();
        } catch (parseErr) {
            console.warn("⚠️ [API_ABORT] Istemci veri paketini yuklemeden baglantiyi kesti. Islem iptal edildi.");
            return new Response(JSON.stringify({ message: "Request aborted by client." }), { status: 499 });
        }

        const parseResult = generationPayloadSchema.safeParse(rawBody);
        if (!parseResult.success) return new Response(JSON.stringify({ message: "Invalid payload." }), { status: 400 });

        const { outlineData, config } = parseResult.data;

        let activeTool = await prisma.tool.findFirst({ where: { isActive: true } });
        if (!activeTool) {
            activeTool = await prisma.tool.create({
                data: { name: "Article Generator", slug: "article-generator", description: "Default AI Tool", price: 5, isActive: true }
            });
        }

        const contentJob = await prisma.contentJob.create({
            data: { userId: currentUserId, toolId: activeTool.id, aiModel: "CLAUDE_3_5_SONNET", status: "PROCESSING", inputPayload: rawBody }
        });
        currentJobId = contentJob.id;

        await BillingGuard.checkCredits(currentUserId, ARTICLE_COST);
        await BillingGuard.deductCredits(currentUserId, ARTICLE_COST, "GENERATION");
        areCreditsDeducted = true;

        // === FIX 1: BRAND DESC REFERENCE HATASI ÇÖZÜLDÜ (GLOBAL TANIMLANDI) ===
        let brandName = "Our Company";
        let brandDesc = "The leading industry solution";
        let activeSitemapUrl = config.wpSitemap || "";

        if (activeSitemapUrl && !activeSitemapUrl.includes('.xml')) {
            activeSitemapUrl = activeSitemapUrl.replace(/\/$/, '') + '/sitemap_index.xml'; 
        }

        if (config.enableBrandVoice) {
            try {
                const brandProfile = await prisma.brandProfile.findUnique({ where: { userId: currentUserId } });
                if (brandProfile) {
                    brandName = brandProfile.name || brandName;
                    brandDesc = brandProfile.description || brandDesc; // const KALDIRILDI!
                    
                    const dbSitemap = (brandProfile as any).sitemapUrl || (brandProfile as any).sitemap || (brandProfile as any).website;
                    if (!activeSitemapUrl && dbSitemap) {
                        activeSitemapUrl = dbSitemap;
                        if (!activeSitemapUrl.includes('.xml')) {
                            activeSitemapUrl = activeSitemapUrl.replace(/\/$/, '') + '/sitemap_index.xml'; 
                        }
                    }
                }
            } catch (e) {
                console.error("[DB_BRAND_FETCH_ERROR]:", e);
            }
        }

        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
            async start(controller) {
                let isStreamClosed = false;
                const sendEvent = (data: any) => {
                    if (isStreamClosed || req.signal.aborted) return;
                    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch (e) { isStreamClosed = true; }
                };
                const closeStream = () => {
                    if (isStreamClosed || req.signal.aborted) return;
                    try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close(); } catch (e) {}
                    isStreamClosed = true;
                };

                sendEvent({ 
                    id: `sys-ping-${Date.now()}`, 
                    type: 'paragraph', 
                    content: `<em><span style="color: #6366f1;">[System] Secure connection established. Initializing AI pipeline...</span></em>` 
                });

                try {
                    let availableInternalLinks: string[] = [];
                    if (activeSitemapUrl) {
                        sendEvent({ id: `sys-map-${Date.now()}`, type: 'paragraph', content: `<em><span style="color: #6366f1;">[System] Scanning sitemap: ${activeSitemapUrl}...</span></em>` });
                        try {
                            const sitemapRes = await fetch(activeSitemapUrl, { signal: AbortSignal.timeout(8000) });
                            if (sitemapRes.ok) {
                                const sitemapXml = await sitemapRes.text();
                                const matches = Array.from(sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)).map(m => m[1]);
                                let filteredLinks = matches.filter(url => !url.endsWith('.xml'));
                                const isTurkish = config.language.toLowerCase().includes('tr');
                                filteredLinks = filteredLinks.filter(url => {
                                    if (isTurkish) return url.includes('/tr/') || url.includes('-tr/') || !url.match(/\/(en|de|fr|es)\//i);
                                    else return url.includes('/en/') || !url.match(/\/(tr|de|fr|es)\//i);
                                });
                                if (filteredLinks.length === 0) filteredLinks = matches.filter(url => !url.endsWith('.xml'));
                                availableInternalLinks = filteredLinks.sort(() => 0.5 - Math.random());
                            }
                        } catch (e) { console.error("[SITEMAP_FETCH_FAULT]:", e); }
                    }

                    sendEvent({ id: `sys-start-${Date.now()}`, type: 'paragraph', content: `<em><span style="color: #6366f1;">[System] Booting ${config.engine} engine. Generating architecture...</span></em>` });
                    
                    let availableExternalLinks = [...new Set(outlineData.sourceUrls || [])].sort(() => 0.5 - Math.random()); 
                    let h2Counter = 0;
                    let fullGeneratedHtml = ""; 
                    let internalLinksInjected = 0; // === FIX 3: İÇ LİNK SAYACI EKLENDİ ===

                    const totalHeadings = outlineData.headings.length;
                    const targetTotalWords = parseInt(config.targetLength, 10) || 1000;
                    const wordsPerSection = Math.max(80, Math.floor((targetTotalWords - 250) / totalHeadings));

                    for (let i = 0; i < outlineData.headings.length; i++) {
                        if (isStreamClosed || req.signal.aborted) break;

                        const heading = outlineData.headings[i];
                        if (heading.level === 'h2') h2Counter++;

                        const targetWords = heading.level === 'h2' ? wordsPerSection + 50 : Math.max(60, wordsPerSection - 20);
                        const targetKeyword = outlineData.selectedKeywords.length > 0 
                            ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                            : heading.text;

                        // === FIX 3: MAKSİMUM 5 İÇ LİNK STRATEJİSİ ===
                        let linkStrategyContext = "\n[MANDATORY LINK INJECTION RULES]:\n";
                        let linkInjected = false;

                        if (availableInternalLinks.length > 0 && internalLinksInjected < 5 && (i % 2 === 0 || i === 0)) {
                            const internalLink = availableInternalLinks.pop();
                            linkStrategyContext += `- INTERNAL LINK MANDATORY: You MUST integrate this URL exactly once: "${internalLink}". Find a highly relevant 2-3 word phrase and wrap it as: <a href="${internalLink}">phrase</a>.\n`;
                            linkInjected = true;
                            internalLinksInjected++;
                        }

                        if (availableExternalLinks.length > 0 && i % 3 === 0) { 
                            const externalLink = availableExternalLinks.pop();
                            linkStrategyContext += `- EXTERNAL LINK (OPTIONAL & SAFE): You may use this URL as a citation: "${externalLink}". IF you use it, you MUST use rel="nofollow" target="_blank". DO NOT link to competitor pricing pages.\n`;
                            linkInjected = true;
                        }

                        if (!linkInjected) linkStrategyContext = "";

                        const archetypePrompts: Record<string, string> = {
                            'blog_post': "Format as an engaging Blog Post. Use conversational transitions.",
                            'pillar_page': "Format as an encyclopedic Pillar Page. Provide dense, factual value.",
                            'guide': "Format as a Step-by-Step Guide. If applicable, use numbered <ol> lists.",
                            'product_review': "Format as a Review. If comparing, you MUST use an HTML <table> for pros/cons.",
                            'service_page': "Format as a Service Page. Keep paragraphs punchy. Focus on customer pain points."
                        };
                        const archetypeModule = archetypePrompts[config.contentType] || archetypePrompts['blog_post'];

                        // === FIX 2: "INCEPTION" MARKA SATIŞ STRATEJİSİ ===
                        let brandModule = "";
                        if (config.enableBrandVoice && brandName !== "Our Company") {
                            // Sadece 2. başlıkta ve ortadaki bir başlıkta usul usul bahset.
                            if (i === 1 || i === Math.ceil(totalHeadings / 2)) {
                                brandModule = `\n[SUBTLE BRAND INCEPTION]: Subtly and organically mention "${brandName}" (${brandDesc}) as a helpful solution for the specific challenge discussed here. Do NOT sound like a hard sales advertisement. Weave it naturally into the educational narrative.`;
                            } 
                            // Sondan bir önceki başlıkta tam satış yap.
                            else if (i === totalHeadings - 1) {
                                brandModule = `\n[BRAND ADVOCACY]: Strongly recommend "${brandName}" as the best choice to solve these problems.`;
                            } 
                            // Diğer başlıklarda markadan BAHSETME.
                            else {
                                brandModule = `\n[NEUTRALITY]: Keep this section completely educational and objective. Do NOT pitch or mention any software brands directly here.`;
                            }
                        }

                        const negativeModule = `\n[NEGATIVE CONSTRAINTS]: NEVER use cliché AI words like: "In conclusion", "Moreover", "Furthermore", "Delve into", "A testament to". Break any paragraph longer than 3 sentences.`;

                        const systemPrompt = `You are an elite Senior SEO Content Architect. Write ONLY the HTML body content for the provided heading. Do NOT output the heading tag itself.

${archetypeModule}
Target Word Count: ~${targetWords} words.
LANGUAGE: EXACTLY ${config.language}. TONE: ${config.tone}.

${brandModule}
${linkStrategyContext}
${negativeModule}`;

                        const userMessage = `Write the highly readable HTML content body for the heading: "${heading.text}"\nTarget Keyword Context: "${targetKeyword}"`;
                        
                        let finalHeadingText = heading.text; 
                        let generatedText = "";

                        try {
                            if (config.engine.toLowerCase().includes("claude")) {
                                const anthropicResponse = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", max_tokens: 4096, system: systemPrompt,
                                    messages: [{ role: "user", content: userMessage }],
                                    tools: [{
                                        name: "generate_html_body", description: "Generates the formatted HTML content for the section.",
                                        input_schema: { type: "object", properties: { htmlContent: { type: "string" } }, required: ["htmlContent"] }
                                    }],
                                    tool_choice: { type: "tool", name: "generate_html_body" }, temperature: 0.6,
                                });
                                const toolUseBlock = anthropicResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                                if (toolUseBlock) {
                                    const parsedData: any = typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input;
                                    generatedText = parsedData.htmlContent || "";
                                }
                            } else {
                                const textCompletion = await openai.chat.completions.create({
                                    model: "gpt-4o", response_format: { type: "json_object" },
                                    messages: [
                                        { role: "system", content: systemPrompt + `\n\nOutput ONLY a JSON object: { "htmlContent": "..." }` },
                                        { role: "user", content: userMessage }
                                    ], temperature: 0.6,
                                });
                                const parsedData = JSON.parse(textCompletion.choices[0].message.content || "{}");
                                generatedText = parsedData.htmlContent || "";
                            }
                        } catch (parseError) { console.error("[PARSE_FAULT]", parseError); }

                        generatedText = generatedText.replace(/```html|```/g, '').trim();
                        fullGeneratedHtml += `<${heading.level}>${finalHeadingText}</${heading.level}>\n${generatedText}\n`;

                        sendEvent({ id: `h-${i}-${Date.now()}`, type: heading.level, content: finalHeadingText });
                        sendEvent({ id: `p-${i}-${Date.now()}`, type: 'paragraph', content: generatedText });

                        if (heading.level === 'h2' && h2Counter > 0 && h2Counter % 2 === 0 && !req.signal.aborted) {
                            try {
                                const promptReq = await anthropic.messages.create({
                                    model: "claude-sonnet-4-6", max_tokens: 300,
                                    system: `You are an elite AI Image Prompt Engineer. Write a highly descriptive prompt for a photorealistic corporate image based on the heading. NO TEXT IN IMAGE. Style: DSLR, raw photography. Limit: 800 characters.`,
                                    messages: [{ role: "user", content: `Create visual prompt for heading: "${finalHeadingText}"` }]
                                });
                                const textBlock = promptReq.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
                                const optimizedPrompt = textBlock?.text || `Photorealistic corporate photography representing ${finalHeadingText}, diverse real humans, DSLR, no text`;

                                const imageResponse = await openai.images.generate({
                                    model: "dall-e-3", prompt: optimizedPrompt.substring(0, 900), n: 1, size: "1024x1024", quality: "hd", style: "natural" 
                                });
                                const imageUrl = imageResponse.data?.[0]?.url;
                                if (imageUrl) {
                                    const imgHtml = `<figure class="my-10"><img src="${imageUrl}" alt="${finalHeadingText}" class="w-full rounded-2xl shadow-xl border border-gray-200 object-cover" /><figcaption class="text-center text-sm text-gray-500 mt-3 italic">${finalHeadingText}</figcaption></figure>`;
                                    fullGeneratedHtml += `${imgHtml}\n`; 
                                    sendEvent({ id: `img-${i}-${Date.now()}`, type: 'image', content: imgHtml });
                                }
                            } catch (e) { console.error("[IMAGE_ENGINE_FAULT]", e); }
                        }
                    }

                    sendEvent({ id: `h-faq-${Date.now()}`, type: 'h2', content: "Conclusion & Frequently Asked Questions" });
                    const finalInternalLink = availableInternalLinks.length > 0 ? availableInternalLinks[0] : "#";
                    const conclusionPrompt = `Write the final Conclusion and FAQ section. Language: EXACTLY ${config.language}. Tone: ${config.tone}.
1. Generate a 'Final Verdict' heading (<h2>).
2. CTA BLOCK: Explicitly invite the reader to try "${brandName}" (${brandDesc}). Create a stylish blockquote directing them to: ${finalInternalLink}.
3. FAQ SECTION: Generate 3 punchy FAQ questions (<h3>).`;

                    let conclusionHtml = "";
                    try {
                        const conclusionRes = await anthropic.messages.create({
                            model: "claude-sonnet-4-6", max_tokens: 1500, system: "You are an elite SEO Architect.",
                            messages: [{ role: "user", content: conclusionPrompt }],
                            tools: [{ name: "gen_conclusion", description: "Generates HTML Conclusion.", input_schema: { type: "object", properties: { htmlContent: { type: "string" } }, required: ["htmlContent"] } }],
                            tool_choice: { type: "tool", name: "gen_conclusion" }, temperature: 0.6
                        });
                        const toolUseBlock = conclusionRes.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                        const parsedData: any = toolUseBlock ? (typeof toolUseBlock.input === 'string' ? JSON.parse(toolUseBlock.input) : toolUseBlock.input) : {};
                        conclusionHtml = (parsedData.htmlContent || "").replace(/```html|```/g, '').trim();
                        fullGeneratedHtml += `\n${conclusionHtml}\n`;
                        sendEvent({ id: `p-faq-${Date.now()}`, type: 'paragraph', content: conclusionHtml });
                    } catch (e) { console.error("[CONCLUSION_GEN_FAULT]:", e); }

                    let finalSeoMetadata = null;
                    try {
                        const contentSample = fullGeneratedHtml.substring(0, 5000); 
                        const seoResponse = await anthropic.messages.create({
                            model: "claude-sonnet-4-6", max_tokens: 500, system: `Generate Rank Math metadata. Language: ${config.language}.`,
                            messages: [{ role: "user", content: `Analyze this:\n\n${contentSample}` }],
                            tools: [{ name: "set_rank_math", description: "Outputs SEO metadata.", input_schema: { type: "object", properties: { focusKeyword: { type: "string" }, metaTitle: { type: "string" }, metaDescription: { type: "string" } }, required: ["focusKeyword", "metaTitle", "metaDescription"] } }],
                            tool_choice: { type: "tool", name: "set_rank_math" }, temperature: 0.3,
                        });
                        const seoBlock = seoResponse.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
                        if (seoBlock) {
                            finalSeoMetadata = typeof seoBlock.input === 'string' ? JSON.parse(seoBlock.input) : seoBlock.input;
                            sendEvent({ id: `seo-${Date.now()}`, type: 'seo_metadata', content: finalSeoMetadata });
                        }
                    } catch (e) {}

                    await prisma.contentJob.update({ where: { id: currentJobId! }, data: { status: "COMPLETED", outputContent: fullGeneratedHtml, seoMetadata: finalSeoMetadata ? finalSeoMetadata : undefined } });
                    closeStream();

                } catch (streamError) {
                    console.error("[STREAM_FAULT]:", streamError);
                    if (currentJobId) await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
                    closeStream(); 
                }
            }
        });

        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' } });

    } catch (error: any) {
        console.error("[API_ROUTE_FAULT]:", error);
        if (areCreditsDeducted && currentJobId) {
            try {
                await prisma.transaction.create({ data: { userId: currentUserId, amount: ARTICLE_COST, type: "REFUND", description: "System Fault" } });
                await prisma.wallet.update({ where: { userId: currentUserId }, data: { creditsAvailable: { increment: ARTICLE_COST } } });
                await prisma.contentJob.update({ where: { id: currentJobId }, data: { status: "FAILED" } });
            } catch (e) {}
        }
        return new Response(JSON.stringify({ message: "A critical error occurred." }), { status: 500 });
    }
}