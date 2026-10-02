import test from "node:test";
import assert from "node:assert/strict";
import { saveDocument } from "./document-save";

type RecordData = { id: string; userId: string; outputContent: string; inputPayload: unknown; seoMetadata: unknown; updatedAt: Date };
const payload = {
    documentId: "test-document-123", create: true, title: "Article",
    content: '<p>Edited text <a href="https://example.com">link</a></p><p><img src="data:image/png;base64,AAAA" data-image-prompt="A new image"></p>',
    inputData: { config: { language: "tr" }, headings: [] },
    seoMetadata: { metaTitle: "Article", focusKeyword: "test" },
};
function fixture() {
    const records = new Map<string, RecordData>();
    let updates = 0;
    let conflict = false;
    const database = {
        tool: { upsert: async () => ({ id: "tool-1" }) },
        contentJob: {
            findUnique: async ({ where }: { where: { id: string } }) => records.get(where.id) || null,
            create: async ({ data }: { data: Omit<RecordData, "updatedAt"> }) => {
                assert.ok(!records.has(data.id), "must not duplicate documents");
                const record = { ...data, updatedAt: new Date("2026-01-01T00:00:00.000Z") };
                records.set(record.id, record);
                return record;
            },
            updateMany: async ({ where, data }: { where: { id: string; userId: string; updatedAt: Date }; data: Partial<RecordData> }) => {
                const record = records.get(where.id);
                if (conflict || !record || record.userId !== where.userId || +record.updatedAt !== +where.updatedAt) return { count: 0 };
                updates++;
                records.set(where.id, { ...record, ...data });
                return { count: 1 };
            },
        },
    } as unknown as Parameters<typeof saveDocument>[0];
    return { database, records, get updates() { return updates; }, conflict: () => { conflict = true; } };
}

test("create, edit and History read preserve the same document, metadata and image", async () => {
    const f = fixture();
    const first = await saveDocument(f.database, "owner", payload);
    assert.equal(first.status, 200);
    const second = await saveDocument(f.database, "owner", { ...payload, create: false, revision: first.body.revision, content: payload.content + "<p>More changes.</p>" });
    assert.equal(second.status, 200);
    assert.equal(f.records.size, 1);
    const restored = f.records.get(payload.documentId)!;
    assert.match(restored.outputContent, /More changes/);
    assert.match(restored.outputContent, /data-image-prompt/);
    assert.deepEqual((restored.inputPayload as { config: unknown }).config, { language: "tr" });
});

test("lost response retry is idempotent even when JSON object keys are reordered", async () => {
    const f = fixture();
    const first = await saveDocument(f.database, "owner", payload);
    const record = f.records.get(payload.documentId)!;
    record.seoMetadata = { focusKeyword: "test", metaTitle: "Article" };
    const again = await saveDocument(f.database, "owner", payload);
    assert.equal(again.status, 200);
    assert.equal(again.body.revision, first.body.revision);
    assert.equal(f.updates, 0);
    assert.equal(f.records.size, 1);
});

test("another user cannot overwrite or create over an existing document", async () => {
    const f = fixture();
    const first = await saveDocument(f.database, "owner", payload);
    const forbidden = await saveDocument(f.database, "other-user", { ...payload, revision: first.body.revision });
    assert.equal(forbidden.status, 404);
    assert.equal(f.updates, 0);
});

test("stale revisions and concurrent update races do not overwrite newer data", async () => {
    const f = fixture();
    const first = await saveDocument(f.database, "owner", payload);
    const stale = await saveDocument(f.database, "owner", { ...payload, content: "new", revision: "2025-01-01T00:00:00.000Z" });
    assert.equal(stale.status, 409);
    f.conflict();
    const raced = await saveDocument(f.database, "owner", { ...payload, content: "new", revision: first.body.revision });
    assert.equal(raced.status, 409);
    assert.equal(f.records.get(payload.documentId)!.outputContent, payload.content);
});

test("invalid input and deleted documents cannot silently create replacements", async () => {
    const f = fixture();
    assert.equal((await saveDocument(f.database, "owner", {})).status, 400);
    assert.equal((await saveDocument(f.database, "owner", { ...payload, create: false })).status, 404);
    assert.equal(f.records.size, 0);
});
