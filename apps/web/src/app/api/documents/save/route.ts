// apps/web/src/app/api/documents/save/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ message: "Unauthorized access." }, { status: 401 });
        }

        const { title, content, aiModel, inputData, seoMetadata } = await req.json();
        
        if (!content) {
            return NextResponse.json({ message: "Document content is required." }, { status: 400 });
        }

        const tool = await prisma.tool.upsert({
            where: { slug: "seo-writer" },
            update: {},
            create: { slug: "seo-writer", name: "SEO Article Writer", isActive: true }
        });

        const safePayload = inputData ? JSON.parse(JSON.stringify(inputData)) : {};
        safePayload.title = title || "Generated SEO Article";

        // CRITICAL FIX: Ensure the string perfectly matches the Prisma Enum 'AIModel'
        // This prevents the "Invalid prisma.contentJob.create() invocation" crash.
        let validAiModel: "CLAUDE_3_5_SONNET" | "GPT_4_OMNI" = "CLAUDE_3_5_SONNET";
        if (typeof aiModel === 'string') {
            const rawModel = aiModel.toUpperCase();
            if (rawModel.includes("GPT") || rawModel.includes("OMNI")) {
                validAiModel = "GPT_4_OMNI";
            }
        }

        const savedDocument = await prisma.contentJob.create({
            data: {
                userId: (session.user as any).id,
                toolId: tool.id,
                aiModel: validAiModel, 
                status: "COMPLETED",
                inputPayload: safePayload, 
                outputContent: content,
                seoMetadata: seoMetadata || undefined
            }
        });

        console.log(`[LEDGER_SYNC] Successfully persisted document ${savedDocument.id}`);
        return NextResponse.json({ message: "Document saved successfully", documentId: savedDocument.id }, { status: 200 });

    } catch (error: any) {
        console.error("[DOCUMENT_SAVE_CRITICAL_ERROR]:", error);
        return NextResponse.json({ message: "Failed to save document to the cluster.", details: error.message }, { status: 500 });
    }
}