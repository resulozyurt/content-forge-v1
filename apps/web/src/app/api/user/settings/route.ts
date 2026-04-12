// apps/web/src/app/api/user/settings/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";

// Sayfa yüklendiğinde ayarları getir
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        const settings = await prisma.userSettings.findUnique({
            where: { userId: session.user.id }
        });

        return NextResponse.json(settings || {});
    } catch (error) {
        console.error("GET_SETTINGS_ERROR:", error);
        return NextResponse.json({ message: "Error fetching settings" }, { status: 500 });
    }
}

// Kaydet butonuna basıldığında ayarları veritabanına yaz (Upsert)
export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

        const data = await req.json();

        // upsert: Kayıt varsa günceller, yoksa yeni oluşturur
        const settings = await prisma.userSettings.upsert({
            where: { userId: session.user.id },
            update: {
                wpUrl: data.wpUrl,
                wpUsername: data.wpUsername,
                wpAppPassword: data.wpAppPassword,
                wpSitemap: data.wpSitemap,
                defaultStatus: data.defaultStatus
            },
            create: {
                userId: session.user.id,
                wpUrl: data.wpUrl,
                wpUsername: data.wpUsername,
                wpAppPassword: data.wpAppPassword,
                wpSitemap: data.wpSitemap,
                defaultStatus: data.defaultStatus || "draft"
            }
        });

        return NextResponse.json({ message: "Settings saved", settings }, { status: 200 });
    } catch (error) {
        console.error("POST_SETTINGS_ERROR:", error);
        return NextResponse.json({ message: "Error saving settings" }, { status: 500 });
    }
}