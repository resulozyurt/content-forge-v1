// apps/web/src/app/api/admin/users/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

// Middleware utility to rigorously verify administrative privileges
async function verifyAdminAccess() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "ADMIN") {
        throw new Error("Unauthorized. Administrator privileges are required to access this endpoint.");
    }
    return session;
}

export async function GET(req: Request) {
    try {
        await verifyAdminAccess();

        // 1. Retrieve all registered users alongside their current wallet ledgers
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                role: true,
                isVerified: true,
                createdAt: true,
                wallet: {
                    select: { creditsAvailable: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({ users }, { status: 200 });

    } catch (error: any) {
        console.error("[ADMIN_FETCH_ERROR]:", error);
        return NextResponse.json({ error: error.message || "Failed to retrieve the user registry." }, { status: 403 });
    }
}

export async function PATCH(req: Request) {
    try {
        await verifyAdminAccess();

        const { targetUserId, action, payload } = await req.json();

        if (!targetUserId || !action) {
            return NextResponse.json({ error: "Missing required operational parameters." }, { status: 400 });
        }

        console.log(`[ADMIN_OPERATION] Executing '${action}' on user ${targetUserId}`);

        // 2. Process highly privileged administrative overrides
        switch (action) {
            case "UPDATE_ROLE":
                // Elevate or demote user access privileges
                await prisma.user.update({
                    where: { id: targetUserId },
                    data: { role: payload.role }
                });
                break;

            case "ADD_CREDITS":
                // Inject promotional or purchased credits directly into the user's billing ledger
                const amountToAdd = parseInt(payload.amount, 10);
                if (isNaN(amountToAdd) || amountToAdd <= 0) throw new Error("Invalid credit allocation amount.");
                
                await prisma.$transaction([
                prisma.wallet.upsert({
                where: { userId: targetUserId },
                update: { creditsAvailable: { increment: amountToAdd } },
                create: { 
                    userId: targetUserId, 
                    creditsAvailable: amountToAdd 
                }
            }),
                    // Maintain an immutable audit trail for administrative token injections
                    prisma.transaction.create({
                        data: {
                            userId: targetUserId,
                            amount: amountToAdd,
                            type: "TOPUP",
                            description: "Administrative token allocation."
                        }
                    })
                ]);
                break;

            default:
                return NextResponse.json({ error: "Unrecognized administrative command." }, { status: 400 });
        }

        return NextResponse.json({ success: true, message: "Administrative operation executed successfully." }, { status: 200 });

    } catch (error: any) {
        console.error("[ADMIN_MUTATION_ERROR]:", error);
        return NextResponse.json({ error: error.message || "Failed to execute the requested administrative override." }, { status: 500 });
    }
}