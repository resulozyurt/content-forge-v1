import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { researchBlueprint, sectionPlan } = await req.json();
    
    let linkInstruction = "";
    if (researchBlueprint.extractedContext.availableInternalLinks?.length > 0) {
        const internalLink = researchBlueprint.extractedContext.availableInternalLinks.pop();
        linkInstruction += `\n[INTERNAL LINK]: Integrate this URL EXACTLY ONCE naturally. Use RAW HTML format: <a href="${internalLink}">contextual anchor text</a>. DO NOT use markdown.`;
    }
    linkInstruction += `\n[EXTERNAL LINK]: Include exactly ONE highly relevant external link to a SPECIFIC deeply-nested article or blog post (e.g., https://authoritysite.com/blog/specific-topic). NEVER link to a homepage. Use RAW HTML format: <a href="URL" target="_blank" rel="nofollow">Anchor Text</a>.`;

    const systemPrompt = `You are an elite SEO Content Writer. Write EXACTLY ONE section.
TARGET LANGUAGE: ${researchBlueprint.language}
SECTION TITLE: ${sectionPlan.title}

CRITICAL RULES:
1. RAW HTML ONLY: Output pure HTML. Wrap all text in <p> tags. DO NOT use Markdown formatting for links, bolding, or lists.
2. PARAGRAPH LENGTH: STRICTLY MAXIMUM 3 SENTENCES per <p> tag. Break long paragraphs.
3. STRUCTURE: If requiredFormat is 'html_table', output a clean HTML <table>. If 'bullet_list', use HTML <ul> and <li> tags.
4. BRAND: Position "${researchBlueprint.brandGuidelines.brandName}" as the industry leader.
${linkInstruction}

Return ONLY the HTML content. DO NOT include the heading itself.`;

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6", // MODEL DÜZELTİLDİ
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: `Write the section: "${sectionPlan.title}"` }],
        temperature: 0.6
    });

    const contentBlock = response.content.find((block: any) => block.type === 'text');
    let generatedHtml = contentBlock?.text || "";
    
    // --- GEMINI NANO BANANA GÖRSEL MOTORU ---
    let imgHtml = "";
    if (sectionPlan.includeImage) {
        try {
            // Görsel için prompt hazırlığı
            const promptReq = await anthropic.messages.create({
                model: "claude-sonnet-4-6", max_tokens: 300,
                system: `You are an elite AI Image Prompt Engineer. Write a highly descriptive prompt for a photorealistic corporate image based on the heading. NO TEXT IN IMAGE. Style: DSLR, raw photography. Limit: 800 characters.`,
                messages: [{ role: "user", content: `Create visual prompt for heading: "${sectionPlan.title}"` }]
            });
            const textBlock = promptReq.content.find((block: any) => block.type === 'text');
            const optimizedPrompt = textBlock?.text || sectionPlan.title;

            // GEMINI NANO BANANA API ENTEGRASYONU
            // Ekranda bozuk metin yerine direkt görselin çıkması için HTML formatında basıyoruz.
            // Gerçek API bağlandığında "nanoBananaImageUrl" değişkenini fetch yanıtından gelen URL ile değiştirebilirsin.
            const nanoBananaImageUrl = `https://placehold.co/1024x1024/png?text=${encodeURIComponent("Gemini Nano Banana:\n" + sectionPlan.title)}`;
            
            imgHtml = `<figure class="my-10"><img src="${nanoBananaImageUrl}" alt="${sectionPlan.title}" class="w-full rounded-2xl shadow-xl border border-gray-200 object-cover" /><figcaption class="text-center text-sm text-gray-500 mt-3 italic">${sectionPlan.title}</figcaption></figure>\n\n`;
        } catch (imgError) {
            console.error("[NANO_BANANA_FAILED]", imgError);
        }
    }

    // KAYBOLAN H2'Yİ, GÖRSELİ VE İÇERİĞİ BİRLEŞTİRİYORUZ
    const finalChunk = `<h2>${sectionPlan.title}</h2>\n\n${imgHtml}${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk }, { status: 200 });

  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}