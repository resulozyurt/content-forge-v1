// apps/web/src/app/api/auth/verify/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@contentforge/database';
import bcrypt from 'bcrypt';

export async function POST(req: Request) {
  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json({ error: 'Email address and verification code are required.' }, { status: 400 });
    }

    // 1. Retrieve the user record from the database
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return NextResponse.json({ error: 'User account could not be located.' }, { status: 404 });
    }

    if (user.isVerified) {
      return NextResponse.json({ error: 'This account has already been successfully verified.' }, { status: 400 });
    }

    // 2. Validate OTP expiration window
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return NextResponse.json({ error: 'The verification code has expired. Please request a new code.' }, { status: 400 });
    }

    if (!user.otpCode) {
      return NextResponse.json({ error: 'No active verification sequence found for this account.' }, { status: 400 });
    }

    // 3. Cryptographically verify the provided OTP against the stored hash
    const isOtpValid = await bcrypt.compare(code, user.otpCode);

    if (!isOtpValid) {
      return NextResponse.json({ error: 'The provided verification code is invalid.' }, { status: 400 });
    }

    // 4. Execute atomic transaction to verify the user and provision core dependencies
    await prisma.$transaction(async (tx) => {
      // Flag user as verified and clear the OTP payload
      await tx.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      // Provision the initial billing wallet required for AI generation
      await tx.wallet.create({
        data: {
          userId: user.id,
          creditsAvailable: 0, 
        },
      });

      // Provision default application settings
      await tx.userSettings.create({
        data: {
          userId: user.id,
          defaultStatus: "draft"
        }
      });
    });

    return NextResponse.json({ message: 'Your account has been successfully verified. You may now log in.' }, { status: 200 });

  } catch (error) {
    console.error('[VERIFICATION_CRITICAL_FAULT]:', error);
    return NextResponse.json({ error: 'A critical error occurred during the verification sequence.' }, { status: 500 });
  }
}