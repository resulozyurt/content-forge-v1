// apps/web/src/lib/content-analysis.ts

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
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const syllables = word.match(/[aeiouy]{1,2}/g);
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

export const analyzeContent = (html: string, brandDomain: string = ""): ContentStats => {
  const text = stripHtml(html);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const charCount = text.replace(/\s/g, '').length;
  
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length > 0 ? sentences.length : 1;
  const sentenceLength = wordCount / sentenceCount;

  const totalSyllables = words.reduce((acc, word) => acc + countSyllables(word), 0);
  
  let fleschScore = 0;
  if (wordCount > 0) {
    fleschScore = 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (totalSyllables / wordCount);
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