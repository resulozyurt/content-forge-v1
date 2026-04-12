// apps/web/src/app/api/documents/delete/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

export async function DELETE(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: "Document ID required" }, { status: 400 });

        await prisma.contentJob.delete({
            where: { id, userId: session.user.id }
        });

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (e) {
        console.error("DELETE_ERROR:", e);
        return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
    }
}