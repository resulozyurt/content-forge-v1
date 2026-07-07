// apps/web/src/lib/language.ts
//
// Single source of truth for output language across the whole generation
// pipeline. Every route/component that used to hand-roll its own
// "en-US" / "English (US)" / "tr" / "es-ES" string now normalizes through
// this helper instead. This kills the format drift (4 different shapes for
// the same concept) and the unreachable es-ES branch that previously lived
// in LiveGeneration.
//
// `code` is the ONLY value that should travel through the pipeline
// (research → orchestrate → writer → editor → seo-meta). Anything that needs
// a locale or a human label derives it from here — never re-invents it.

// Mirrors the `Language` union in types/generator.ts. Kept local so this
// module has zero import cycles with the type layer.
export type LanguageCode = "en" | "tr";

export interface NormalizedLanguage {
  /** Canonical 2-letter code — the value threaded through every API route. */
  code: LanguageCode;
  /** BCP-47 locale for anything that genuinely needs a region tag. */
  engineLocale: "en-US" | "tr-TR";
  /** Human-readable label for prompts and UI, e.g. "English (US)". */
  label: string;
  /** Convenience flag so call sites stop re-deriving `.includes("tr")`. */
  isTurkish: boolean;
  /**
   * Ready-to-inject HARD language directive for Claude system prompts.
   * Deliberately worded to override the language of any heading, keyword,
   * or source text — this is what stops competitor-scraped Spanish headings
   * from dragging the body into Spanish (Fix #2 consumes this).
   */
  promptRule: string;
}

// Anything that looks Turkish collapses to `tr`; everything else is English.
// Broad hint list so we tolerate every legacy format that reached the engine.
const TURKISH_HINTS = ["tr", "tr-tr", "turkish", "türk", "türkçe", "turkce"];

export function normalizeLanguage(input?: string | null): NormalizedLanguage {
  const raw = (input ?? "").toString().trim().toLowerCase();
  const isTurkish =
    raw.length > 0 && TURKISH_HINTS.some((hint) => raw === hint || raw.includes(hint));

  if (isTurkish) {
    return {
      code: "tr",
      engineLocale: "tr-TR",
      label: "Türkçe (TR)",
      isTurkish: true,
      promptRule:
        "LANGUAGE — HARD REQUIREMENT: Write EVERY word in fluent, natural Turkish. " +
        "This requirement overrides the language of any heading, keyword, title, or reference text you are given. " +
        "If a section title or source appears in another language, translate its meaning into Turkish — never mirror its language. No translation artifacts.",
    };
  }

  return {
    code: "en",
    engineLocale: "en-US",
    label: "English (US)",
    isTurkish: false,
    promptRule:
      "LANGUAGE — HARD REQUIREMENT: Write EVERY word in native American English. " +
      "This requirement overrides the language of any heading, keyword, title, or reference text you are given. " +
      "If a section title or source appears in another language, translate its meaning into English — never mirror its language. Active voice, direct, confident.",
  };
}