// apps/web/src/app/api/generate/article/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { GeneratedBlock } from "@/types/generator";

// OpenAI istemcisini başlatıyoruz (.env dosyasındaki OPENAI_API_KEY'i otomatik alır)
const openai = new OpenAI();

// Vercel gibi sunucularda yapay zeka işlemlerinin yarıda kesilmemesi için süreyi uzatıyoruz
export const maxDuration = 300; 

export async function POST(req: Request) {
    try {
        const { outlineData, config } = await req.json();

        if (!outlineData || !outlineData.headings) {
            return NextResponse.json({ message: "Outline data is missing" }, { status: 400 });
        }

        const generatedBlocks: GeneratedBlock[] = [];
        let h2Counter = 0;

        console.log("🚀 Starting Real AI Generation Process...");

        for (let i = 0; i < outlineData.headings.length; i++) {
            const heading = outlineData.headings[i];

            // 1. ADIM: Başlığı doğrudan bloğa ekle
            generatedBlocks.push({
                id: `h-${i}`,
                type: heading.level,
                content: heading.text,
            });

            if (heading.level === 'h2') h2Counter++;

            const targetKeyword = outlineData.selectedKeywords.length > 0 
                ? outlineData.selectedKeywords[i % outlineData.selectedKeywords.length] 
                : "industry best practices";

            // 2. ADIM: GERÇEK OPENAI İÇERİK VE BACKLİNK ÜRETİMİ (Senin Python Promptun)
            const paragraphCompletion = await openai.chat.completions.create({
                model: "gpt-4o", // Veya gpt-4-turbo
                messages: [
                    {
                        role: "system",
                        content: `You are an elite Senior SEO Content Writer and NLP Expert. 
                        Your task is to write a highly professional, informative, and engaging paragraph for an article.
                        Rules:
                        1. Format the output STRICTLY as raw HTML (only <p>, <strong>, etc. no markdown blocks).
                        2. You MUST naturally integrate the exact keyword: "${targetKeyword}".
                        3. You MUST include one highly authoritative, real-world context external citation (backlink) in the text.
                        Format the link exactly like this: <a href="https://example-authoritative-site.com" target="_blank" class="text-blue-600 hover:underline">[Source: Relevant Study/Article Name]</a>.`
                    },
                    {
                        role: "user",
                        content: `Write the section for the heading: "${heading.text}"`
                    }
                ],
                temperature: 0.7,
            });

            const generatedContent = paragraphCompletion.choices[0].message.content || "<p>Content generation failed.</p>";

            generatedBlocks.push({
                id: `p-${i}`,
                type: 'paragraph',
                content: generatedContent.replace(/```html|```/g, ''), // Eğer AI markdown kodu koyarsa temizle
            });

            // 3. ADIM: GÖRSEL PROMPTU ÜRETİMİ (Her 2 H2'de bir)
            if (heading.level === 'h2' && h2Counter % 2 === 0) {
                
                const imagePromptCompletion = await openai.chat.completions.create({
                    model: "gpt-4o-mini", // Prompt üretmek için daha hızlı ve ucuz model
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert Midjourney/DALL-E prompt engineer. Create a highly detailed, professional, corporate-style image generation prompt based on the subject provided. Return ONLY the raw text of the prompt, nothing else."
                        },
                        {
                            role: "user",
                            content: `Create an image prompt representing the concept of: "${heading.text}"`
                        }
                    ],
                    temperature: 0.8,
                });

                const generatedImagePrompt = imagePromptCompletion.choices[0].message.content || "A professional corporate illustration.";

                generatedBlocks.push({
                    id: `img-${i}`,
                    type: 'image',
                    content: generatedImagePrompt,
                });
            }
        }

        console.log("✅ AI Generation Complete!");
        
        // Üretilen tüm blokları (Başlıklar, Paragraflar+Linkler, Görsel Promptları) Frontend'e gönder
        return NextResponse.json({ blocks: generatedBlocks }, { status: 200 });

    } catch (error: any) {
        console.error("GENERATION_ERROR:", error);
        return NextResponse.json({ message: error.message || "Error during AI generation" }, { status: 500 });
    }
}