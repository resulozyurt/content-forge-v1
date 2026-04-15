// apps/web/src/app/api/auth/register/route.ts
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@contentforge/database';
import { Resend } from 'resend';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

// Initialize the Resend API client to bypass SMTP port restrictions on edge networks
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    // 1. Rate Limiting: Prevent registration spam attacks
    const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
    const limiter = await rateLimit(`register_${ip}`, 5, 60 * 60 * 1000); 

    if (!limiter.success) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again in an hour.' }, 
        { 
            status: 429, 
            headers: getRateLimitHeaders(limiter.limit, limiter.remaining, limiter.reset) 
        }
      );
    }

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    }

    // 2. Verify if the user already exists in the registry to prevent duplicate accounts
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'This email address is already registered.' }, { status: 400 });
    }

    // 3. Encrypt the user's password utilizing bcrypt with a work factor of 10
    const passwordHash = await bcrypt.hash(password, 10);
    
    // 4. Generate a cryptographically secure 6-digit verification sequence
    const plainOtpCode = crypto.randomInt(100000, 999999).toString();
    
    // 5. Secure the OTP code via hashing before persisting to the database
    const hashedOtpCode = await bcrypt.hash(plainOtpCode, 10);
    
    // OTP validity window: Expires strictly 15 minutes from generation
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // 6. Persist the new user payload to the database
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        otpCode: hashedOtpCode, 
        otpExpiresAt,
        isVerified: false,
      },
    });

    // 7. Dispatch the verification email via the Resend HTTP API (avoids SMTP blockades)
    const { error: emailError } = await resend.emails.send({
      from: 'Content Forge Security <onboarding@resend.dev>', // Adjust to your verified domain later
      to: [email],
      subject: 'Verify Your Identity - Content Forge',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #111827; text-align: center; margin-bottom: 24px; font-size: 24px;">Verify Your Identity</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.6; text-align: center;">
            Welcome to Content Forge. To complete your registration and secure your account, please enter the following One-Time Password (OTP).
          </p>
          <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 24px; text-align: center; border-radius: 8px; margin: 32px 0;">
            <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563eb;">${plainOtpCode}</span>
          </div>
          <p style="color: #ef4444; font-size: 14px; text-align: center; font-weight: 500;">
            This security code will expire in exactly 15 minutes.
          </p>
        </div>
      `,
    });

    if (emailError) {
      console.error('[EMAIL_DISPATCH_FAULT]: Failed to route OTP email via Resend.', emailError);
    }

    return NextResponse.json({ 
      message: 'Registration successful. Please enter the verification code sent to your inbox.',
      requireOtp: true 
    }, { status: 201 });

  } catch (error) {
    console.error('[REGISTRATION_CRITICAL_FAULT]:', error);
    return NextResponse.json({ error: 'A critical server error occurred during the registration sequence.' }, { status: 500 });
  }
}