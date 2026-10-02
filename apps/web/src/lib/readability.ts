import { Parser } from "htmlparser2";

// apps/web/src/lib/readability.ts
//
// READABILITY ENGINE (v3) — single source of truth.
//
// Before v3 the Flesch computation lived in TWO places with drifting logic
// and thresholds: lib/content-analysis.ts (panel, min implied 60) and
// api/v2/generator/editor/route.ts (QA gate, min 55). Both are now thin
// consumers of this module.
//
// What this module adds on top of the old v2 prose-only Flesch:
//   1. TURKISH SUPPORT — Ateşman formula (the Turkish adaptation of Flesch:
//      198.825 − 40.175·(syllables/word) − 2.610·(words/sentence)) with a
//      proper Turkish syllable counter (vowel count is exact for Turkish).
//      The panel previously applied English Flesch coefficients to Turkish
//      prose (misleading score) and the editor gate skipped TR entirely.
//   2. ACTIONABLE CHECKS — deterministic Yoast/Hemingway-style diagnostics
//      (long sentences, complex words, passive voice, long paragraphs,
//      repetitive sentence starts, transition words). Each check carries the
//      offending sentence texts so the UI can highlight them in TipTap and
//      offer one-click AI fixes. Deterministic on purpose: recomputes free
//      and instantly on every keystroke — the LLM is only used to FIX, never
//      to DETECT.
//   3. WORST SENTENCES — the top-N longest sentences, verbatim, so the
//      editor-agent correction prompt can name exactly what to rewrite
//      instead of only citing an average.
//
// Prose extraction rules are identical to v2 (and MUST stay in sync with the
// writer/editor contract): score <p>/<li> text only; tables, figcaptions,
// <cite> and headings are excluded; each <li> is its own sentence boundary;
// short sentences are included, including single-word list items.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReadabilityFormula = "flesch" | "atesman";

export type CheckStatus = "good" | "warning" | "problem";

export interface ReadabilityCheck {
  /** Stable id: long-sentences | complex-words | passive-voice |
   *  long-paragraphs | repetitive-starts | transition-words */
  id: string;
  /** Short UI label (localized to the content language). */
  label: string;
  status: CheckStatus;
  /** Offending count (for transition-words: sentences WITH a transition). */
  count: number;
  /** Denominator (sentences or paragraphs, depending on the check). */
  total: number;
  /** Human-readable finding, localized to the content language. */
  message: string;
  /** Concrete fix suggestion shown under the finding. */
  suggestion: string;
  /** Offending unit texts (sentences or paragraph snippets) for highlighting
   *  and targeted AI rewrite. Capped to keep payloads small. */
  items: string[];
  /** Whether the check directly measures an input to the readability formula. */
  affectsScore: boolean;
}

export interface WorstSentence {
  text: string;
  words: number;
}

export interface ReadabilityReport {
  formula: ReadabilityFormula;
  /** 0–100. Flesch Reading Ease (EN) or Ateşman Okunabilirlik (TR). */
  score: number;
  label: string;
  /** Tailwind bg-* class, same semantics the panel already used. */
  color: string;
  avgSentenceLength: number;
  sentenceCount: number;
  /** Prose words only (matches what the score is computed over). */
  wordCount: number;
  /** True when there was too little prose to score reliably (<40 words). */
  insufficientProse: boolean;
  checks: ReadabilityCheck[];
  worstSentences: WorstSentence[];
}

// ---------------------------------------------------------------------------
// Prose extraction (shared by the editor and generation gate)
// ---------------------------------------------------------------------------

interface ProseUnit {
  /** Plain text of one <p> or <li> block. */
  text: string;
  /** "p" | "li" — long-paragraph check only applies to <p>. */
  tag: string;
}

