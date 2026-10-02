import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { Packer } from "docx";
import { createWordDocument, wordFileName, type WordNode } from "./word-export";

const text = (value: string): WordNode => ({ type: "text", text: value });
const p = (...content: WordNode[]): WordNode => ({ type: "paragraph", content });
async function unpack(root: WordNode, loadImage?: Parameters<typeof createWordDocument>[2]) {
    const result = await createWordDocument(root, "Fallback", loadImage);
    const zip = await JSZip.loadAsync(await Packer.toBuffer(result.document));
    return { ...result, zip, xml: await zip.file("word/document.xml")!.async("string") };
}

test("exports edited text, Turkish characters, heading levels and formatted hyperlinks", async () => {
    const { title, xml, zip } = await unpack({ type: "doc", content: [
        { type: "heading", attrs: { level: 1 }, content: [text("İçerik stratejisi")] },
        { type: "heading", attrs: { level: 2 }, content: [text("Güncel bölüm")] },
        p(text("Edited & saved later: "),
            { ...text("kaynak"), marks: [{ type: "bold" }, { type: "italic" }, { type: "link", attrs: { href: "https://example.com/?a=1&b=2" } }] },
            { type: "hardBreak" }, { ...text("çığ öşü"), marks: [{ type: "strike" }] }),
    ] });
    assert.equal(title, "İçerik stratejisi");
    assert.match(xml, /Edited &amp; saved later/);
    assert.match(xml, /çığ öşü/);
    assert.match(xml, /w:pStyle w:val="Heading1"/);
    assert.match(xml, /w:pStyle w:val="Heading2"/);
    assert.match(xml, /w:hyperlink/);
    assert.match(xml, /w:color w:val="2563EB"/);
    assert.match(xml, /w:u w:val="single"/);
    assert.match(xml, /<w:b\/>/);
    assert.match(xml, /<w:i\/>/);
    assert.match(xml, /<w:strike\/>/);
    assert.match(xml, /<w:br\/>/);
    assert.doesNotMatch(xml, /w:b w:val="false"/);
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    assert.match(rels, /https:\/\/example.com\/\?a=1&amp;b=2/);
});

test("keeps nested lists and independently restarted ordered lists", async () => {
    const { xml, zip } = await unpack({ type: "doc", content: [
        { type: "orderedList", attrs: { start: 3 }, content: [
            { type: "listItem", content: [p(text("First item")), p(text("Continuation")),
                { type: "bulletList", content: [{ type: "listItem", content: [p(text("Nested bullet"))] }] }] },
            { type: "listItem", content: [p(text("Second item"))] },
        ] },
        { type: "orderedList", content: [{ type: "listItem", content: [p(text("Restart"))] }] },
    ] });
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    assert.match(numbering, /w:start w:val="3"/);
    assert.match(numbering, /w:numFmt w:val="bullet"/);
    assert.match(numbering, /w:numFmt w:val="decimal"/);
    assert.equal((xml.match(/<w:numPr>/g) ?? []).length, 4);
    assert.match(xml, /Continuation/);
    assert.match(xml, /Nested bullet/);
});

test("creates native tables with headers, merged cells and paragraph content", async () => {
    const cell = (type: string, value: string, attrs = {}): WordNode => ({ type, attrs, content: [p(text(value))] });
    const { xml } = await unpack({ type: "doc", content: [
        { type: "table", content: [
            { type: "tableRow", content: [cell("tableHeader", "Overview", { colspan: 2 })] },
            { type: "tableRow", content: [cell("tableCell", "Merged", { rowspan: 2 }), cell("tableCell", "Row A")] },
            { type: "tableRow", content: [cell("tableCell", "Row B")] },
        ] },
    ] });
    assert.match(xml, /<w:tbl>/);
    assert.match(xml, /<w:tblHeader/);
    assert.match(xml, /w:gridSpan w:val="2"/);
    assert.match(xml, /w:vMerge w:val="restart"/);
    assert.match(xml, /w:vMerge w:val="continue"/);
    assert.match(xml, /Row B/);
});

test("embeds images once fetched, scales to the page and reports unavailable images", async () => {
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
    let loads = 0;
    const image = (src: string): WordNode => ({ type: "image", attrs: { src, alt: "Test image" } });
    const { xml, zip, missingImages } = await unpack({ type: "doc", content: [
        p(image("good"), image("good")), p(image("missing")),
    ] }, async src => {
        loads++;
        if (src === "missing") throw new Error("Unavailable");
        return { data: png, width: 1800, height: 900 };
    });
    assert.equal(loads, 2);
    assert.equal(missingImages, 1);
    assert.match(xml, /Image unavailable: Test image/);
    assert.match(xml, /<w:drawing>/);
    assert.ok(Object.keys(zip.files).some(name => name.startsWith("word/media/") && name.endsWith(".png")));
    const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
    assert.ok(extents.length >= 2);
    for (const extent of extents) assert.ok(Number(extent[1]) <= 9638 * 635);
});

test("keeps link text without exporting unsafe link targets, and preserves code lines", async () => {
    const { xml, zip } = await unpack({ type: "doc", content: [
        p({ ...text("Do not execute"), marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }),
        { type: "blockquote", content: [p(text("Quoted text"))] },
        { type: "codeBlock", content: [text("one\ntwo")] },
    ] });
    assert.match(xml, /Do not execute/);
    assert.match(xml, /Quoted text/);
    assert.match(xml, /Consolas/);
    assert.match(xml, /<w:br\/>/);
    assert.doesNotMatch(await zip.file("word/_rels/document.xml.rels")!.async("string"), /javascript:/);
});

test("uses a readable, safe filename and supports an empty document", async () => {
    assert.equal(wordFileName("  İçerik: büyüme / rehberi?  "), "İçerik büyüme rehberi.docx");
    assert.equal(wordFileName("CON"), "Article.docx");
    assert.equal(wordFileName(" ... "), "Article.docx");
    const { title, xml } = await unpack({ type: "doc", content: [] });
    assert.equal(title, "Fallback");
    assert.match(xml, /<w:p/);
});
