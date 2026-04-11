// apps/web/src/app/api/research/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI();
export const maxDuration = 60; // Araştırma işlemi biraz sürebilir

export async function POST(req: Request) {
    try {
        const { topic, config } = await req.json();

        if (!topic) {
            return NextResponse.json({ message: "Topic is required" }, { status: 400 });
        }

        console.log(`🔍 Starting NLP & SERP Research for: "${topic}"...`);

        // Arayüzden gelen gerçek veriler
        const language = config?.language || "English";
        const contentDepth = config?.depth || "Comprehensive";
        const contentType = config?.type || "Blog Post";

        // OpenAI'ı bir SEO Uzmanı ve Veri Kazıyıcı (Scraper) olarak kullanıyoruz.
        // STRICT JSON formatında yanıt vermeye zorluyoruz.
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are an elite SEO Specialist and Data Scraper. Your job is to analyze the given topic and simulate a top-tier SERP and NLP analysis.
                    You MUST return the output ONLY as a valid JSON object with the following exact structure:
                    {
                        "searchIntent": "String (e.g., Informational, Transactional, Commercial)",
                        "primaryKeywords": ["keyword1", "keyword2", "keyword3"],
                        "secondaryKeywords": ["kw4", "kw5", "kw6", "kw7", "kw8"],
                        "competitors": [
                            {
                                "name": "Competitor Site Name",
                                "headings": [
                                    {"level": "h2", "text": "Heading text"},
                                    {"level": "h3", "text": "Subheading text"}
                                ]
                            }
                        ]
                    }
                    Rules:
                    1. The output language MUST be exactly: ${language}.
                    2. Provide 3 realistic top-ranking competitors for this topic.
                    3. Provide realistic H2 and H3 structures for each competitor.
                    4. Keywords must be highly relevant NLP/LSI terms based on the topic.`
                },
                {
                    role: "user",
                    content: `Perform SERP and NLP analysis for a ${contentType} about: "${topic}". Depth: ${contentDepth}.`
                }
            ],
            temperature: 0.7,
        });

        const rawContent = completion.choices[0].message.content;
        
        if (!rawContent) {
            throw new Error("No content received from AI");
        }

        // Gelen JSON verisini parse et (Arayüzün okuyabileceği hale getir)
        const researchData = JSON.parse(rawContent);
        
        console.log("✅ Research Complete!");

        return NextResponse.json({ data: researchData }, { status: 200 });

    } catch (error: any) {
        console.error("RESEARCH_ERROR:", error);
        return NextResponse.json({ message: error.message || "Error during research phase" }, { status: 500 });
    }
}