export const extractProseUnits = (html: string): ProseUnit[] => {
  const units: ProseUnit[] = [];
  const excludedTags = new Set(["style", "script", "table", "figcaption", "cite", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);
  const stack: { tag: string; text: string; excluded: boolean }[] = [];
  const current = () => [...stack].reverse().find(node => node.tag === "p" || node.tag === "li");
  const flush = (node: ReturnType<typeof current>) => {
    if (!node || node.excluded) return;
    const text = node.text.replace(/\s+/g, " ").trim();
    // Short sentences still contribute: discarding them biases scores downward.
    if (wordsOf(text).length > 0) units.push({ text, tag: node.tag as "p" | "li" });
    node.text = "";
  };
  const parser = new Parser({
    onopentag(tag) {
      const excluded = !!stack.at(-1)?.excluded || excludedTags.has(tag);
      if (tag === "p" || tag === "li") flush(current());
      if (tag === "br" && !excluded) {
        const node = current();
        if (node) node.text += " ";
      }
      stack.push({ tag, text: "", excluded });
    },
    ontext(text) {
      if (stack.at(-1)?.excluded) return;
      const node = current();
      if (node) node.text += text;
    },
    onclosetag() {
      const node = stack.pop();
      if (node?.tag === "p" || node?.tag === "li") flush(node);
    },
  }, { decodeEntities: true });
  parser.end(html);
  return units;
};

export const splitSentences = (unit: string): string[] => {
  // Protect common abbreviations; decimals are handled by the Unicode segmenter.
  const protectedText = unit.replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|vb|örn|ör|bkz)\./gi, value => value.replace(".", "\uE000"));
  return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(protectedText)]
    .map(part => part.segment.replace(/\uE000/g, ".").trim()).filter(Boolean);
};

const wordsOf = (text: string): string[] =>
  text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];

// ---------------------------------------------------------------------------
// Syllable counting
// ---------------------------------------------------------------------------

const countSyllablesEn = (word: string): number => {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length === 0) return 1;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  word = word.replace(/^y/, "");
  const syllables = word.match(/[aeiouy]{1,2}/g);
  return syllables ? syllables.length : 1;
};

// Turkish is phonetic: syllable count === vowel count. Exact, not heuristic.
const countSyllablesTr = (word: string): number => {
  const vowels = word.toLowerCase().match(/[aeıioöuü]/g);
  return vowels ? vowels.length : 1;
};

// ---------------------------------------------------------------------------
// Formulas + labels
// ---------------------------------------------------------------------------

const fleschEn = (avgSentenceLen: number, syllablesPerWord: number): number =>
  206.835 - 1.015 * avgSentenceLen - 84.6 * syllablesPerWord;

// Ateşman (1997) — Turkish adaptation of Flesch Reading Ease.
const atesmanTr = (avgSentenceLen: number, syllablesPerWord: number): number =>
  198.825 - 40.175 * syllablesPerWord - 2.61 * avgSentenceLen;

const labelFor = (
  score: number,
  isTurkish: boolean
): { label: string; color: string } => {
  if (isTurkish) {
    // Ateşman bands: 90+ çok kolay · 70–89 kolay · 50–69 orta · 30–49 zor · <30 çok zor
    if (score >= 90) return { label: "Çok Kolay", color: "bg-green-500" };
    if (score >= 70) return { label: "Kolay", color: "bg-green-400" };
    if (score >= 50) return { label: "Orta", color: "bg-yellow-500" };
    if (score >= 30) return { label: "Zor", color: "bg-orange-500" };
    return { label: "Çok Zor", color: "bg-red-500" };
  }
  if (score >= 90) return { label: "Very Easy", color: "bg-green-500" };
  if (score >= 70) return { label: "Easy", color: "bg-green-400" };
  if (score >= 60) return { label: "Standard", color: "bg-yellow-500" };
  if (score >= 50) return { label: "Fairly Difficult", color: "bg-orange-500" };
  return { label: "Difficult", color: "bg-red-500" };
};

// ---------------------------------------------------------------------------
// Check vocabularies
// ---------------------------------------------------------------------------

