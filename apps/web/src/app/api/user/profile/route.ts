// apps/web/src/app/api/user/profile/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@contentforge/database";
import bcrypt from "bcryptjs";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
                id: true, name: true, email: true, image: true,
                phone: true, company: true, industry: true, jobTitle: true,
                marketingConsent: true, language: true, timezone: true
            }
        });

        return NextResponse.json(user);
    } catch (error) {
        console.error("[PROFILE_GET]", error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) return new NextResponse("Unauthorized", { status: 401 });

        const body = await req.json();
        const { 
            name, phone, company, industry, jobTitle, 
            marketingConsent, language, timezone, image,
            currentPassword, newPassword 
        } = body;

        const updateData: any = {
            name, phone, company, industry, jobTitle,
            marketingConsent, language, timezone
        };

        if (image) updateData.image = image;

        if (currentPassword && newPassword) {
            const dbUser = await prisma.user.findUnique({ where: { id: session.user.id } });
            if (!dbUser?.passwordHash) {
                return NextResponse.json({ error: "Accounts created via social login cannot change passwords here." }, { status: 400 });
            }
            
            const isPasswordValid = await bcrypt.compare(currentPassword, dbUser.passwordHash);
            if (!isPasswordValid) {
                return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
            }
            
            updateData.passwordHash = await bcrypt.hash(newPassword, 10);
        }

        const updatedUser = await prisma.user.update({
            where: { id: session.user.id },
            data: updateData
        });

        return NextResponse.json({ success: true, user: updatedUser });
    } catch (error) {
        console.error("[PROFILE_PUT]", error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}