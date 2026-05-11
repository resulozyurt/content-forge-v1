// apps/web/src/app/api/v2/generator/writer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });

// ---------------------------------------------------------------------------
// Harici link doğrulayıcı — 404 dönen linkleri filtreler
// ---------------------------------------------------------------------------
async function validateExternalUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    return res.ok; // 200-299 arası geçerli
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Güvenilir otorite domain'leri — bunlardan link üretilir, 404 riski minimal
// ---------------------------------------------------------------------------
const AUTHORITY_DOMAINS: Record<string, string[]> = {
  default: [
    "https://www.forbes.com/advisor",
    "https://hbr.org",
    "https://www.mckinsey.com/insights",
    "https://www.gartner.com/en/newsroom",
    "https://www.statista.com",
    "https://www.ibm.com/topics",
    "https://www.deloitte.com/insights",
  ],
  retail: [
    "https://www.retaildive.com",
    "https://nrf.com/blog",
    "https://www.emarketer.com",
  ],
  tech: [
    "https://techcrunch.com",
    "https://www.wired.com",
    "https://venturebeat.com",
  ],
  marketing: [
    "https://contentmarketinginstitute.com/articles",
    "https://blog.hubspot.com",
    "https://moz.com/blog",
  ],
};

// ---------------------------------------------------------------------------
// Format talimatları — her requiredFormat için kesin HTML kuralları
// ---------------------------------------------------------------------------
function getFormatInstruction(requiredFormat: string, maxSentences: number = 2): string {
  const maxS = maxSentences || 2;

  switch (requiredFormat) {
    case "html_table":
      return `OUTPUT FORMAT — HTML TABLE:
- Create a well-structured <table class="w-full border-collapse my-6 text-sm">
- Use <thead> with <th class="bg-gray-100 border border-gray-300 px-4 py-2 text-left font-semibold"> for headers
- Use <tbody> with <tr> and <td class="border border-gray-300 px-4 py-2"> for data rows
- Include at least 4 data rows and 3 columns
- After the table, write MAX 1 short <p> tag (max ${maxS} sentences) explaining the table
- NO other paragraph blocks`;

    case "bullet_list":
      return `OUTPUT FORMAT — STYLED BULLET LIST:
- Write a short intro <p> (max 1 sentence — HARD LIMIT: one sentence only)
- Then output a <ul class="my-4 space-y-2 list-none pl-0">
- Each <li class="flex items-start gap-2 text-gray-700 dark:text-gray-300"><span class="text-blue-500 mt-1">&#10003;</span><span>Item text here (max 12 words)</span></li>
- EXACTLY 4 to 5 list items — NO MORE THAN 5
- Each list item: ONE short phrase, max 12 words, no full stops
- NO additional paragraph blocks after the list`;

    case "key_points":
      return `OUTPUT FORMAT — KEY POINTS (Bold Takeaways):
- Write a short intro <p> (max 1 sentence — HARD LIMIT)
- Then output a <ul class="my-4 space-y-3 list-none pl-0">
- Each item: <li class="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 rounded-r-lg px-4 py-3"><strong class="text-blue-700 dark:text-blue-300 mr-2">Key Point:</strong><span class="text-gray-700 dark:text-gray-300">One sentence, max 15 words.</span></li>
- Include EXACTLY 4 key points — not 5, not 3, exactly 4
- Each key point: ONE sentence, max 15 words
- NO additional paragraph blocks`;

    case "blockquote":
      return `OUTPUT FORMAT — BLOCKQUOTE + CONTEXT:
- Write ONE short <p> (max ${maxS} sentences) as intro context
- Then output: <blockquote class="border-l-4 border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-6 py-4 my-6 rounded-r-xl"><p class="text-indigo-900 dark:text-indigo-200 italic font-medium text-lg">"Write a compelling, realistic expert insight here — make it specific and data-driven."</p><cite class="text-sm text-indigo-600 dark:text-indigo-400 font-semibold not-italic">— Expert Name, Job Title</cite></blockquote>
- Then write ONE short closing <p> (max ${maxS} sentences)
- MAXIMUM 3 paragraph/block elements total`;

    default: // "paragraph"
      return `OUTPUT FORMAT — SHORT PARAGRAPHS:
- Write EXACTLY 2 <p> tag blocks — no more, no less
- Each <p> tag: STRICTLY MAX ${maxS} SENTENCES. Hard limit — split longer thoughts into a new <p>.
- Each sentence: max 20 words. Short and punchy wins.
- If includeH3 is true, add ONE <h3> sub-heading between the two <p> blocks
- Use <strong> only for 1-2 key terms per paragraph
- NO lists, NO tables in this format`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { researchBlueprint, sectionPlan } = await req.json();

    // -----------------------------------------------------------------------
    // İç link talimatı
    // -----------------------------------------------------------------------
    let linkInstruction = "";
    if (researchBlueprint.extractedContext.availableInternalLinks?.length > 0) {
      const internalLink = researchBlueprint.extractedContext.availableInternalLinks.pop();
      linkInstruction += `\n[INTERNAL LINK RULE]: You MUST include this exact URL once as a raw HTML anchor:
<a href="${internalLink}" class="text-blue-600 hover:underline">use a 3-5 word descriptive anchor text here</a>
Place it naturally within a paragraph. DO NOT use Markdown. DO NOT modify the URL.`;
    }

    // -----------------------------------------------------------------------
    // Dış link — doğrulanmış domain'den üret
    // -----------------------------------------------------------------------
    const keyword = researchBlueprint.keyword?.toLowerCase() || "";
    let domainPool = AUTHORITY_DOMAINS.default;
    if (keyword.includes("retail") || keyword.includes("shop") || keyword.includes("store")) {
      domainPool = [...AUTHORITY_DOMAINS.retail, ...AUTHORITY_DOMAINS.default];
    } else if (keyword.includes("market") || keyword.includes("seo") || keyword.includes("content")) {
      domainPool = [...AUTHORITY_DOMAINS.marketing, ...AUTHORITY_DOMAINS.default];
    } else if (keyword.includes("tech") || keyword.includes("software") || keyword.includes("ai")) {
      domainPool = [...AUTHORITY_DOMAINS.tech, ...AUTHORITY_DOMAINS.default];
    }

    const authorityBase = domainPool[Math.floor(Math.random() * domainPool.length)];

    linkInstruction += `\n[EXTERNAL LINK RULE]: Include exactly ONE external authority link using this base domain: ${authorityBase}
Format: <a href="${authorityBase}" target="_blank" rel="nofollow" class="text-blue-600 hover:underline">Relevant anchor text</a>
IMPORTANT: Use the domain URL exactly as given above — do NOT append any path suffix or article slug.`;

    // -----------------------------------------------------------------------
    // Format talimatı
    // -----------------------------------------------------------------------
    const formatInstruction = getFormatInstruction(
      sectionPlan.requiredFormat,
      sectionPlan.maxParagraphSentences
    );

    // -----------------------------------------------------------------------
    // Writer system prompt
    // -----------------------------------------------------------------------
    const systemPrompt = `You are an elite SEO Content Writer producing content for WordPress. 
TARGET LANGUAGE: ${researchBlueprint.language}
SECTION TITLE: ${sectionPlan.title}
KEYWORD CONTEXT: ${researchBlueprint.keyword}
BRAND: Position "${researchBlueprint.brandGuidelines.brandName}" as the industry leader when relevant.

═══════════════════════════════════════════
ABSOLUTE RULES — NEVER VIOLATE:
1. RAW HTML ONLY — Zero Markdown. No **bold**, no [links](url), no | tables |
2. PARAGRAPH DENSITY — Max ${sectionPlan.maxParagraphSentences || 2} sentences per <p> tag. HARD LIMIT.
3. SCANNABILITY — Readers must be able to skim. Use the format below strictly.
4. NO HEADING TAG — Do NOT output <h2> or the section title. Only content.
5. NO MARKDOWN CODE BLOCKS — Output raw HTML directly, no \`\`\`html wrappers.
═══════════════════════════════════════════

${formatInstruction}
${linkInstruction}

Return ONLY the inner HTML content. No h2 heading. No preamble text.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: "user", content: `Write the HTML content for section: "${sectionPlan.title}"` }],
      temperature: 0.5,
    });

    const contentBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    let generatedHtml = (contentBlock?.text || "")
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    // -----------------------------------------------------------------------
    // GEMINI NANO BANANA — Görsel motoru
    // -----------------------------------------------------------------------
    let imgHtml = "";
    if (sectionPlan.includeImage) {
      try {
        // Görsel prompt üretimi
        const promptReq = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 200,
          system: `You are an AI image prompt engineer. Write a vivid, photorealistic prompt for a professional corporate/editorial image. 
Rules: NO text in image. Style: DSLR photography, natural lighting, sharp focus. Max 150 characters.
Return ONLY the prompt text, nothing else.`,
          messages: [
            {
              role: "user",
              content: `Image prompt for: "${sectionPlan.title}" in the context of "${researchBlueprint.keyword}"`,
            },
          ],
          temperature: 0.7,
        });

        const textBlock = promptReq.content.find(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        const optimizedPrompt = (textBlock?.text || sectionPlan.title).slice(0, 150);

        // ─── GEMINI NANO BANANA API ENTEGRASYONU ─────────────────────────────
        // Gerçek Gemini Imagen API'ye bağlandığında aşağıdaki satırı kendi
        // fetch çağrınızla değiştirin ve dönen URL'i nanoBananaImageUrl'e atayın.
        //
        // Örnek:
        // const geminiRes = await fetch("https://your-gemini-banana-endpoint/generate", {
        //   method: "POST",
        //   headers: { "Authorization": `Bearer ${process.env.GEMINI_API_KEY}` },
        //   body: JSON.stringify({ prompt: optimizedPrompt, width: 1200, height: 628 })
        // });
        // const geminiData = await geminiRes.json();
        // const nanoBananaImageUrl = geminiData.imageUrl;
        //
        // Şimdilik yüksek kaliteli placeholder kullanıyoruz:
        const encodedPrompt = encodeURIComponent(optimizedPrompt.slice(0, 80));
        const nanoBananaImageUrl = `https://placehold.co/1200x628/1e40af/ffffff?text=${encodedPrompt}`;
        // ─────────────────────────────────────────────────────────────────────

        imgHtml = `<figure class="my-8 rounded-2xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700">
  <img 
    src="${nanoBananaImageUrl}" 
    alt="${sectionPlan.title.replace(/"/g, "&quot;")}" 
    class="w-full object-cover" 
    loading="lazy"
    width="1200"
    height="628"
  />
  <figcaption class="text-center text-sm text-gray-500 dark:text-gray-400 py-2 px-4 bg-gray-50 dark:bg-gray-800 italic">
    ${sectionPlan.title}
  </figcaption>
</figure>`;
      } catch (imgError) {
        console.error("[NANO_BANANA_FAILED]", imgError);
        // Görsel oluşturulamazsa sessizce devam et
      }
    }

    // -----------------------------------------------------------------------
    // H2 + Görsel + İçerik birleşimi — KESIN SIRALA
    // -----------------------------------------------------------------------
    const finalChunk = `<h2 class="text-2xl font-bold text-gray-900 dark:text-white mt-10 mb-4">${sectionPlan.title}</h2>\n\n${imgHtml}${imgHtml ? "\n\n" : ""}${generatedHtml}`;

    return NextResponse.json({ chunk: finalChunk }, { status: 200 });
  } catch (error) {
    console.error("[WRITER_AGENT_ERROR]", error);
    return NextResponse.json({ error: "Writing failed." }, { status: 500 });
  }
}