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
  // The exact headings the user built in Outline Architect — used directly
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

      // ── PHASE 1: RESEARCH — fetch brand/sitemap context only ─────────────
      // We do NOT hit the outline agent here. The user's headings are the outline.
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

      // ── Build a working outline from the user's Outline Architect headings ─
      // Group headings: every H2 becomes a section, its H3/H4 children are sub-points
      const sections = buildSectionsFromHeadings(userHeadings);
      const articleTitle = keyword; // H1 uses keyword; a dedicated title agent can replace this
      const allSectionTitles = sections.map((s) => s.title);

      // H1
      const h1Html = `<h1 style="font-size:2.2em;font-weight:800;line-height:1.3;margin:0 0 32px;color:#0f172a;">${articleTitle}</h1>\n\n`;
      setGeneratedContent(h1Html);
      let fullHtml = h1Html;

      // ── PHASE 2: Write each section using the user's headings ────────────
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
          console.warn(`[ENGINE] Writing failed for section ${i}: "${section.title}" — skipping`);
          continue;
        }
        const { chunk: draftChunk } = await writerRes.json();

        // ── QA pass ────────────────────────────────────────────────────────
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
        const { chunk: finalChunk } = editorRes.ok
          ? await editorRes.json()
          : { chunk: draftChunk };

        fullHtml += finalChunk + "\n\n";
        setGeneratedContent(fullHtml);
      }

      // ── PHASE 3: SEO metadata ─────────────────────────────────────────────
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
      } catch {
        // Non-critical — user can fill in manually
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

// ---------------------------------------------------------------------------
// Convert flat OutlineHeading[] into section objects the writer can consume.
// Each H2 becomes a section; its immediate H3/H4 children become subHeadings.
// ---------------------------------------------------------------------------
function buildSectionsFromHeadings(headings: OutlineHeading[]) {
  const sections: Array<{
    title: string;
    headingLevel: string;
    subHeadings: string[];
    requiredFormat: string;
    includeImage: boolean;
    includeH3: boolean;
    maxParagraphSentences: number;
    entitiesToInclude: string[];
  }> = [];

  let currentSection: (typeof sections)[0] | null = null;
  let h2Counter = 0;

  for (const h of headings) {
    if (h.level === "h2") {
      if (currentSection) sections.push(currentSection);
      h2Counter++;

      // Assign format variety across sections
      const formats = ["paragraph", "bullet_list", "html_table", "key_points", "blockquote", "paragraph"];
      const requiredFormat = formats[h2Counter % formats.length];

      currentSection = {
        title: h.text,
        headingLevel: "h2",
        subHeadings: [],
        requiredFormat,
        // Place an image every 2 H2 sections
        includeImage: h2Counter % 2 === 1,
        includeH3: false,
        maxParagraphSentences: 2,
        entitiesToInclude: [],
      };
    } else if ((h.level === "h3" || h.level === "h4") && currentSection) {
      currentSection.subHeadings.push(`${h.level.toUpperCase()}: ${h.text}`);
      currentSection.includeH3 = true;
    }
  }

  if (currentSection) sections.push(currentSection);

  return sections;
}