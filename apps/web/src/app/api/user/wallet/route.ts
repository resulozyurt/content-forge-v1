// apps/web/src/app/api/user/wallet/route.ts
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

        const wallet = await prisma.wallet.findUnique({
            where: { userId },
            select: { creditsAvailable: true }
        });

        if (!wallet) {
            return NextResponse.json({ creditsAvailable: 0 }, { status: 200 });
        }

        return NextResponse.json({ creditsAvailable: wallet.creditsAvailable }, { status: 200 });

    } catch (error: any) {
        console.error("[WALLET_FETCH_ERROR]:", error);
        return NextResponse.json({ error: "Failed to retrieve the current wallet balance." }, { status: 500 });
    }
}