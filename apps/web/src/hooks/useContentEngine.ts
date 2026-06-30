// apps/web/src/hooks/useContentEngine.ts
import { useState } from "react";
import { OutlineHeading } from "@/types/generator";

export type EngineStatus =
  | "IDLE"
  | "RESEARCHING"
  | "ORCHESTRATING"
  | "WRITING_SECTION"
  | "QA_CHECK"
  | "GENERATING_SEO"
  | "COMPLETED"
  | "ERROR";

export interface SeoMetadata {
  focusKeyword: string;
  metaTitle: string;
  metaDescription: string;
}

interface GenerationParams {
  keyword: string;
  targetLanguage: "en-US" | "tr-TR" | "es-ES";
  userHeadings: OutlineHeading[];
  selectedKeywords: string[];
  // Forwarded from ResearchAccordion — PAA questions and content gaps
  questions?: string[];
  gaps?: string[];
}

// ---------------------------------------------------------------------------
// FIX 5: Spacing between successive Gemini image-generation calls (ms).
// The image-preview model shares ONE per-project RPM pool, so firing images
// back-to-back (or concurrently) is the main trigger for 429 RESOURCE_EXHAUSTED.
// Images are generated one at a time with this gap between them. Tune as needed
// to match your tier's per-minute image quota.
// ---------------------------------------------------------------------------
const IMAGE_RATE_DELAY_MS = 6_000;

// ---------------------------------------------------------------------------
// TABLE BUG FIX — Layer 3 (final safety net).
// This is the LAST common point before all section chunks are concatenated
// into one HTML string (`fullHtml += finalChunk`) and handed to DOMPurify /
// TipTap's setContent(), which parse it with the browser's native HTML5
// parser. If any chunk still contains an unclosed <table>/<tr>/<td> at this
// point — whether the writer or editor repair layers were bypassed, timed
// out, or a future change removes them — the browser parser's "in cell"
// insertion mode will silently swallow everything that follows into that
// open cell. This layer guarantees that can never happen, regardless of what
// happened upstream.
// ---------------------------------------------------------------------------
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function closeUnclosedHtmlTags(html: string): string {
  if (!html) return html;
  const tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2].toLowerCase();
    const isSelfClosing = match[3] === "/";

    if (VOID_TAGS.has(tagName) || isSelfClosing) continue;

    if (isClosing) {
      const idx = stack.lastIndexOf(tagName);
      if (idx !== -1) stack.splice(idx, 1);
    } else {
      stack.push(tagName);
    }
  }

  if (stack.length === 0) return html;

  const closingTags = stack.reverse().map((t) => `</${t}>`).join("");
  console.warn(`[HTML_REPAIR][useContentEngine] Unclosed tag(s) auto-closed before concat: ${stack.join(", ")}`);
  return html + closingTags;
}