// Long-sentence limit. Turkish words carry more morphology per word, so the
// word-count limit is slightly higher before a sentence "reads long".
const LONG_SENTENCE_WORDS_EN = 20;
const LONG_SENTENCE_WORDS_TR = 22;

// Complex word = 4+ syllables (EN) / 6+ syllables (TR — agglutination makes
// 4–5 syllable words completely ordinary: "yapabilirsiniz" is not complex).
const COMPLEX_SYLLABLES_EN = 4;
const COMPLEX_SYLLABLES_TR = 6;

// Known plain-language swaps surfaced as suggestions (EN only — mirrors the
// writer prompt's own swap list so UI advice matches generation rules).
const EN_SWAPS: Record<string, string> = {
  utilize: "use",
  facilitate: "help",
  implement: "set up",
  demonstrate: "show",
  approximately: "about",
  remediate: "fix",
  methodology: "method",
  additionally: "also",
  consequently: "so",
  subsequently: "then",
};

const TRANSITIONS_EN = [
  "however", "therefore", "meanwhile", "instead", "because", "but", "so",
  "first", "second", "third", "next", "then", "finally", "for example",
  "in fact", "as a result", "on the other hand", "that means", "still",
  "yet", "also", "beyond that", "in short", "here's why", "the result",
];

const TRANSITIONS_TR = [
  "ancak", "fakat", "çünkü", "bu yüzden", "bu nedenle", "örneğin",
  "öncelikle", "ardından", "sonrasında", "son olarak", "ayrıca", "üstelik",
  "buna karşın", "öte yandan", "kısacası", "sonuç olarak", "yani",
  "böylece", "ama", "önce", "sonra", "ilk olarak", "aslında", "yine de",
];

// EN passive voice heuristic: to-be + past participle. Deliberately loose —
// it's a nudge, not a grammar checker. TR passive detection is too noisy with
// regex (-ıl/-il collides with too many stems), so the check is EN-only.
const PASSIVE_EN =
  /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en|wn|ne)\b/i;

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

