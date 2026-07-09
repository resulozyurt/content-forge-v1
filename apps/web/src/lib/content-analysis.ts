// apps/web/src/lib/content-analysis.ts
//
// READABILITY (v3): all readability math now lives in lib/readability.ts —
// the single source of truth shared with the api/v2/generator/editor QA gate.
// This module keeps the panel-facing ContentStats shape (word/char counts,
// headings, links, media) and delegates score/label/color to the engine.
//
// v3 also adds LANGUAGE AWARENESS: pass the article language and Turkish
// content is scored with the Ateşman formula instead of English Flesch
// coefficients (which produced a misleading score for TR prose).
//
// History (v2, preserved inside lib/readability.ts): score PROSE UNITS ONLY —
// <p>/<li> text; tables, figcaptions, <cite> and headings excluded; each <li>
// its own sentence boundary; decimal-safe sentence split.

import { analyzeReadability } from "./readability";

export interface ContentStats {
  readingTime: number;
  wordCount: number;
  charCount: number;
  sentenceLength: number;
  fleschScore: number;
  fleschLabel: string;
  fleschColor: string;
  /** "flesch" (EN) or "atesman" (TR) — lets the UI name the right formula. */
  readabilityFormula: "flesch" | "atesman";
  h2Count: number;
  h3Count: number;
  internalLinks: number;
  externalLinks: number;
  nofollowLinks: number;
  imageCount: number;
  tableCount: number;
  listCount: number;
}

export interface KeywordDensityResult {
  keyword: string;
  occurrences: number;
  density: number;
  densityLabel: string;
  densityStatus: 'optimal' | 'low' | 'high';
  inFirstParagraph: boolean;
  inAnyHeading: boolean;
}

const stripHtml = (html: string): string => {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const analyzeContent = (
  html: string,
  brandDomain: string = "",
  language?: string | null
): ContentStats => {
  const text = stripHtml(html);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const charCount = text.replace(/\s/g, '').length;

  // ── Readability: delegated to the shared engine (prose-only) ─────────────
  const report = analyzeReadability(html, language);

  const readingTime = Math.ceil(wordCount / 200);

  const h2Count = (html.match(/<h2[^>]*>/gi) || []).length;
  const h3Count = (html.match(/<h3[^>]*>/gi) || []).length;
  const imageCount = (html.match(/<img[^>]*>/gi) || []).length;
  const tableCount = (html.match(/<table[^>]*>/gi) || []).length;
  const listCount = (html.match(/<(ul|ol)[^>]*>/gi) || []).length;

  let internalLinks = 0;
  let externalLinks = 0;
  let nofollowLinks = 0;

  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const fullTag = match[0].toLowerCase();
    const href = match[2];

    if (fullTag.includes('rel="nofollow"') || fullTag.includes("rel='nofollow'")) {
      nofollowLinks++;
    }

    if (href.startsWith('/') || href.startsWith('#') || (brandDomain && href.includes(brandDomain))) {
      internalLinks++;
    } else if (href.startsWith('http')) {
      externalLinks++;
    }
  }

  return {
    readingTime, wordCount, charCount,
    sentenceLength: report.avgSentenceLength,
    fleschScore: report.score,
    fleschLabel: report.label,
    fleschColor: report.color,
    readabilityFormula: report.formula,
    h2Count, h3Count, internalLinks, externalLinks, nofollowLinks,
    imageCount, tableCount, listCount
  };
};

export const analyzeKeywordDensity = (html: string, keywords: string[]): KeywordDensityResult[] => {
  const text = stripHtml(html).toLowerCase();
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const totalWords = words.length || 1;

  const firstParagraphMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  const firstParagraphText = firstParagraphMatch ? stripHtml(firstParagraphMatch[1]).toLowerCase() : "";

  const headingMatches = html.match(/<h[23][^>]*>(.*?)<\/h[23]>/gi) || [];
  const allHeadingsText = headingMatches.map(h => stripHtml(h).toLowerCase()).join(" ");

  const uniqueKeywords = Array.from(new Set(keywords.filter(k => k.trim().length > 0)));

  const results = uniqueKeywords.map(keyword => {
    const kwLower = keyword.toLowerCase();

    // Güvenli regex escape işlemi
    const escapedKw = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedKw}\\b`, 'gi');
    const occurrences = (text.match(regex) || []).length;

    const density = (occurrences / totalWords) * 100;

    let densityStatus: 'optimal' | 'low' | 'high' = 'low';
    if (density >= 0.5 && density <= 2.5) densityStatus = 'optimal';
    else if (density > 2.5) densityStatus = 'high';

    return {
      keyword,
      occurrences,
      density,
      densityLabel: `${density.toFixed(2)}%`,
      densityStatus,
      inFirstParagraph: firstParagraphText.includes(kwLower),
      inAnyHeading: allHeadingsText.includes(kwLower)
    };
  });

  return results.sort((a, b) => b.density - a.density).slice(0, 10);
};