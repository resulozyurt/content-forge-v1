// apps/web/src/lib/seo-checklist.ts

export interface SeoMeta {
  focusKeyword: string;
  metaTitle: string;
  metaDescription: string;
}

export interface ChecklistResult {
  id: string;
  pass: boolean;
  label: string;
  tip: string;
}

const stripHtml = (html: string): string => {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

export const runSeoChecklist = (html: string, meta: SeoMeta, brandDomain: string = ""): ChecklistResult[] => {
  const checks: ChecklistResult[] = [];
  const text = stripHtml(html);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  const kw = meta.focusKeyword?.toLowerCase().trim() || "";

  // 1. KEYWORD_IN_FIRST_100_WORDS
  const first100Words = words.slice(0, 100).join(" ").toLowerCase();
  checks.push({
    id: "KEYWORD_IN_FIRST_100_WORDS",
    pass: kw.length > 0 && first100Words.includes(kw),
    label: "Keyword in first 100 words",
    tip: "Add your focus keyword in the opening paragraph for stronger relevance signals."
  });

  // 2. KEYWORD_IN_H2
  const h2Matches = html.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];
  const h2Text = h2Matches.map(h => stripHtml(h).toLowerCase()).join(" ");
  checks.push({
    id: "KEYWORD_IN_H2",
    pass: kw.length > 0 && h2Text.includes(kw),
    label: "Keyword in H2 Subheading",
    tip: "Include your keyword in at least one H2 to reinforce topic authority."
  });

  // 3. META_TITLE_LENGTH
  const titleLen = meta.metaTitle?.length || 0;
  checks.push({
    id: "META_TITLE_LENGTH",
    pass: titleLen >= 50 && titleLen <= 60,
    label: "Meta Title Length (50-60 chars)",
    tip: "Keep meta title between 50–60 characters to avoid truncation in SERPs."
  });

  // 4. META_DESCRIPTION_LENGTH
  const descLen = meta.metaDescription?.length || 0;
  checks.push({
    id: "META_DESCRIPTION_LENGTH",
    pass: descLen >= 140 && descLen <= 160,
    label: "Meta Description Length (140-160 chars)",
    tip: "Meta descriptions between 140–160 chars maximize click-through rates."
  });

  // 5. META_TITLE_HAS_KEYWORD
  checks.push({
    id: "META_TITLE_HAS_KEYWORD",
    pass: kw.length > 0 && (meta.metaTitle?.toLowerCase().includes(kw) || false),
    label: "Keyword in Meta Title",
    tip: "Your focus keyword should appear in the meta title."
  });

  // 6. HAS_INTERNAL_LINKS
  let internalLinks = 0;
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[2];
    if (href.startsWith('/') || href.startsWith('#') || (brandDomain && href.includes(brandDomain))) {
      internalLinks++;
    }
  }
  checks.push({
    id: "HAS_INTERNAL_LINKS",
    pass: internalLinks >= 2,
    label: "Multiple Internal Links",
    tip: "Internal links distribute page authority and improve crawlability."
  });

  // 7. HAS_IMAGES
  const imageCount = (html.match(/<img[^>]*>/gi) || []).length;
  checks.push({
    id: "HAS_IMAGES",
    pass: imageCount >= 1,
    label: "Media Included (Images)",
    tip: "Images improve engagement and provide additional ranking opportunities."
  });

  // 8. NO_KEYWORD_STUFFING
  let density = 0;
  if (kw.length > 0 && wordCount > 0) {
    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedKw}\\b`, 'gi');
    const occurrences = (text.match(regex) || []).length;
    density = (occurrences / wordCount) * 100;
  }
  checks.push({
    id: "NO_KEYWORD_STUFFING",
    pass: kw.length > 0 ? density < 3 : false,
    label: "No Keyword Stuffing (<3% density)",
    tip: "Keyword density above 3% risks over-optimization penalties."
  });

  // 9. WORD_COUNT_ADEQUATE
  checks.push({
    id: "WORD_COUNT_ADEQUATE",
    pass: wordCount >= 600,
    label: "Adequate Word Count (600+)",
    tip: "Content under 600 words rarely ranks well for competitive keywords."
  });

  // 10. HAS_QUESTION_HEADINGS
  const hMatches = html.match(/<h[23][^>]*>(.*?)<\/h[23]>/gi) || [];
  const hasQuestion = hMatches.some(h => {
    const innerText = stripHtml(h).trim();
    return innerText.endsWith('?');
  });
  checks.push({
    id: "HAS_QUESTION_HEADINGS",
    pass: hasQuestion,
    label: "Question Formatted Headings",
    tip: "Question-format headings target PAA boxes and featured snippets."
  });

  return checks;
};