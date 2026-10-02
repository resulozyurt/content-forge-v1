import test from "node:test";
import assert from "node:assert/strict";
import { analyzeReadability, extractProseUnits, splitSentences, computeReadabilityForGate } from "./readability";

const sentence = "We help teams make clear plans and save time each day.";
const paragraphs = Array(4).fill("<p>" + sentence + "</p>").join("");

test("TipTap list paragraphs are counted once, including nested lists", () => {
    const html = "<ul><li><p>" + sentence + "</p><ul><li><p>" + sentence + "</p></li></ul></li><li><p>" + sentence + "</p></li><li><p>" + sentence + "</p></li></ul>";
    const report = analyzeReadability(html, "en");
    assert.equal(report.wordCount, 44);
    assert.equal(report.wordCount, analyzeReadability(paragraphs, "en").wordCount);
    assert.equal(report.score, analyzeReadability(paragraphs, "en").score);
    assert.equal(report.insufficientProse, false);
});

test("entities, inline marks, exclusions and short sentences preserve prose", () => {
    const units = extractProseUnits("<h2>Not counted</h2><p>Go.</p><p>Fish &amp; chips cost &#51; pounds.<br>Try <strong>them</strong> today.</p><table><tr><td><p>Not counted</p></td></tr></table><figcaption>Not counted</figcaption>");
    assert.deepEqual(units.map(unit => unit.text), ["Go.", "Fish & chips cost 3 pounds. Try them today."]);
    assert.equal(analyzeReadability("<p></p>", "tr").score, 0);
    assert.equal(analyzeReadability("<p>Go.</p>", "en").insufficientProse, true);
});

test("sentence boundaries handle decimals, abbreviations and Turkish", () => {
    assert.equal(splitSentences("Dr. Smith paid 3.5 pounds. Then he left.").length, 2);
    assert.equal(splitSentences("Bugün hava çok güzel. Şimdi dışarı çıkalım!").length, 2);
});

test("splitting long sentences raises the measured score without a 50 point ceiling", () => {
    const words = Array(8).fill("we help teams build clear plans").join(" ");
    const dense = "<p>" + words + ".</p>";
    const simple = "<p>" + Array(8).fill("We help teams build clear plans.").join(" ") + "</p>";
    const before = analyzeReadability(dense, "en");
    const after = analyzeReadability(simple, "en");
    assert.ok(after.score > before.score);
    assert.ok(after.score > 50);
    assert.equal(after.checks.find(check => check.id === "long-sentences")?.count, 0);
    assert.equal(computeReadabilityForGate(simple, "en")?.score, after.score);
});

test("paragraph layout improvements do not promise a formula score increase", () => {
    const before = analyzeReadability("<p>" + Array(4).fill(sentence).join(" ") + "</p>", "en");
    const after = analyzeReadability(paragraphs, "en");
    assert.equal(before.score, after.score);
    assert.equal(before.checks.find(check => check.id === "long-paragraphs")?.count, 1);
    assert.equal(after.checks.find(check => check.id === "long-paragraphs")?.count, 0);
    assert.equal(before.checks.find(check => check.id === "long-paragraphs")?.affectsScore, false);
});

test("Turkish uses its own formula and short Turkish prose can exceed 50", () => {
    const html = "<p>" + Array(8).fill("Ali bugün eve geldi. Bir bardak su içti.").join(" ") + "</p>";
    const tr = analyzeReadability(html, "Türkçe");
    assert.equal(tr.formula, "atesman");
    assert.ok(tr.score > 50);
    assert.equal(analyzeReadability(html, "English (Australia)").formula, "flesch");
});
