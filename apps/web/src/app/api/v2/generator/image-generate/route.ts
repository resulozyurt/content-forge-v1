// apps/web/src/app/api/v2/generator/image-generate/route.ts
//
// FIX 4 — Async image generation endpoint.
// Called by useContentEngine in parallel with content writing.
// Returns { imageDataUri, sectionIndex } immediately after Gemini completes.
// The engine then swaps the <figure data-img-placeholder="N"> in the HTML.
//
// Why a separate route instead of fire-and-forget in writer?
//   Railway workers are serverless — a response that has already returned cannot
//   keep running background work. This route is a proper awaitable HTTP call
//   that the engine fires concurrently with subsequent section writes.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Gemini image generation — identical config to writer/route.ts
// Model: gemini-3.1-flash-image-preview, timeout: 60s, v1beta endpoint
// ---------------------------------------------------------------------------
async function generateImageWithGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[IMAGE_GEN] GEMINI_API_KEY not set");
    return null;
  }

  const models = [
    "gemini-3.1-flash-image-preview",
    "gemini-2.0-flash-exp-image-generation",
    "gemini-2.5-flash-image-preview",
  ];

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        console.warn(`[IMAGE_GEN] model=${model} status=${res.status}:`, (await res.text()).slice(0, 150));
        continue;
      }

      const data = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));
      if (!imgPart?.inlineData?.data) {
        console.warn(`[IMAGE_GEN] model=${model} — no inlineData`);
        continue;
      }

      console.log(`[IMAGE_GEN] Success model=${model}`);
      return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
    } catch (err: any) {
      console.warn(`[IMAGE_GEN] model=${model} error:`, err.message);
    }
  }

  console.warn("[IMAGE_GEN] All models failed");
  return null;
}

// ---------------------------------------------------------------------------
// POST /api/v2/generator/image-generate
// Body: { prompt: string, sectionIndex: number, sectionTitle: string }
// Response: { imageDataUri: string | null, sectionIndex: number, fallbackSrc: string }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { prompt, sectionIndex, sectionTitle } = await req.json();

    if (typeof prompt !== "string" || (prompt?.length ?? 0) === 0) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const safePrompt = prompt.slice(0, 100);
    const fallbackSrc = `https://placehold.co/1200x630/1e40af/ffffff?text=${encodeURIComponent(safePrompt.slice(0, 60))}`;

    console.log(`[IMAGE_GEN] section=${sectionIndex} prompt="${safePrompt}"`);

    const imageDataUri = await generateImageWithGemini(safePrompt);

    return NextResponse.json(
      { imageDataUri, sectionIndex, sectionTitle, fallbackSrc },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[IMAGE_GEN_ERROR]", error);
    // Never block the caller — return null imageDataUri so engine can use fallback
    return NextResponse.json({ imageDataUri: null, sectionIndex: -1, fallbackSrc: "" }, { status: 200 });
  }
}