const MIN_PROSE_WORDS = 40;
const MAX_ITEMS_PER_CHECK = 8;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function analyzeReadability(
  html: string,
  language?: string | null
): ReadabilityReport {
  const raw = (language ?? "").toString().trim().toLowerCase();
  const isTurkish =
    raw.length > 0 &&
    ["tr", "tr-tr", "turkish", "türk", "türkçe", "turkce"].some(
      (h) => raw === h || raw.startsWith(h + "-") || raw.startsWith(h + " ")
    );

  const units = extractProseUnits(html);

  // Flatten to sentences while keeping paragraph grouping for the
  // long-paragraph check.
  const allSentences: string[] = [];
  let proseWordCount = 0;
  let totalSyllables = 0;
  const countSyllables = isTurkish ? countSyllablesTr : countSyllablesEn;

  for (const unit of units) {
    const sentences = splitSentences(unit.text);
    // A unit with no terminal punctuation still counts as one sentence.
    if (sentences.length === 0) allSentences.push(unit.text);
    else allSentences.push(...sentences);

    for (const w of wordsOf(unit.text)) {
      proseWordCount++;
      totalSyllables += countSyllables(w);
    }
  }

  const sentenceCount = Math.max(1, allSentences.length);
  const safeWords = Math.max(1, proseWordCount);
  const avgSentenceLength = safeWords / sentenceCount;
  const syllablesPerWord = totalSyllables / safeWords;

  const rawScore = isTurkish
    ? atesmanTr(avgSentenceLength, syllablesPerWord)
    : fleschEn(avgSentenceLength, syllablesPerWord);
  const score = proseWordCount < MIN_PROSE_WORDS ? 0 : clamp(Math.round(rawScore), 0, 100);
  const { label, color } = labelFor(score, isTurkish);

  const insufficientProse = proseWordCount < MIN_PROSE_WORDS;

  // ── Worst sentences (longest first) ──────────────────────────────────────
  const worstSentences: WorstSentence[] = allSentences
    .map((text) => ({ text, words: wordsOf(text).length }))
    .sort((a, b) => b.words - a.words)
    .slice(0, 3)
    .filter((s) => s.words > (isTurkish ? LONG_SENTENCE_WORDS_TR : LONG_SENTENCE_WORDS_EN));

  // ── Checks ────────────────────────────────────────────────────────────────
  const checks: ReadabilityCheck[] = [];
  const t = (en: string, tr: string) => (isTurkish ? tr : en);

  if (!insufficientProse) {
    // 1. Long sentences
    const longLimit = isTurkish ? LONG_SENTENCE_WORDS_TR : LONG_SENTENCE_WORDS_EN;
    const longOnes = allSentences.filter((s) => wordsOf(s).length > longLimit);
    const longPct = longOnes.length / sentenceCount;
    checks.push({
      id: "long-sentences",
      label: t("Long sentences", "Uzun cümleler"),
      status: longPct > 0.25 ? "problem" : longPct > 0.1 ? "warning" : "good",
      count: longOnes.length,
      total: sentenceCount,
      message: t(
        `${longOnes.length} of ${sentenceCount} sentences exceed ${longLimit} words (target: under 10%).`,
        `${sentenceCount} cümlenin ${longOnes.length} tanesi ${longLimit} kelimeden uzun (hedef: %10'un altı).`
      ),
      suggestion: t(
        "Split each flagged sentence in two at the comma or conjunction. One idea per sentence.",
        "İşaretli cümleleri virgül veya bağlaçtan ikiye bölün. Her cümlede tek fikir."
      ),
      items: longOnes.slice(0, MAX_ITEMS_PER_CHECK),
      affectsScore: true,
    });

    // 2. Complex words
    const complexLimit = isTurkish ? COMPLEX_SYLLABLES_TR : COMPLEX_SYLLABLES_EN;
    const complexWords: string[] = [];
    const sentencesWithComplex = new Set<string>();
    for (const s of allSentences) {
      for (const w of wordsOf(s)) {
        const bare = w.replace(/[^\p{L}]/gu, "");
        if (bare.length > 0 && countSyllables(bare) >= complexLimit) {
          complexWords.push(bare.toLowerCase());
          sentencesWithComplex.add(s);
        }
      }
    }
    const complexPct = complexWords.length / safeWords;
    const knownSwaps = Array.from(new Set(complexWords))
      .filter((w) => !isTurkish && EN_SWAPS[w])
      .map((w) => `"${w}" → "${EN_SWAPS[w]}"`)
      .slice(0, 5);
    checks.push({
      id: "complex-words",
      label: t("Complex words", "Karmaşık kelimeler"),
      status: complexPct > 0.1 ? "problem" : complexPct > 0.05 ? "warning" : "good",
      count: complexWords.length,
      total: safeWords,
      message: t(
        `${complexWords.length} words have ${complexLimit}+ syllables (${(complexPct * 100).toFixed(1)}% — target: under 5%).`,
        `${complexWords.length} kelime ${complexLimit}+ heceli (%${(complexPct * 100).toFixed(1)} — hedef: %5'in altı).`
      ),
      suggestion:
        knownSwaps.length > 0
          ? t(`Swap: ${knownSwaps.join(", ")}.`, `Değiştirin: ${knownSwaps.join(", ")}.`)
          : t(
              "Prefer 1–2 syllable everyday words; keep only the terms the reader actually searches for.",
              "1–2 heceli gündelik kelimeleri tercih edin; yalnızca okuyucunun aradığı terimleri koruyun."
            ),
      items: Array.from(sentencesWithComplex).slice(0, MAX_ITEMS_PER_CHECK),
      affectsScore: true,
    });

    // 3. Passive voice (EN only)
    if (!isTurkish) {
      const passiveOnes = allSentences.filter((s) => PASSIVE_EN.test(s));
      const passivePct = passiveOnes.length / sentenceCount;
      checks.push({
        id: "passive-voice",
        label: "Passive voice",
        status: passivePct > 0.15 ? "problem" : passivePct > 0.08 ? "warning" : "good",
        count: passiveOnes.length,
        total: sentenceCount,
        message: `${passiveOnes.length} of ${sentenceCount} sentences look passive (target: under 8%).`,
        suggestion:
          'Name the actor: "Teams lose 30% of stock" — not "30% of stock is lost by teams".',
        items: passiveOnes.slice(0, MAX_ITEMS_PER_CHECK),
        affectsScore: false,
      });
    }

    // 4. Long paragraphs (only <p> units; writer contract is max 2 sentences)
    const pUnits = units.filter((u) => u.tag === "p");
    const longParas = pUnits.filter(
      (u) => splitSentences(u.text).length > 3 || wordsOf(u.text).length > 90
    );
    const paraTotal = Math.max(1, pUnits.length);
    const paraPct = longParas.length / paraTotal;
    checks.push({
      id: "long-paragraphs",
      label: t("Long paragraphs", "Uzun paragraflar"),
      status: paraPct > 0.2 ? "problem" : longParas.length > 0 ? "warning" : "good",
      count: longParas.length,
      total: pUnits.length,
      message: t(
        `${longParas.length} paragraphs run over 3 sentences or 90 words.`,
        `${longParas.length} paragraf 3 cümleyi veya 90 kelimeyi aşıyor.`
      ),
      suggestion: t(
        "Break each into 2–3 sentence paragraphs — scannability drives readability on the web.",
        "Her birini 2–3 cümlelik paragraflara bölün — web'de taranabilirlik okunabilirliği belirler."
      ),
      items: longParas.slice(0, MAX_ITEMS_PER_CHECK).map((u) => u.text),
      affectsScore: false,
    });

    // 5. Repetitive sentence starts (3+ consecutive with same first word)
    const repeatedRuns: string[] = [];
    let runStart = 0;
    const firstWord = (s: string) =>
      (wordsOf(s)[0] || "").toLowerCase().replace(/[^\p{L}0-9]/gu, "");
    for (let i = 1; i <= allSentences.length; i++) {
      const ended =
        i === allSentences.length ||
        firstWord(allSentences[i]) !== firstWord(allSentences[runStart]) ||
        firstWord(allSentences[i]).length === 0;
      if (ended) {
        if (i - runStart >= 3 && firstWord(allSentences[runStart]).length > 0) {
          repeatedRuns.push(...allSentences.slice(runStart, i));
        }
        runStart = i;
      }
    }
    checks.push({
      id: "repetitive-starts",
      label: t("Repetitive openings", "Tekrarlayan cümle başları"),
      status: repeatedRuns.length >= 6 ? "problem" : repeatedRuns.length > 0 ? "warning" : "good",
      count: repeatedRuns.length,
      total: sentenceCount,
      message: t(
        repeatedRuns.length > 0
          ? `${repeatedRuns.length} consecutive sentences open with the same word.`
          : "No monotone sentence openings detected.",
        repeatedRuns.length > 0
          ? `${repeatedRuns.length} ardışık cümle aynı kelimeyle başlıyor.`
          : "Tekdüze cümle başlangıcı tespit edilmedi."
      ),
      suggestion: t(
        "Vary the opening: start with the object, a number, or a question.",
        "Başlangıcı çeşitlendirin: nesneyle, bir sayıyla veya soruyla başlayın."
      ),
      items: repeatedRuns.slice(0, MAX_ITEMS_PER_CHECK),
      affectsScore: false,
    });

    // 6. Transition words (higher is better — count = sentences WITH one)
    const transitions = isTurkish ? TRANSITIONS_TR : TRANSITIONS_EN;
    const hasTransition = (s: string) => {
      const low = ` ${s.toLowerCase()} `;
      return transitions.some((tr) => low.includes(` ${tr} `) || low.startsWith(` ${tr},`) || low.includes(` ${tr},`));
    };
    const withTransition = allSentences.filter(hasTransition);
    const transPct = withTransition.length / sentenceCount;

    // Candidates for the one-click "add transitions" fix: paragraph-opening
    // sentences (except the very first paragraph) that lack a transition.
    // Paragraph openings are where connectors do the most work — they stitch
    // the new paragraph to the previous one. The UI sends each candidate with
    // its preceding text so the model picks a connector that actually fits.
    const transitionCandidates: string[] = [];
    if (transPct < 0.3) {
      const pOnly = units.filter((u) => u.tag === "p");
      for (let i = 1; i < pOnly.length; i++) {
        const first = splitSentences(pOnly[i].text)[0] || pOnly[i].text;
        if (!hasTransition(first) && wordsOf(first).length >= 5) {
          transitionCandidates.push(first);
        }
        if (transitionCandidates.length >= MAX_ITEMS_PER_CHECK) break;
      }
    }

    checks.push({
      id: "transition-words",
      label: t("Transition words", "Geçiş kelimeleri"),
      status: transPct < 0.2 ? "problem" : transPct < 0.3 ? "warning" : "good",
      count: withTransition.length,
      total: sentenceCount,
      message: t(
        `${(transPct * 100).toFixed(0)}% of sentences use a transition word (target: 30%+).`,
        `Cümlelerin %${(transPct * 100).toFixed(0)}'i geçiş kelimesi içeriyor (hedef: %30+).`
      ),
      suggestion: t(
        'Connect ideas: "however", "for example", "that means", "as a result". The AI fix adds connectors to paragraph openings.',
        '"Ancak", "örneğin", "bu yüzden", "sonuç olarak" gibi bağlantılar ekleyin. AI düzeltmesi paragraf başlarına bağlaç ekler.'
      ),
      items: transitionCandidates,
      affectsScore: false,
    });
  }

  return {
    formula: isTurkish ? "atesman" : "flesch",
    score,
    label,
    color,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    sentenceCount: allSentences.length,
    wordCount: proseWordCount,
    insufficientProse,
    checks,
    worstSentences,
  };
}

