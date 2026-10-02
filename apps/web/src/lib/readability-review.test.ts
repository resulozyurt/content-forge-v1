import test from "node:test";
import assert from "node:assert/strict";
import { analyzeReadability, scoreImprovementCheck } from "./readability";
import { assessReadabilityChange, readabilityReviewSchema } from "./readability-review";

const sentence = "We help teams build clear plans.";
const dense = analyzeReadability("<p>" + Array(16).fill(sentence.replace(".", "")).join(" ") + ".</p>", "en");
const simple = analyzeReadability("<p>" + Array(8).fill(sentence).join(" ") + "</p>", "en");
test("review requires a real measured gain for score-affecting fixes", () => {
    assert.equal(assessReadabilityChange(dense, simple, "reading-ease", true).allowed, true);
    assert.equal(assessReadabilityChange(dense, dense, "reading-ease", true).allowed, false);
    assert.equal(assessReadabilityChange(simple, dense, "reading-ease", true).allowed, false);
    assert.equal(assessReadabilityChange(dense, analyzeReadability("<p>Hi.</p>", "en"), "reading-ease", true).allowed, false);
});
test("a layout fix can resolve paragraphs without granting formula bonus points", () => {
    const split = analyzeReadability(Array(8).fill("<p>" + sentence + "</p>").join(""), "en");
    const result = assessReadabilityChange(simple, split, "long-paragraphs", false);
    assert.equal(result.allowed, true);
    assert.equal(result.delta, 0);
    assert.equal(assessReadabilityChange(simple, simple, "long-paragraphs", false).allowed, false);
});
test("formula suggestions exist for low scores independently of complex-word thresholds", () => {
    assert.ok(scoreImprovementCheck(dense, "blog_post", "en")?.items.length);
    assert.equal(dense.checks.find(check => check.id === "complex-words")?.count, 0);
    assert.equal(scoreImprovementCheck(simple, "blog_post", "en"), null);
    assert.ok(dense.avgSyllablesPerWord > 0);
});
test("review requests bound prompts, batches and paragraph sizes", () => {
    const input = { issue: "reading-ease", prompt: "Keep all facts.", paragraphs: ["<p>Original prose.</p>"] };
    assert.equal(readabilityReviewSchema.safeParse(input).success, true);
    for (const patch of [{ prompt: "" }, { prompt: "x".repeat(2001) }, { issue: "anything" }, { paragraphs: [] },
        { paragraphs: Array(9).fill("<p>Text</p>") }, { paragraphs: ["x".repeat(6001)] },
        { paragraphs: Array(8).fill("x".repeat(5000)) }]) {
        assert.equal(readabilityReviewSchema.safeParse({ ...input, ...patch }).success, false);
    }
});
