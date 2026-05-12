// apps/web/src/hooks/useContentEngine.ts
import { useState } from "react";

export type EngineStatus =
  | "IDLE"
  | "RESEARCHING"
  | "PLANNING"
  | "WRITING_SECTION"
  | "QA_CHECK"
  | "COMPLETED"
  | "ERROR";

interface GenerationParams {
  keyword: string;
  targetLanguage: "en-US" | "tr-TR" | "es-ES";
}

export function useContentEngine() {
  const [status, setStatus] = useState<EngineStatus>("IDLE");
  const [currentSectionName, setCurrentSectionName] = useState<string>("");
  const [generatedContent, setGeneratedContent] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startGeneration = async ({ keyword, targetLanguage }: GenerationParams) => {
    try {
      setStatus("RESEARCHING");
      setGeneratedContent("");
      setErrorMessage(null);

      // ── PHASE 1: RESEARCH ─────────────────────────────────────────────────
      const researchRes = await fetch("/api/v2/generator/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, targetLanguage }),
      });
      if (!researchRes.ok) {
        const err = await researchRes.json().catch(() => ({}));
        throw new Error(`Research failed: ${err.error || researchRes.statusText}`);
      }
      const researchBlueprint = await researchRes.json();

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

      if (!outline?.sections?.length) {
        throw new Error("Outline returned no sections.");
      }

      // Pre-compute all section titles — used by writer to generate lead summary
      const allSectionTitles: string[] = outline.sections.map((s: any) => s.title);

      // H1 title block — lead summary injected BEFORE this by the writer for section 0
      const h1Block = `<h1 style="font-size:2.2em;font-weight:800;line-height:1.3;margin:0 0 32px;color:#0f172a;">${outline.title}</h1>\n\n`;
      setGeneratedContent(h1Block);

      // ── PHASE 3+4: WRITE + QA EACH SECTION ───────────────────────────────
      for (let i = 0; i < outline.sections.length; i++) {
        const section = outline.sections[i];
        setStatus("WRITING_SECTION");
        setCurrentSectionName(section.title);

        const writerRes = await fetch("/api/v2/generator/writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            researchBlueprint: {
              ...researchBlueprint,
              articleTitle: outline.title,
            },
            sectionPlan: section,
            // Pass index so writer knows when to prepend lead summary (index 0 only)
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
          body: JSON.stringify({
            language: targetLanguage,
            generatedChunk: draftChunk,
            sectionPlan: section,
          }),
        });

        // On QA failure, fall back to draft rather than crashing the pipeline
        const { chunk: finalChunk } = editorRes.ok
          ? await editorRes.json()
          : { chunk: draftChunk };

        setGeneratedContent((prev) => prev + finalChunk + "\n\n");
      }

      setStatus("COMPLETED");
      setCurrentSectionName("");
    } catch (error: any) {
      console.error("[CONTENT_ENGINE_ERROR]", error);
      setStatus("ERROR");
      setErrorMessage(error.message || "An unexpected error occurred during generation.");
    }
  };

  return { status, currentSectionName, generatedContent, errorMessage, startGeneration };
}