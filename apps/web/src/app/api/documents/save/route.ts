import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import { saveDocument } from "@/lib/document-save";

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        let payload: unknown;
        try { payload = await req.json(); }
        catch { return NextResponse.json({ message: "Invalid document." }, { status: 400 }); }
        const result = await saveDocument(prisma, session.user.id, payload);
        return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
        console.error("[DOCUMENT_SAVE_ERROR]", error);
        return NextResponse.json({ message: "Could not save. Please retry." }, { status: 500 });
    }
}
