// apps/web/src/app/api/user/wallet/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@contentforge/database";

export async function GET(req: Request) {
    try {
        // 1. Authenticate the current user session
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
        }

        const userId = (session.user as any).id;

        // 2. Query the database for the user's exact ledger balance
        const wallet = await db.wallet.findUnique({
            where: { userId },
            select: { creditsAvailable: true }
        });

        // If a wallet doesn't exist yet (e.g., legacy user), gracefully return 0
        if (!wallet) {
            return NextResponse.json({ creditsAvailable: 0 }, { status: 200 });
        }

        return NextResponse.json({ creditsAvailable: wallet.creditsAvailable }, { status: 200 });

    } catch (error: any) {
        console.error("[WALLET_FETCH_ERROR]:", error);
        return NextResponse.json({ error: "Failed to retrieve the current wallet balance." }, { status: 500 });
    }
}