// ---------------------------------------------------------------------------
// Pipeline gate helper (Faz 2) — consumed by api/v2/generator/editor.
// Returns null when there is too little prose to judge reliably.
// ---------------------------------------------------------------------------

export interface ReadabilityGateResult {
  score: number;
  formula: ReadabilityFormula;
  avgSentenceLen: number;
  wordCount: number;
  worstSentences: WorstSentence[];
}

export function computeReadabilityForGate(
  html: string,
  language?: string | null
): ReadabilityGateResult | null {
  const report = analyzeReadability(html, language);
  if (report.insufficientProse) return null;
  return {
    score: report.score,
    formula: report.formula,
    avgSentenceLen: report.avgSentenceLength,
    wordCount: report.wordCount,
    worstSentences: report.worstSentences,
  };
}

// Content-type aware minimum score. Blog posts are top-of-funnel and must
// read easiest; technical/service formats may legitimately carry denser prose.
// Ateşman distributes lower than Flesch for equivalent difficulty, so Turkish
// minimums sit ~5 points below the English ones.
export function readabilityMinScore(
  contentType?: string | null,
  language?: string | null
): number {
  const raw = (language ?? "").toString().toLowerCase();
  const isTurkish = /^(tr(?:$|[- ])|türk|turk)/.test(raw);
  switch (contentType) {
    case "blog_post":
      return isTurkish ? 55 : 60;
    case "guide":
    case "pillar_page":
      return isTurkish ? 50 : 55;
    case "product_review":
    case "service_page":
      return isTurkish ? 45 : 50;
    default:
      return isTurkish ? 50 : 55;
  }
}