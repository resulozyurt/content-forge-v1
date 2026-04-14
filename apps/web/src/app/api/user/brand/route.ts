// apps/web/src/app/api/user/brand/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import { z } from "zod";

const brandProfileSchema = z.object({
    name: z.string().min(2, "Brand name must be at least 2 characters."),
    description: z.string().min(10, "Please provide a more detailed description of your brand's offerings and tone."),
    sitemapUrl: z.string().url("Please provide a valid XML sitemap URL.").optional().or(z.literal('')),
});

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const brand = await prisma.brandProfile.findUnique({
            where: { userId: (session.user as any).id }
        });

        return NextResponse.json({ data: brand || null }, { status: 200 });
    } catch (error) {
        console.error("[BRAND_GET_FAULT]:", error);
        return NextResponse.json({ error: "Failed to retrieve brand profile." }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const body = await req.json();
        const parsed = brandProfileSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: "Invalid payload", details: parsed.error.format() }, { status: 400 });
        }

        const { name, description, sitemapUrl } = parsed.data;

        const brand = await prisma.brandProfile.upsert({
            where: { userId },
            update: { name, description, sitemapUrl },
            create: { userId, name, description, sitemapUrl }
        });

        return NextResponse.json({ data: brand, message: "Brand profile successfully synced." }, { status: 200 });
    } catch (error) {
        console.error("[BRAND_SYNC_FAULT]:", error);
        return NextResponse.json({ error: "A critical error occurred while saving the brand profile." }, { status: 500 });
    }
}