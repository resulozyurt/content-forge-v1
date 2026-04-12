// apps/web/src/app/api/user/settings/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@contentforge/database";
import { encrypt } from "@/lib/encryption";

export async function GET(req: Request) {
    try {
        // 1. Authenticate the active session
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized access." }, { status: 401 });
        }

        const userId = (session.user as any).id;

        // 2. Retrieve user settings without exposing the raw or encrypted password
        const settings = await db.userSettings.findUnique({
            where: { userId },
            select: {
                wpUrl: true,
                wpUsername: true,
                defaultStatus: true,
                // We intentionally EXCLUDE wpAppPassword for strict security compliance
            }
        });

        // Return empty defaults if no settings exist yet
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

        // 3. Prepare the data payload for database upsert operation
        const updateData: any = {
            wpUrl: wpUrl || null,
            wpUsername: wpUsername || null,
            defaultStatus: defaultStatus || "draft",
        };

        // 4. Encrypt the application password if the user provided a new one
        if (wpAppPassword && wpAppPassword.trim() !== "") {
            console.log(`[SECURITY] Encrypting new WordPress application password for user ${userId}.`);
            updateData.wpAppPassword = encrypt(wpAppPassword);
        }

        // 5. Upsert the settings (Update if exists, Create if it doesn't)
        const updatedSettings = await db.userSettings.upsert({
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