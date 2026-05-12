// apps/web/src/hooks/useContentEngine.ts
import { useState } from "react";

export type EngineStatus =
  | "IDLE"
  | "RESEARCHING"
  | "PLANNING"
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
  selectedKeywords?: string[];
  allHeadings?: string[];
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
    selectedKeywords = [],
    allHeadings = [],
  }: GenerationParams) => {
    try {
      setStatus("RESEARCHING");
      setGeneratedContent("");
      setSeoMetadata(null);
      setErrorMessage(null);

      // ── PHASE 1: RESEARCH ─────────────────────────────────────────────────
      const researchRes = await fetch("/api/v2/generator/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, targetLanguage, selectedKeywords }),
      });
      if (!researchRes.ok) {
        const err = await researchRes.json().catch(() => ({}));
        throw new Error(`Research failed: ${err.error || researchRes.statusText}`);
      }
      const researchBlueprint = await researchRes.json();
      // Inject selected keywords so writer can use them for density optimization
      researchBlueprint.selectedKeywords = selectedKeywords;

      // ── PHASE 2: OUTLINE ──────────────────────────────────────────────────
      setStatus("PLANNING");
      const outlineRes = await fetch("/api/v2/generator/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchBlueprint }),
      });
      if (!outlineRes.ok) {
        const err = await outlineRes.json().catch(() => ({}));
        throw new Error(`Planning failed: ${err.error || outlineRes.statusText}`);
      }
      const { outline } = await outlineRes.json();
      if (!outline?.sections?.length) throw new Error("Outline returned no sections.");

      const allSectionTitles: string[] = outline.sections.map((s: any) => s.title);

      const h1Block = `<h1 style="font-size:2.2em;font-weight:800;line-height:1.3;margin:0 0 32px;color:#0f172a;">${outline.title}</h1>\n\n`;
      setGeneratedContent(h1Block);
      let fullHtml = h1Block;

      // ── PHASE 3+4: WRITE + QA each section ───────────────────────────────
      for (let i = 0; i < outline.sections.length; i++) {
        const section = outline.sections[i];
        setStatus("WRITING_SECTION");
        setCurrentSectionName(section.title);

        const writerRes = await fetch("/api/v2/generator/writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            researchBlueprint: { ...researchBlueprint, articleTitle: outline.title },
            sectionPlan: section,
            sectionIndex: i,
            allSectionTitles,
          }),
        });
        if (!writerRes.ok) {
          console.warn(`Writing failed for section ${i}: "${section.title}" — skipping`);
          continue;
        }
        const { chunk: draftChunk } = await writerRes.json();

        setStatus("QA_CHECK");
        const editorRes = await fetch("/api/v2/generator/editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: targetLanguage, generatedChunk: draftChunk, sectionPlan: section }),
        });
        const { chunk: finalChunk } = editorRes.ok ? await editorRes.json() : { chunk: draftChunk };

        fullHtml += finalChunk + "\n\n";
        setGeneratedContent(fullHtml);
      }

      // ── PHASE 5: SEO METADATA ─────────────────────────────────────────────
      setStatus("GENERATING_SEO");
      try {
        const seoRes = await fetch("/api/v2/generator/seo-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleTitle: outline.title,
            keyword,
            selectedKeywords,
            language: targetLanguage,
            contentSample: fullHtml.replace(/<[^>]+>/g, " ").slice(0, 3000),
          }),
        });
        if (seoRes.ok) setSeoMetadata(await seoRes.json());
      } catch {
        // Non-critical
      }

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