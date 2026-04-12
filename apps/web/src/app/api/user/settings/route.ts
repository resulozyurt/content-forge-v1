// apps/web/src/app/api/user/settings/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import { encrypt } from "@/lib/encryption";

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
        }

        const userId = (session.user as any).id;

        const settings = await prisma.userSettings.findUnique({
            where: { userId },
            select: {
                wpUrl: true,
                wpUsername: true,
                defaultStatus: true,
            }
        });

        return NextResponse.json({ settings: settings || {} }, { status: 200 });

    } catch (error: any) {
        console.error("[SETTINGS_FETCH_ERROR]:", error);
        return NextResponse.json({ error: "Failed to retrieve user configuration." }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const body = await req.json();
        
        const { wpUrl, wpUsername, wpAppPassword, defaultStatus } = body;

        const updateData: any = {
            wpUrl: wpUrl || null,
            wpUsername: wpUsername || null,
            defaultStatus: defaultStatus || "draft",
        };

        if (wpAppPassword && wpAppPassword.trim() !== "") {
            updateData.wpAppPassword = encrypt(wpAppPassword);
        }

        const updatedSettings = await prisma.userSettings.upsert({
            where: { userId },
            update: updateData,
            create: {
                userId,
                ...updateData
            }
        });

        return NextResponse.json({ message: "Configuration secured and synchronized successfully." }, { status: 200 });

    } catch (error: any) {
        console.error("[SETTINGS_UPDATE_ERROR]:", error);
        return NextResponse.json({ error: "Failed to update the configuration registry." }, { status: 500 });
    }
}