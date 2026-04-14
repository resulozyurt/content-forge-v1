// apps/web/src/app/api/auth/register/route.ts
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@contentforge/database';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

/**
 * Configure the SMTP transporter using environment variables.
 * For production, use reliable providers like AWS SES, SendGrid, or Mailgun.
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com', // Fallback for local testing
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function POST(req: Request) {
  try {
    // 1. Rate Limiting: Prevent registration spam attacks
    const ip = (await headers()).get('x-forwarded-for') || '127.0.0.1';
    const limiter = await rateLimit(`register_${ip}`, 5, 60 * 60 * 1000); // Strict limit: 5 registrations per hour per IP

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
        otpCode: hashedOtpCode, // Crucial: Store the hash, never the plain text
        otpExpiresAt,
      },
    });

    // 7. Construct the HTML payload for the OTP verification email using the plain code
    const mailOptions = {
      from: process.env.SMTP_FROM || '"Content Forge Security" <noreply@contentforge.ai>',
      to: email,
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
          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 32px 0;" />
          <p style="color: #9ca3af; font-size: 12px; text-align: center;">
            If you did not initiate this request, please disregard this email. Your account remains secure.
          </p>
        </div>
      `,
    };

    // 8. Dispatch the verification email via the configured SMTP relay
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[AUTH_PIPELINE] Verification sequence successfully dispatched to: ${email}`);
    } catch (emailError) {
      console.error('[EMAIL_DISPATCH_FAULT]: Failed to route OTP email to the SMTP server.', emailError);
      // We do not block the registration response here. If the email fails (e.g., bad SMTP config),
      // the user is still created, but they will need to use a "Resend OTP" feature later once the SMTP is fixed.
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