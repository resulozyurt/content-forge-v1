import type { prisma as database } from "@contentforge/database";
import { z } from "zod";

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
    if (value !== null && typeof value === "object") {
        const data = value as Record<string, unknown>;
        return "{" + Object.keys(data).sort().map(key => JSON.stringify(key) + ":" + stableJson(data[key])).join(",") + "}";
    }
    return JSON.stringify(value) ?? "null";
}
function result(body: { message?: string; documentId?: string; revision?: string }, options?: { status: number }) {
    return { status: options?.status ?? 200, body };
}
const payloadSchema = z.object({
    documentId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
    create: z.boolean().default(false),
    revision: z.string().datetime().optional(),
    title: z.string().max(500),
    content: z.string().max(20_000_000),
    inputData: z.record(z.string(), z.unknown()),
    seoMetadata: z.record(z.string(), z.unknown()).optional(),
    aiModel: z.string().optional(),
});


export async function saveDocument(prisma: Pick<typeof database, "contentJob" | "tool">, userId: string, payload: unknown) {
        const parsed = payloadSchema.safeParse(payload);
        if (!parsed.success) return result({ message: "Invalid document." }, { status: 400 });
        const body = parsed.data;
        const existing = await prisma.contentJob.findUnique({ where: { id: body.documentId } });
        if (existing && existing.userId !== userId) {
            return result({ message: "Document not found." }, { status: 404 });
        }
        const inputPayload = JSON.parse(JSON.stringify({
            ...body.inputData, title: body.title, seoMetadata: body.seoMetadata,
        }));
        const seoMetadata = body.seoMetadata ? JSON.parse(JSON.stringify(body.seoMetadata)) : undefined;
        if (existing) {
            // A lost response can be retried without duplicating a document or overwriting a newer edit.
            const alreadySaved = existing.outputContent === body.content
                && stableJson(existing.inputPayload) === stableJson(inputPayload)
                && stableJson(existing.seoMetadata) === stableJson(seoMetadata);
            if (alreadySaved) return result({ documentId: existing.id, revision: existing.updatedAt.toISOString() });
            if (!body.revision || existing.updatedAt.toISOString() !== body.revision) {
                return result({ message: "This document changed in another tab. Copy your edits before reloading." }, { status: 409 });
            }
            const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
            const updated = await prisma.contentJob.updateMany({
                where: { id: body.documentId, userId, updatedAt: new Date(body.revision) },
                data: { outputContent: body.content, inputPayload, seoMetadata, updatedAt },
            });
            if (!updated.count) return result({ message: "This document changed in another tab. Copy your edits before reloading." }, { status: 409 });
            return result({ documentId: body.documentId, revision: updatedAt.toISOString() });
        }
        if (!body.create) return result({ message: "Document not found." }, { status: 404 });
        const tool = await prisma.tool.upsert({
            where: { slug: "seo-writer" }, update: {},
            create: { slug: "seo-writer", name: "SEO Article Writer", isActive: true },
        });
        const saved = await prisma.contentJob.create({
            data: {
                id: body.documentId, userId, toolId: tool.id,
                aiModel: /GPT|OMNI/i.test(body.aiModel || "") ? "GPT_4_OMNI" : "CLAUDE_3_5_SONNET",
                status: "COMPLETED", inputPayload, outputContent: body.content, seoMetadata,
            },
        });
        return result({ documentId: saved.id, revision: saved.updatedAt.toISOString() });
}
