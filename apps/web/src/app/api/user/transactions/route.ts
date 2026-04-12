// apps/web/src/app/api/user/transactions/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
        }

        const userId = (session.user as any).id;

        const transactions = await prisma.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        return NextResponse.json({ transactions }, { status: 200 });

    } catch (error: any) {
        console.error("[TRANSACTION_FETCH_ERROR]:", error);
        return NextResponse.json({ error: "Failed to retrieve transaction history." }, { status: 500 });
    }
}