// ---------------------------------------------------------------------------
// BUG 3 FIX: swapImagePlaceholder
// ---------------------------------------------------------------------------
function swapImagePlaceholder(
  html: string,
  sectionIndex: number,
  finalSrc: string,
  altText: string
): string {
  const marker = `data-img-placeholder="${sectionIndex}"`;

  // Find the figure opening tag that contains our marker
  let blockStart = -1;
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const candidate = html.indexOf("<figure ", searchFrom);
    if (candidate === -1) break;
    const tagEnd = html.indexOf(">", candidate);
    if (tagEnd === -1) break;
    const tagContent = html.slice(candidate, tagEnd + 1);
    if (tagContent.includes(marker)) {
      blockStart = candidate;
      break;
    }
    searchFrom = candidate + 1;
  }

  if (blockStart === -1) {
    console.warn(`[IMAGE_SWAP] Placeholder not found for sectionIndex=${sectionIndex}`);
    return html;
  }

  // Find the matching </figure> by depth counting
  let depth = 0;
  let blockEnd = -1;
  let pos = blockStart;
  while (pos < html.length) {
    const openIdx = html.indexOf("<figure", pos);
    const closeIdx = html.indexOf("</figure>", pos);

    if (closeIdx === -1) break;

    if (openIdx !== -1 && openIdx < closeIdx) {
      depth++;
      pos = openIdx + 1;
    } else {
      depth--;
      if (depth === 0) {
        blockEnd = closeIdx + "</figure>".length;
        break;
      }
      pos = closeIdx + 1;
    }
  }

  if (blockEnd === -1) {
    console.warn(`[IMAGE_SWAP] </figure> not found for sectionIndex=${sectionIndex}`);
    return html;
  }

  const figureBlock = html.slice(blockStart, blockEnd);

  const imgStart = figureBlock.indexOf("<img ");
  if (imgStart === -1) {
    console.warn(`[IMAGE_SWAP] <img> not found inside figure for sectionIndex=${sectionIndex}`);
    return html;
  }

  let imgEnd = figureBlock.indexOf("/>", imgStart);
  const imgEndSimple = figureBlock.indexOf(">", imgStart);
  if (imgEnd === -1 || (imgEndSimple !== -1 && imgEndSimple < imgEnd)) {
    imgEnd = imgEndSimple + 1;
  } else {
    imgEnd = imgEnd + 2;
  }

  const newImg = `<img src="${finalSrc}" alt="${altText}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);" loading="lazy" width="1200" height="630" />`;

  const newFigureBlock = figureBlock
    .slice(0, imgStart)
    .replace(/opacity:[^;'"]+;?\s*/g, "")
    + newImg
    + figureBlock.slice(imgEnd);

  return html.slice(0, blockStart) + newFigureBlock + html.slice(blockEnd);
}

export function useContentEngine() {
  const [status, setStatus] = useState<EngineStatus>("IDLE");
  const [currentSectionName, setCurrentSectionName] = useState<string>("");
  const [generatedContent, setGeneratedContent] = useState<string>("");
  const [seoMetadata, setSeoMetadata] = useState<SeoMetadata | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startGeneration = async ({
    keyword,
    targetLanguage,
    userHeadings,
    selectedKeywords,
    questions = [],
    gaps = [],
  }: GenerationParams) => {
    try {
      setStatus("RESEARCHING");
      setGeneratedContent("");
      setSeoMetadata(null);
      setErrorMessage(null);

      // ── PHASE 1: RESEARCH ────────────────────────────────────────────────
      const researchRes = await fetch("/api/v2/generator/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, targetLanguage, selectedKeywords, questions, gaps }),
      });
      if (!researchRes.ok) {
        const err = await researchRes.json().catch(() => ({}));
        throw new Error(`Research failed: ${err.error || researchRes.statusText}`);
      }
      const researchBlueprint = await researchRes.json();

      // ── Build raw sections from Outline Architect headings ───────────────
      const rawSections = buildSectionsFromHeadings(userHeadings);
      if (!rawSections.length) throw new Error("No sections to generate — outline is empty.");

      const articleTitle = keyword;
      const allSectionTitles = rawSections.map((s) => s.title);

      // ── PHASE 2: ORCHESTRATE ─────────────────────────────────────────────
      setStatus("ORCHESTRATING");
      let enrichedSections = rawSections;
      let narrativeThread = "";
      let storySpine = "";
      let uniqueAngle = "";

      try {
        const orchRes = await fetch("/api/v2/generator/orchestrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ researchBlueprint, sections: rawSections }),
        });
        if (orchRes.ok) {
          const orchData = await orchRes.json();
          enrichedSections = orchData.enrichedSections || rawSections;
          narrativeThread = orchData.narrativeThread || "";
          storySpine = orchData.storySpine || "";
          uniqueAngle = orchData.uniqueAngle || "";
        }
      } catch {
        console.warn("[ENGINE] Orchestration failed — falling back to raw sections");
      }

      // SORUN 3 FIX: Son section conclusion değilse otomatik conclusion ekle.
      // Kullanıcı outline'ında "Conclusion" veya "Sonuç" H2'si yoksa sistem ekler.
      // Bu sayede her makalede garantili bir conclusion H2 olur.
      const lastSection = enrichedSections[enrichedSections.length - 1];
      const lastTitle = lastSection?.title?.toLowerCase() ?? "";
      const hasConclusion =
        lastSection?.sectionRole === "conclusion" ||
        /\b(conclusion|summary|wrap.?up|sonuç|özet|son\s|kapanış)\b/.test(lastTitle);

      if (!hasConclusion) {
        const isTr = targetLanguage.toLowerCase().includes("tr");
        const conclusionTitle = isTr ? "Sonuç ve Öneriler" : "Conclusion";
        const conclusionSection = {
          title: conclusionTitle,
          headingLevel: "h2",
          subHeadings: [],
          requiredFormat: "paragraph",
          sectionRole: "conclusion",
          includeImage: false,
          includeH3: false,
          maxParagraphSentences: 2,
          entitiesToInclude: [],
          assignedPAA: null,
          contentGap: null,
          prevSectionTitle: lastSection?.title ?? null,
          nextSectionTitle: null,
        };
        enrichedSections = [...enrichedSections, conclusionSection];
        console.log(`[ENGINE] Auto-added conclusion section: "${conclusionTitle}"`);
      }

      // Track per-section summaries for context chaining
      const sectionSummaries: string[] = [];

      // FIX 5: Image jobs are COLLECTED during writing, then resolved
      // sequentially AFTER the writing loop (see PHASE 3.5) so that concurrent
      // Gemini calls never pile up and trip the per-minute (RPM) quota.
      interface ImageResult {
        imageDataUri: string | null;
        sectionIndex: number;
        sectionTitle: string;
        fallbackSrc: string;
      }
      interface ImageJob {
        prompt: string;
        sectionIndex: number;
        sectionTitle: string;
      }
      const imageJobs: ImageJob[] = [];

      // H1
      const h1Html = `<h1 style="font-size:2.2em;font-weight:800;line-height:1.3;margin:0 0 32px;color:#0f172a;">${articleTitle}</h1>\n\n`;
      setGeneratedContent(h1Html);
      let fullHtml = h1Html;

      // ── PHASE 3+4: WRITE + QA ────────────────────────────────────────────
      for (let i = 0; i < enrichedSections.length; i++) {
        const section = enrichedSections[i];
        setStatus("WRITING_SECTION");
        setCurrentSectionName(section.title);

        // Rate-limit guard: 3.5s delay between sections (Anthropic Tier 1)
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 3500));
        }

        // 90s timeout — writer calls Claude (~25s) + potential delays.
        // Without this, Railway's 60s hard limit silently kills the request
        // and the browser surfaces it as the cryptic "Failed to fetch" error.
        const writerRes = await fetch("/api/v2/generator/writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            researchBlueprint: {
              ...researchBlueprint,
              articleTitle,
              narrativeThread,
              storySpine,
              uniqueAngle,
            },
            sectionPlan: {
              ...section,
              prevSectionSummary: i > 0 ? sectionSummaries[i - 1] : null,
            },
            sectionIndex: i,
            allSectionTitles,
          }),
        });

        if (!writerRes.ok) {
          console.warn(`[ENGINE] Writer failed section ${i}: "${section.title}" — skipping`);
          continue;
        }
        const {
          chunk: draftChunk,
          sectionSummary: newSummary,
          imagePrompt,
          sectionIndex: writerSectionIndex,
        } = await writerRes.json();

        // FIX 5: Collect the image job — do NOT fire the request here.
        // Firing inside the loop let multiple long-running (now retrying) image
        // calls overlap and share the per-project RPM pool → 429. We resolve
        // them one at a time after the writing loop instead.
        if (imagePrompt) {
          imageJobs.push({ prompt: imagePrompt, sectionIndex: i, sectionTitle: section.title });
        }

        if (newSummary) {
          sectionSummaries.push(newSummary);
        } else {
          sectionSummaries.push("");
        }

        setStatus("QA_CHECK");
        let finalChunk = draftChunk;

        try {
          const editorRes = await fetch("/api/v2/generator/editor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ language: targetLanguage, generatedChunk: draftChunk, sectionPlan: section }),
          });
          if (editorRes.ok) {
            const ed = await editorRes.json();
            finalChunk = ed.chunk || draftChunk;
          }
        } catch (e) {
          console.warn(`[ENGINE] Editor error section ${i} — using draft`, e);
        }

        // TABLE BUG FIX — Layer 3: repair any unclosed tag in this chunk
        // immediately before it gets permanently concatenated. This is the
        // last point where it's still a single section's HTML rather than
        // part of one giant string that browsers/TipTap will parse as a
        // single DOM tree.
        finalChunk = closeUnclosedHtmlTags(finalChunk);

        fullHtml += finalChunk + "\n\n";
        setGeneratedContent(fullHtml);
      }

      // ── PHASE 3.5: RESOLVE IMAGES SEQUENTIALLY + SWAP PLACEHOLDERS ───────
      // The single most important guard against Gemini 429: generate images one
      // at a time, with IMAGE_RATE_DELAY_MS spacing, so overlapping requests
      // never share (and exhaust) the per-project per-minute quota. Each image
      // is swapped into the HTML as soon as it resolves — progressive render.
      if ((imageJobs.length ?? 0) > 0) {
        let swappedHtml = fullHtml;

        for (let j = 0; j < imageJobs.length; j++) {
          const job = imageJobs[j];

          // Space successive calls to stay under the per-minute image quota.
          if (j > 0) {
            await new Promise((resolve) => setTimeout(resolve, IMAGE_RATE_DELAY_MS));
          }

          let result: ImageResult;
          try {
            const r = await fetch("/api/v2/generator/image-generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // Slightly above the route's own ~110s deadline so its internal
              // retries can complete before the client aborts.
              signal: AbortSignal.timeout(120000),
              body: JSON.stringify({
                prompt: job.prompt,
                sectionIndex: job.sectionIndex,
                sectionTitle: job.sectionTitle,
              }),
            });
            result = r.ok
              ? await r.json()
              : { imageDataUri: null, sectionIndex: job.sectionIndex, sectionTitle: job.sectionTitle, fallbackSrc: "" };
          } catch {
            result = { imageDataUri: null, sectionIndex: job.sectionIndex, sectionTitle: job.sectionTitle, fallbackSrc: "" };
          }

          const { imageDataUri, sectionIndex: imgIdx, sectionTitle, fallbackSrc } = result;
          const finalSrc = imageDataUri ?? fallbackSrc;
          if (!finalSrc) {
            console.warn(`[ENGINE] No image src for section ${imgIdx} — placeholder stays`);
            continue;
          }

          const altText = (sectionTitle || "").replace(/"/g, "&quot;");
          swappedHtml = swapImagePlaceholder(swappedHtml, imgIdx, finalSrc, altText);
          console.log(`[ENGINE] Image swapped for section ${imgIdx}: ${imageDataUri ? "Gemini" : "fallback"}`);

          // Progressive update — show each image the moment it resolves.
          fullHtml = swappedHtml;
          setGeneratedContent(swappedHtml);
        }
      }

      // ── PHASE 5: SEO METADATA ────────────────────────────────────────────
      setStatus("GENERATING_SEO");
      try {
        const seoRes = await fetch("/api/v2/generator/seo-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleTitle, keyword, selectedKeywords, language: targetLanguage,
            contentSample: fullHtml.replace(/<[^>]+>/g, " ").slice(0, 3000),
          }),
        });
        if (seoRes.ok) setSeoMetadata(await seoRes.json());
      } catch { /* non-critical */ }

      setStatus("COMPLETED");
      setCurrentSectionName("");
    } catch (error: any) {
      console.error("[CONTENT_ENGINE_ERROR]", error);
      setStatus("ERROR");
      setErrorMessage(error.message || "An unexpected error occurred.");
    }
  };

  return { status, currentSectionName, generatedContent, seoMetadata, errorMessage, startGeneration };
}

