// apps/web/src/app/api/documents/save/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

export async function POST(req: Request) {
    try {
        // 1. Authenticate the session
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ message: "Unauthorized access." }, { status: 401 });
        }

        const { title, content, aiModel, inputData } = await req.json();
        
        if (!content) {
            return NextResponse.json({ message: "Document content is required." }, { status: 400 });
        }

        // 2. Ensure the foundational tool reference exists in the registry
        const tool = await prisma.tool.upsert({
            where: { slug: "seo-writer" },
            update: {},
            create: { slug: "seo-writer", name: "SEO Article Writer", isActive: true }
        });

        // 3. Sterilize the payload to prevent Prisma JSON serialization faults
        const safePayload = inputData ? JSON.parse(JSON.stringify(inputData)) : {};
        safePayload.title = title || "Generated SEO Article";

        // 4. Persist the generated document to the ledger
        const savedDocument = await prisma.contentJob.create({
            data: {
                userId: (session.user as any).id,
                toolId: tool.id,
                aiModel: aiModel || "GPT_4_OMNI",
                status: "COMPLETED",
                inputPayload: safePayload, 
                outputContent: content,
            }
        });

        console.log(`[LEDGER_SYNC] Successfully persisted document ${savedDocument.id} for user ${(session.user as any).id}`);
        return NextResponse.json({ message: "Document saved successfully", documentId: savedDocument.id }, { status: 200 });

    } catch (error: any) {
        console.error("[DOCUMENT_SAVE_CRITICAL_ERROR]:", error);
        // Return the exact error signature to the client to prevent silent failures
        return NextResponse.json({ message: "Failed to save document to the cluster.", details: error.message }, { status: 500 });
    }
}