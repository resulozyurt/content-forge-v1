// apps/web/src/app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@contentforge/database";
import bcrypt from "bcryptjs";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, email, phone, password, marketingConsent } = body;

        if (!email || !password || !name) {
            return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });

        // OTP Generation (6 digits)
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

        if (existingUser) {
            if (existingUser.isVerified) {
                return NextResponse.json({ error: "An account with this email already exists." }, { status: 400 });
            } else {
                // If user exists but is not verified, update their OTP and resend email
                await prisma.user.update({
                    where: { email },
                    data: { otpCode, otpExpiresAt, name, phone, marketingConsent }
                });
            }
        } else {
            // Create new unverified user
            const passwordHash = await bcrypt.hash(password, 10);
            await prisma.user.create({
                data: {
                    email,
                    name,
                    phone,
                    passwordHash,
                    marketingConsent: marketingConsent || false,
                    isVerified: false,
                    otpCode,
                    otpExpiresAt
                }
            });
        }

        // Send OTP via Resend
        await resend.emails.send({
            from: "ContentForge <onboarding@resend.dev>", // TODO: Change this to your verified domain (e.g., no-reply@contentforge.com)
            to: email,
            subject: "Your ContentForge Verification Code",
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2563eb;">Verify your email address</h2>
                    <p>Hi ${name},</p>
                    <p>Thank you for creating an account with ContentForge. To complete your registration, please enter the following 6-digit verification code:</p>
                    <div style="background-color: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">
                        <h1 style="letter-spacing: 4px; color: #111827; margin: 0;">${otpCode}</h1>
                    </div>
                    <p>This code will expire in 10 minutes.</p>
                    <p>If you did not request this code, please ignore this email.</p>
                </div>
            `
        });

        return NextResponse.json({ success: true, message: "Verification code sent to email." });
    } catch (error) {
        console.error("[REGISTER_ERROR]", error);
        return NextResponse.json({ error: "An internal server error occurred." }, { status: 500 });
    }
}