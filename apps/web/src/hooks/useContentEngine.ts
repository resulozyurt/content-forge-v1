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
// BUG 3 FIX: swapImagePlaceholder
// ---------------------------------------------------------------------------
// Previous approach used a multi-capture regex with [\s\S]*? lazy match.
// That broke in 3 ways:
//   1. style="...rgba(0,0,0,0.08)..." inside attributes confused [^>]* matching
//   2. Lazy [\s\S]*? was cut short by </figure> appearing after <figcaption>
//   3. Second replace (opacity removal) had wrong attribute order assumption
//
// New approach: string.indexOf() to locate the exact figure block by its
// data-img-placeholder="N" marker, then surgically replace only the <img>
// tag inside it. No regex on the outer figure — just find/slice/reassemble.
// ---------------------------------------------------------------------------
function swapImagePlaceholder(
  html: string,
  sectionIndex: number,
  finalSrc: string,
  altText: string
): string {
  const marker = `data-img-placeholder="${sectionIndex}"`;
  const figureStart = html.indexOf(`<figure ${marker}`);
  // Also try with style before data attr (attribute order may vary)
  const figureStartAlt = html.indexOf(`<figure `, html.indexOf(marker) - 200 < 0 ? 0 : html.indexOf(marker) - 200);

  // Find the figure opening tag that contains our marker
  let blockStart = -1;
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const candidate = html.indexOf("<figure ", searchFrom);
    if (candidate === -1) break;
    // Check if this figure tag contains our marker (within the tag itself, before first >)
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

  // Find the matching </figure> — handle nested figures if any by counting depth
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

  // Extract the figure block
  const figureBlock = html.slice(blockStart, blockEnd);

  // Find <img inside the figure block
  const imgStart = figureBlock.indexOf("<img ");
  if (imgStart === -1) {
    console.warn(`[IMAGE_SWAP] <img> not found inside figure for sectionIndex=${sectionIndex}`);
    return html;
  }

  // Find the end of the img tag (self-closing />  or >)
  let imgEnd = figureBlock.indexOf("/>", imgStart);
  const imgEndSimple = figureBlock.indexOf(">", imgStart);
  if (imgEnd === -1 || (imgEndSimple !== -1 && imgEndSimple < imgEnd)) {
    imgEnd = imgEndSimple + 1;
  } else {
    imgEnd = imgEnd + 2; // include />
  }

  // Build replacement img tag — clean, no placeholder opacity
  const newImg = `<img src="${finalSrc}" alt="${altText}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);" loading="lazy" width="1200" height="630" />`;

  // Build replacement figure — remove opacity:0.5 from wrapper style
  const newFigureBlock = figureBlock
    .slice(0, imgStart)
    .replace(/opacity:[^;'"]+;?\s*/g, "") // remove opacity from figure style
    + newImg
    + figureBlock.slice(imgEnd);

  // Reassemble full HTML
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

      // ── PHASE 1: RESEARCH — embed ResearchAccordion data into blueprint ────
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

      // ── Build raw sections from Outline Architect headings ─────────────────
      const rawSections = buildSectionsFromHeadings(userHeadings);
      if (!rawSections.length) throw new Error("No sections to generate — outline is empty.");

      const articleTitle = keyword;
      const allSectionTitles = rawSections.map((s) => s.title);

      // ── PHASE 2: ORCHESTRATE — narrative blueprint + semantic section plan ──
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

      // Track per-section summaries for context chaining (P1 — bridge sentences)
      const sectionSummaries: string[] = [];

      // FIX 4: Image promises fired in parallel with section writing.
      // Each entry: { promise: Promise<ImageResult>, sectionIndex: number }
      // We collect them all and swap placeholders after the section loop.
      interface ImageResult {
        imageDataUri: string | null;
        sectionIndex: number;
        sectionTitle: string;
        fallbackSrc: string;
      }
      const imagePromises: Array<Promise<ImageResult>> = [];

      // H1
      const h1Html = `<h1 style="font-size:2.2em;font-weight:800;line-height:1.3;margin:0 0 32px;color:#0f172a;">${articleTitle}</h1>\n\n`;
      setGeneratedContent(h1Html);
      let fullHtml = h1Html;

      // ── PHASE 3+4: WRITE + QA ─────────────────────────────────────────────
      for (let i = 0; i < enrichedSections.length; i++) {
        const section = enrichedSections[i];
        setStatus("WRITING_SECTION");
        setCurrentSectionName(section.title);

        // Rate-limit guard: wait between sections to avoid hitting Anthropic's
        // 20,000 input token/minute ceiling (Tier 1). Each writer call uses
        // ~3,000-4,000 tokens. A 3.5s delay keeps us safely under the limit
        // while keeping generation fast enough for a good UX.
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 3500));
        }

        const writerRes = await fetch("/api/v2/generator/writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
              // Context chaining: pass the previous section's closing summary
              // so the writer can open with a natural bridge sentence
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

        // FIX 4: Fire image generation immediately after writer returns —
        // do NOT await. The image resolves while the next section is being written.
        if (imagePrompt) {
          const imgPromise: Promise<ImageResult> = fetch("/api/v2/generator/image-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: imagePrompt,
              sectionIndex: i,
              sectionTitle: section.title,
            }),
          })
            .then((r) => r.ok ? r.json() : Promise.resolve({ imageDataUri: null, sectionIndex: i, sectionTitle: section.title, fallbackSrc: "" }))
            .catch(() => ({ imageDataUri: null, sectionIndex: i, sectionTitle: section.title, fallbackSrc: "" }));
          imagePromises.push(imgPromise);
        }

        // Store the summary for the next section's context chaining
        if (newSummary) {
          sectionSummaries.push(newSummary);
        } else {
          sectionSummaries.push(""); // placeholder to keep index alignment
        }

        setStatus("QA_CHECK");
        let finalChunk = draftChunk;

        try {
          const editorRes = await fetch("/api/v2/generator/editor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: targetLanguage, generatedChunk: draftChunk, sectionPlan: section }),
          });
          if (editorRes.ok) {
            const ed = await editorRes.json();
            finalChunk = ed.chunk || draftChunk;
          }
        } catch (e) {
          console.warn(`[ENGINE] Editor error section ${i} — using draft`, e);
        }

        fullHtml += finalChunk + "\n\n";
        setGeneratedContent(fullHtml);
      }

      // ── PHASE 3.5: RESOLVE IMAGES + SWAP PLACEHOLDERS ────────────────────
      // All section content is already in the UI. Now we wait for image promises
      // (which were fired in parallel during writing) and swap the placeholders.
      // BUG 3 FIX: replaced fragile regex with swapImagePlaceholder() which uses
      // indexOf + slice — immune to attribute order, nested tags, special chars.
      if ((imagePromises.length ?? 0) > 0) {
        try {
          const imageResults = await Promise.allSettled(imagePromises);
          let swappedHtml = fullHtml;

          for (const result of imageResults) {
            if (result.status !== "fulfilled") continue;
            const { imageDataUri, sectionIndex: imgIdx, sectionTitle, fallbackSrc } = result.value;

            const finalSrc = imageDataUri ?? fallbackSrc;
            if (!finalSrc) {
              console.warn(`[ENGINE] No image src for section ${imgIdx} — placeholder stays`);
              continue;
            }

            const altText = (sectionTitle || "").replace(/"/g, "&quot;");
            swappedHtml = swapImagePlaceholder(swappedHtml, imgIdx, finalSrc, altText);
            console.log(`[ENGINE] Image swapped for section ${imgIdx}: ${imageDataUri ? "Gemini" : "fallback"}`);
          }

          fullHtml = swappedHtml;
          setGeneratedContent(swappedHtml);
        } catch (e) {
          console.warn("[ENGINE] Image swap error — content unaffected", e);
        }
      }

      // ── PHASE 5: SEO METADATA ─────────────────────────────────────────────
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