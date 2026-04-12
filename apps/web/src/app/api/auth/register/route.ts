// apps/web/src/app/api/auth/register/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@contentforge/database'; // <-- FIXED: Changed from db to prisma
import bcrypt from 'bcrypt';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email ve şifre zorunludur.' }, { status: 400 });
    }

    // Verify if the user already exists in the registry
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Bu email adresi zaten kullanımda.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    // Generate a 6-digit verification sequence
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Persist the new user to the database
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        otpCode,
        otpExpiresAt,
      },
    });

    console.log(`[EMAIL_SIMULATION] Verification code dispatched to ${email}: ${otpCode}`);

    return NextResponse.json({ 
      message: 'Kayıt başarılı. Lütfen e-postanıza gelen doğrulama kodunu girin.',
      requireOtp: true 
    }, { status: 201 });

  } catch (error) {
    console.error('[REGISTRATION_FAULT]:', error);
    return NextResponse.json({ error: 'Sunucu hatası oluştu.' }, { status: 500 });
  }
}