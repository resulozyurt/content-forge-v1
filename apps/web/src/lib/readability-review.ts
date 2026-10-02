import { z } from "zod";
import type { ReadabilityReport } from "./readability";

export const readabilityReviewSchema = z.object({
    issue: z.enum(["reading-ease", "long-sentences", "complex-words", "passive-voice", "long-paragraphs", "repetitive-starts", "transition-words"]),
    prompt: z.string().trim().min(1).max(2000),
    paragraphs: z.array(z.string().trim().min(1).max(6000)).min(1).max(8),
}).refine(value => value.paragraphs.join("").length <= 30_000, "Selected text is too long.");

export const readabilityInstructions: Record<string, string> = {
    "reading-ease": "Improve reading ease by lowering syllables per word and average sentence length. Replace needlessly complex words with short everyday equivalents. Split dense sentences. Keep essential technical terms, all facts, names, numbers and links.",
    "long-sentences": "Split long sentences into short complete sentences, usually 12–15 words. Keep every fact and the logical relationship between ideas.",
    "complex-words": "Lower syllables per word using shorter everyday equivalents. Keep essential industry terms, names, numbers and facts. Do not merely change sentence openings or split paragraphs.",
    "passive-voice": "Replace passive voice with active voice when the actor is known. Do not invent an actor. Keep wording short and plain.",
    "long-paragraphs": "Split long paragraphs into 2–3 sentence paragraphs at natural boundaries. Preserve information. This is a layout improvement; do not add transitions or extra text just to change the score.",
    "repetitive-starts": "Vary repeated sentence openings with minimal changes while keeping the prose short and clear.",
    "transition-words": "Add a short, natural connector only where it clarifies the relationship between ideas. Avoid padding or repetitive connectors.",
};

export function assessReadabilityChange(before: ReadabilityReport, after: ReadabilityReport, issue: string, affectsScore: boolean) {
    const delta = after.score - before.score;
    if (after.insufficientProse) return { allowed: false, delta, reason: "The result leaves too little prose to measure reliably. Revise your instructions." };
    if (delta < 0) return { allowed: false, delta, reason: "This result lowers the article score. It has not been applied. Ask for shorter sentences and simpler wording, then try again." };
    if (affectsScore && delta === 0) return { allowed: false, delta, reason: "No measurable score gain. The article is unchanged. Request simpler wording in these passages or review more passages." };
    const a = before.checks.find(check => check.id === issue);
    const b = after.checks.find(check => check.id === issue);
    const issueImproved = !!a && !!b && (issue === "transition-words"
        ? b.count / Math.max(1, b.total) > a.count / Math.max(1, a.total)
        : b.count < a.count);
    if (!affectsScore && !issueImproved && delta === 0) return { allowed: false, delta, reason: "Neither this check nor the score improved. Refine the instructions and try again." };
    return { allowed: true, delta, reason: delta > 0
        ? "The score improves by " + delta + " points across the whole article. Review the text before applying."
        : "This writing check improves; the formula score stays the same. Review the text before applying." };
}
