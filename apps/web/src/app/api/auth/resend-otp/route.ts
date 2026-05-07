// apps/web/src/app/api/auth/resend-otp/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@contentforge/database";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
    try {
        const { email } = await req.json();

        if (!email) {
            return NextResponse.json({ error: "Email is required." }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
            return NextResponse.json({ error: "Account not found." }, { status: 404 });
        }

        if (user.isVerified) {
            return NextResponse.json({ error: "Account is already verified." }, { status: 400 });
        }

        // Generate new 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await prisma.user.update({
            where: { email },
            data: { otpCode, otpExpiresAt }
        });

        // Send OTP via Resend
        await resend.emails.send({
            from: "ContentForge <onboarding@resend.dev>", // TODO: Update to verified domain
            to: email,
            subject: "Your New Verification Code",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2563eb;">New Verification Code</h2>
                    <p>Hi ${user.name || 'there'},</p>
                    <p>You requested a new verification code. Please enter the following 6-digit code to complete your registration:</p>
                    <div style="background-color: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
                        <h1 style="letter-spacing: 4px; color: #111827; margin: 0;">${otpCode}</h1>
                    </div>
                    <p>This code will expire in 10 minutes.</p>
                </div>
            `
        });

        return NextResponse.json({ success: true, message: "New code sent." });
    } catch (error) {
        console.error("[RESEND_OTP_ERROR]", error);
        return NextResponse.json({ error: "An internal server error occurred." }, { status: 500 });
    }
}