// ---------------------------------------------------------------------------
// Builds raw section objects from OutlineHeading[].
// Format/role/PAA fields are placeholders — orchestrator overwrites them.
// ---------------------------------------------------------------------------
function buildSectionsFromHeadings(headings: OutlineHeading[]) {
  type Section = {
    title: string; headingLevel: string; subHeadings: string[];
    requiredFormat: string; sectionRole: string; includeImage: boolean;
    includeH3: boolean; maxParagraphSentences: number; entitiesToInclude: string[];
    assignedPAA: string | null; contentGap: string | null;
    prevSectionTitle: string | null; nextSectionTitle: string | null;
  };

  const sections: Section[] = [];
  let current: Section | null = null;

  for (const h of headings) {
    if (h.level === "h2") {
      if (current) sections.push(current);
      current = {
        title: h.text, headingLevel: "h2", subHeadings: [],
        requiredFormat: "paragraph", sectionRole: "body",
        includeImage: true, includeH3: false, maxParagraphSentences: 2,
        entitiesToInclude: [], assignedPAA: null, contentGap: null,
        prevSectionTitle: null, nextSectionTitle: null,
      };
    } else if ((h.level === "h3" || h.level === "h4") && current) {
      current.subHeadings.push(`${h.level.toUpperCase()}: ${h.text}`);
      current.includeH3 = true;
    }
  }
  if (current) sections.push(current);
  return sections;
}