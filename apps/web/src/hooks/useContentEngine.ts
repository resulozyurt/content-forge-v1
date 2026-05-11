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
  // generatedContent artık ham string değil, onaylı HTML chunk'larının dizisi
  const [generatedContent, setGeneratedContent] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startGeneration = async ({ keyword, targetLanguage }: GenerationParams) => {
    try {
      setStatus("RESEARCHING");
      setGeneratedContent("");
      setErrorMessage(null);

      // ── PHASE 1: RESEARCH AGENT ──────────────────────────────────────────
      const researchResponse = await fetch("/api/v2/generator/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, targetLanguage }),
      });
      if (!researchResponse.ok) {
        const errData = await researchResponse.json().catch(() => ({}));
        throw new Error(`Research Failed: ${errData.error || researchResponse.statusText}`);
      }
      const researchBlueprint = await researchResponse.json();

      // ── PHASE 2: PLANNER AGENT ───────────────────────────────────────────
      setStatus("PLANNING");
      const outlineResponse = await fetch("/api/v2/generator/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchBlueprint }),
      });
      if (!outlineResponse.ok) {
        const errData = await outlineResponse.json().catch(() => ({}));
        throw new Error(`Planning Phase Failed: ${errData.error || outlineResponse.statusText}`);
      }
      const { outline } = await outlineResponse.json();

      // Makale başlığını HTML olarak ekle — artık ## Markdown değil
      setGeneratedContent(
        `<h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-8 pb-4 border-b border-gray-200 dark:border-gray-700">${outline.title}</h1>\n\n`
      );

      // ── PHASE 3 & 4: WRITER + EDITOR LOOP ───────────────────────────────
      for (const section of outline.sections) {
        setStatus("WRITING_SECTION");
        setCurrentSectionName(section.title);

        const writerResponse = await fetch("/api/v2/generator/writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ researchBlueprint, sectionPlan: section }),
        });
        if (!writerResponse.ok) {
          throw new Error(`Writing Failed for section: ${section.title}`);
        }
        const { chunk: draftChunk } = await writerResponse.json();

        setStatus("QA_CHECK");

        const editorResponse = await fetch("/api/v2/generator/editor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: targetLanguage,
            generatedChunk: draftChunk,
            sectionPlan: section,
          }),
        });
        if (!editorResponse.ok) {
          throw new Error(`QA Check Failed for section: ${section.title}`);
        }
        const { chunk: finalApprovedChunk } = await editorResponse.json();

        // Onaylı HTML chunk'ı direkt state'e ekle — HİÇBİR dönüşüm yapma
        setGeneratedContent((prev) => prev + finalApprovedChunk + "\n\n");
      }

      setStatus("COMPLETED");
      setCurrentSectionName("");
    } catch (error: any) {
      console.error("[CONTENT_ENGINE_CRASH]", error);
      setStatus("ERROR");
      setErrorMessage(error.message || "An unexpected error occurred during generation.");
    }
  };

  return {
    status,
    currentSectionName,
    generatedContent,
    errorMessage,
    startGeneration,
  };
}