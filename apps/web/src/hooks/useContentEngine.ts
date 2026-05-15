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
      // Even if some fail, content is unaffected — placeholders stay as fallbacks.
      if ((imagePromises.length ?? 0) > 0) {
        try {
          const imageResults = await Promise.allSettled(imagePromises);
          let swappedHtml = fullHtml;

          for (const result of imageResults) {
            if (result.status !== "fulfilled") continue;
            const { imageDataUri, sectionIndex: imgIdx, sectionTitle, fallbackSrc } = result.value;

            const finalSrc = imageDataUri ?? fallbackSrc;
            if (!finalSrc) continue;

            // Replace the placeholder figure for this sectionIndex
            // Pattern: <figure data-img-placeholder="N" ...>...<img src="...placeholder..." .../>...</figure>
            const placeholderRegex = new RegExp(
              `(<figure data-img-placeholder="${imgIdx}"[^>]*>[\\s\\S]*?<img)[^>]*?(\\/>)`,
              "i"
            );
            const altText = (sectionTitle || "").replace(/"/g, "&quot;");
            swappedHtml = swappedHtml.replace(
              placeholderRegex,
              `$1 src="${finalSrc}" alt="${altText}" style="width:100%;height:auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.08);" loading="lazy" width="1200" height="630" $2`
            );

            // Also remove the placeholder opacity from the figure wrapper
            swappedHtml = swappedHtml.replace(
              new RegExp(`(data-img-placeholder="${imgIdx}"[^>]*style=")[^"]*(")`),
              `$1margin:28px 0;text-align:center;$2`
            );

            console.log(`[ENGINE] Image swapped for section ${imgIdx}: ${imageDataUri ? "real" : "fallback"}`);
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