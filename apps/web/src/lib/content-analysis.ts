// apps/web/src/lib/content-analysis.ts
//
// READABILITY FIX (v2): the previous analyzer computed Flesch over the ENTIRE
// stripped HTML — headings, table cells, figcaptions, Key-Takeaways card
// labels and "By the Numbers" callouts were all glued into the text stream.
// Most of those fragments carry no terminal punctuation, so they merged with
// the following text into giant pseudo-sentences and artificially inflated
// avg-sentence-length (and tanked the Flesch score) no matter how well the
// writer agent performed.
//
// v2 measures readability over PROSE UNITS ONLY:
//   - text inside <p> and <li> blocks (what a human actually reads as prose)
//   - tables, figcaptions, <cite> and headings are excluded from readability
//     (they still count toward wordCount/charCount/readingTime, matching the
//     panel's "Words" stat)
//   - each <li> is its own sentence boundary — bullets never merge with the
//     next paragraph anymore
//   - sentence split protects decimals ("3.5") and only breaks before a
//     capital/digit, mirroring the editor agent's segmentation

export interface ContentStats {
  readingTime: number;
  wordCount: number;
  charCount: number;
  sentenceLength: number;
  fleschScore: number;
  fleschLabel: string;
  fleschColor: string;
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

const countSyllables = (word: string): number => {
  word = word.toLowerCase().replace(/[^a-zçğıöşü]/g, '');
  if (word.length === 0) return 1;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const syllables = word.match(/[aeiouyçğıöşü]{1,2}/g);
  return syllables ? syllables.length : 1;
};

const stripHtml = (html: string): string => {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// ---------------------------------------------------------------------------
// Prose extraction for readability scoring.
// Returns an array of prose "units" — each unit is the plain text of one
// <p> or <li> block. Tables, figcaptions and cites are removed BEFORE
// extraction so their cell/caption text never leaks into a prose unit.
// ---------------------------------------------------------------------------
const extractProseUnits = (html: string): string[] => {
  const cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ')
    .replace(/<cite[\s\S]*?<\/cite>/gi, ' ');

  const units: string[] = [];
  const blockRegex = /<(p|li)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(cleaned)) !== null) {
    const inner = match[2];
    // Skip container <li> that wraps <p> blocks — the inner <p> is matched
    // separately; counting both would double the text.
    if (/<p[\s>]/i.test(inner)) continue;

    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // Skip labels/badges ("✦ Key Takeaways · 7 min read", nav chips, etc.) —
    // fragments under 4 words are UI furniture, not prose.
    if (text.split(/\s+/).filter(Boolean).length < 4) continue;

    units.push(text);
  }

  return units;
};

// Split one prose unit into sentences. Decimal-safe: only breaks after
// terminal punctuation followed by whitespace + capital/digit/quote.
const splitSentences = (unit: string): string[] => {
  return unit
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9ÇĞİÖŞÜ"'"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

export const analyzeContent = (html: string, brandDomain: string = ""): ContentStats => {
  const text = stripHtml(html);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const charCount = text.replace(/\s/g, '').length;

  // ── Readability: prose units only ────────────────────────────────────────
  const proseUnits = extractProseUnits(html);

  let proseWords: string[] = [];
  let sentenceCount = 0;

  if (proseUnits.length > 0) {
    for (const unit of proseUnits) {
      const sentences = splitSentences(unit);
      sentenceCount += Math.max(1, sentences.length);
      proseWords = proseWords.concat(unit.split(/\s+/).filter((w) => w.length > 0));
    }
  } else {
    // Fallback (plain text / no p-li markup): old whole-text behavior.
    proseWords = words;
    sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  }

  sentenceCount = Math.max(1, sentenceCount);
  const proseWordCount = Math.max(1, proseWords.length);
  const sentenceLength = proseWordCount / sentenceCount;

  const totalSyllables = proseWords.reduce((acc, word) => acc + countSyllables(word), 0);

  let fleschScore = 0;
  if (proseWordCount > 0) {
    fleschScore = 206.835 - 1.015 * sentenceLength - 84.6 * (totalSyllables / proseWordCount);
  }
  fleschScore = Math.max(0, Math.min(100, Math.round(fleschScore)));

  let fleschLabel = "Difficult";
  let fleschColor = "bg-red-500";
  if (fleschScore >= 90) { fleschLabel = "Very Easy"; fleschColor = "bg-green-500"; }
  else if (fleschScore >= 70) { fleschLabel = "Easy"; fleschColor = "bg-green-400"; }
  else if (fleschScore >= 60) { fleschLabel = "Standard"; fleschColor = "bg-yellow-500"; }
  else if (fleschScore >= 50) { fleschLabel = "Fairly Difficult"; fleschColor = "bg-orange-500"; }

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
    readingTime, wordCount, charCount, sentenceLength,
    fleschScore, fleschLabel, fleschColor,
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