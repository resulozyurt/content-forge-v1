// apps/web/src/app/api/documents/history/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

export async function GET() {
    try {
        // 1. Kullanıcı oturumunu kontrol et
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }

        // 2. Kullanıcının veritabanındaki içerik geçmişini çek
        const jobs = await prisma.contentJob.findMany({
            where: { userId: session.user.id },
            orderBy: { createdAt: 'desc' }, // En yeniler en üstte
            include: { 
                tool: true // Tool (Araç) ismini de beraberinde getir
            }
        });

        return NextResponse.json({ jobs }, { status: 200 });

    } catch (error) {
        console.error("HISTORY_FETCH_ERROR:", error);
        return NextResponse.json({ message: "Error fetching history" }, { status: 500 });
    }
}