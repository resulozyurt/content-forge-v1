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
//
// FIX 5 — Robust 429 handling.
//   The dominant production failure was status=429 (RESOURCE_EXHAUSTED): Gemini
//   rejects the request when RPM/RPD/IPM is hit. The previous code returned null
//   on the FIRST non-200, so a single transient 429 killed the whole image.
//   We now honor the server-suggested retryDelay and back off + retry, while
//   treating real permanent errors (400/403/404) as immediate failures.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Retry / backoff configuration
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 3;          // total tries per model (incl. first call)
const BASE_BACKOFF_MS = 1_000;   // exponential base for transient (non-429) errors
const MAX_BACKOFF_MS = 20_000;   // never wait longer than this between tries
const DEADLINE_MS = 110_000;     // hard ceiling on total time per model call

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Parse the server-suggested retry delay from a 429 response.
// Gemini returns details[].retryDelay like "16s" / "16.9s" in the JSON body,
// and sometimes a Retry-After header (seconds). We honor whichever we find so
// we wait exactly as long as the quota window needs instead of guessing.
// ---------------------------------------------------------------------------
function parseRetryDelayMs(bodyText: string, headers: Headers): number | null {
  // 1) Retry-After header (seconds)
  const headerVal = headers.get("retry-after");
  if (headerVal) {
    const secs = Number(headerVal);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  }
  // 2) RetryInfo in the JSON body: error.details[].retryDelay = "16s"
  try {
    const parsed = JSON.parse(bodyText);
    const details: any[] = parsed?.error?.details ?? [];
    for (const d of details) {
      if (typeof d?.retryDelay === "string") {
        const m = d.retryDelay.match(/([\d.]+)s/);
        if (m) {
          const secs = parseFloat(m[1]);
          if (Number.isFinite(secs)) return Math.ceil(secs * 1000);
        }
      }
    }
  } catch {
    /* body wasn't JSON — ignore */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Gemini requires an explicit image-generation instruction in the prompt.
// Without the "Generate a photorealistic image:" prefix the model sometimes
// returns a text-only response (no inlineData), especially for non-English
// or abstract prompts. We also retry on no-inlineData before giving up.
// ---------------------------------------------------------------------------
async function callGemini(model: string, prompt: string, apiKey: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Prefix forces Gemini into image-generation mode regardless of prompt language
  const fullPrompt = `Generate a photorealistic image: ${prompt}`;
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 300);

        // 429 (rate limit) and 5xx (server) are transient → back off + retry.
        // Other 4xx (400/403/404) are permanent → stop immediately, retry is futile.
        const isRateLimited = res.status === 429;
        const isServerErr = res.status >= 500;

        if (!isRateLimited && !isServerErr) {
          console.warn(`[IMAGE_GEN] model=${model} status=${res.status} (permanent):`, errText);
          return null;
        }

        if (attempt === MAX_ATTEMPTS) {
          console.warn(`[IMAGE_GEN] model=${model} status=${res.status} — out of retries:`, errText);
          return null;
        }

        // Honor server retryDelay on 429; otherwise exponential backoff with jitter.
        const serverDelay = isRateLimited ? parseRetryDelayMs(errText, res.headers) : null;
        const backoff = serverDelay ?? BASE_BACKOFF_MS * 2 ** (attempt - 1);
        const wait = Math.min(backoff, MAX_BACKOFF_MS) + Math.floor(Math.random() * 400);

        // Respect the overall deadline — don't sleep past it.
        if (Date.now() - startedAt + wait > DEADLINE_MS) {
          console.warn(`[IMAGE_GEN] model=${model} status=${res.status} — deadline reached, aborting`);
          return null;
        }

        console.warn(
          `[IMAGE_GEN] model=${model} status=${res.status} attempt=${attempt}/${MAX_ATTEMPTS} — retrying in ${wait}ms`
        );
        await sleep(wait);
        continue;
      }

      const data = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith("image/"));

      if (!imgPart?.inlineData?.data) {
        console.warn(`[IMAGE_GEN] model=${model} attempt=${attempt}/${MAX_ATTEMPTS} — no inlineData`);
        if (attempt === MAX_ATTEMPTS) return null;
        // Text-only responses are usually transient — short backoff then retry.
        await sleep(Math.min(BASE_BACKOFF_MS * attempt, 4_000));
        continue;
      }

      console.log(`[IMAGE_GEN] Success model=${model} attempt=${attempt}`);
      return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
    } catch (err: any) {
      // Timeout / network error → back off + retry (previously: give up immediately)
      console.warn(`[IMAGE_GEN] model=${model} attempt=${attempt}/${MAX_ATTEMPTS} error:`, err?.message);
      if (attempt === MAX_ATTEMPTS) return null;
      const wait = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      if (Date.now() - startedAt + wait > DEADLINE_MS) return null;
      await sleep(wait);
    }
  }

  return null;
}

async function generateImageWithGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[IMAGE_GEN] GEMINI_API_KEY not set");
    return null;
  }

  // Only gemini-3.1-flash-image-preview is available on v1beta.
  // The other two models return 404 — removed from fallback chain.
  const models = ["gemini-3.1-flash-image-preview"];

  for (const model of models) {
    const result = await callGemini(model, prompt, apiKey);
    if (result) return result;
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

    // 500 chars gives Gemini enough context for high-quality image generation.
    // 100 was cutting prompts short and causing text-only (no inlineData) responses.
    const safePrompt = prompt.slice(0, 500);
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