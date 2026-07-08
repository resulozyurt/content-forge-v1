// apps/web/src/app/api/keyword-lab/history/route.ts
// Keyword Lab history: list a user's past analyses, fetch one in full, or delete one.
// Follows the same conventions as /api/documents/history (GET) and /api/documents/delete (?id=).
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

const PAGE_SIZE = 20;

// GET /api/keyword-lab/history            -> paginated summary list (no heavy results JSON)
// GET /api/keyword-lab/history?id=xxx     -> single session with full results
// GET /api/keyword-lab/history?page=2     -> next page of summaries
export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");

        // Detail mode: return the full stored results for one session.
        // userId is part of the where clause so users can only read their own records.
        if (id) {
            const keywordSession = await prisma.keywordSession.findFirst({
                where: { id, userId: session.user.id },
            });

            if (!keywordSession) {
                return NextResponse.json({ error: "Session not found" }, { status: 404 });
            }

            return NextResponse.json({ session: keywordSession }, { status: 200 });
        }

        // List mode: summaries only -- `results` JSON is excluded to keep the payload small.
        const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

        const [sessions, total] = await Promise.all([
            prisma.keywordSession.findMany({
                where: { userId: session.user.id },
                orderBy: { createdAt: "desc" },
                select: { id: true, seedKeyword: true, createdAt: true },
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
            }),
            prisma.keywordSession.count({
                where: { userId: session.user.id },
            }),
        ]);

        return NextResponse.json(
            { sessions, total, page, pageSize: PAGE_SIZE },
            { status: 200 }
        );
    } catch (error) {
        console.error("KEYWORD_HISTORY_FETCH_ERROR:", error);
        return NextResponse.json({ error: "Error fetching keyword history" }, { status: 500 });
    }
}

// DELETE /api/keyword-lab/history?id=xxx -> remove one session (ownership enforced)
export async function DELETE(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "Session ID required" }, { status: 400 });
        }

        // deleteMany (instead of delete) lets us scope by userId and avoid
        // throwing when the record does not exist or belongs to someone else.
        const result = await prisma.keywordSession.deleteMany({
            where: { id, userId: session.user.id },
        });

        if (result.count === 0) {
            return NextResponse.json({ error: "Session not found" }, { status: 404 });
        }

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
        console.error("KEYWORD_HISTORY_DELETE_ERROR:", error);
        return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
    }
}