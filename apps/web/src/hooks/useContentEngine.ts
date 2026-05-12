// apps/web/src/hooks/useContentEngine.ts
import { useState } from "react";
import { OutlineHeading } from "@/types/generator";

export type EngineStatus =
  | "IDLE"
  | "RESEARCHING"
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
      researchBlueprint.selectedKeywords = selectedKeywords;

      // ── Build sections from user's Outline Architect headings ─────────────
      const sections = buildSectionsFromHeadings(userHeadings);
      const articleTitle = keyword;
      const allSectionTitles = sections.map((s) => s.title);

      const h1Html = `<h1 style="font-size:2.2em;font-weight:800;line-height:1.3;margin:0 0 32px;color:#0f172a;">${articleTitle}</h1>\n\n`;
      setGeneratedContent(h1Html);
      let fullHtml = h1Html;

      // ── PHASE 2+3: WRITE + QA each section ───────────────────────────────
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        setStatus("WRITING_SECTION");
        setCurrentSectionName(section.title);

        const writerRes = await fetch("/api/v2/generator/writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            researchBlueprint: { ...researchBlueprint, articleTitle },
            sectionPlan: section,
            sectionIndex: i,
            allSectionTitles,
          }),
        });

        if (!writerRes.ok) {
          console.warn(`[ENGINE] Writer failed for section ${i}: "${section.title}" — skipping`);
          continue;
        }
        const { chunk: draftChunk } = await writerRes.json();

        // ── QA — NEVER crash on editor failure ────────────────────────────
        setStatus("QA_CHECK");
        let finalChunk = draftChunk;

        try {
          const editorRes = await fetch("/api/v2/generator/editor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              language: targetLanguage,
              generatedChunk: draftChunk,
              sectionPlan: section,
            }),
          });
          // Editor now always returns 200 — use its chunk regardless of status field
          if (editorRes.ok) {
            const editorData = await editorRes.json();
            finalChunk = editorData.chunk || draftChunk;
          }
        } catch (editorErr) {
          // Network error on editor — use draft chunk, log and continue
          console.warn(`[ENGINE] Editor network error for section ${i} — using draft`, editorErr);
        }

        fullHtml += finalChunk + "\n\n";
        setGeneratedContent(fullHtml);
      }

      // ── PHASE 4: SEO METADATA ─────────────────────────────────────────────
      setStatus("GENERATING_SEO");
      try {
        const seoRes = await fetch("/api/v2/generator/seo-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            articleTitle,
            keyword,
            selectedKeywords,
            language: targetLanguage,
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
// Convert flat OutlineHeading[] into section objects the writer consumes.
// Each H2 → section; H3/H4 children → subHeadings array.
// ---------------------------------------------------------------------------
function buildSectionsFromHeadings(headings: OutlineHeading[]) {
  type Section = {
    title: string;
    headingLevel: string;
    subHeadings: string[];
    requiredFormat: string;
    includeImage: boolean;
    includeH3: boolean;
    maxParagraphSentences: number;
    entitiesToInclude: string[];
  };

  const sections: Section[] = [];
  let current: Section | null = null;
  let h2Counter = 0;

  const formats = ["paragraph", "bullet_list", "html_table", "key_points", "blockquote", "paragraph"];

  for (const h of headings) {
    if (h.level === "h2") {
      if (current) sections.push(current);
      h2Counter++;
      current = {
        title: h.text,
        headingLevel: "h2",
        subHeadings: [],
        requiredFormat: formats[h2Counter % formats.length],
        includeImage: h2Counter % 2 === 1,
        includeH3: false,
        maxParagraphSentences: 2,
        entitiesToInclude: [],
      };
    } else if ((h.level === "h3" || h.level === "h4") && current) {
      current.subHeadings.push(`${h.level.toUpperCase()}: ${h.text}`);
      current.includeH3 = true;
    }
  }
  if (current) sections.push(current);
  return sections;
}