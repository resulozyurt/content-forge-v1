import { NextResponse } from 'next/server';
import { db } from '@contentforge/database';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email ve şifre zorunludur.' }, { status: 400 });
    }

    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: 'Bu email adresi zaten kullanımda.' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    
    // 6 Haneli rastgele OTP üretimi
    const otpCode = crypto.randomInt(100000, 999999).toString();
    // OTP 15 dakika geçerli olacak
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.user.create({
      data: {
        email,
        passwordHash,
        otpCode,
        otpExpiresAt,
      },
    });

    // TODO: Burada gerçek bir e-posta servisi (Resend, AWS SES) kullanılacak
    console.log(`[EMAIL SIMULATION] ${email} adresine gönderilen doğrulama kodu: ${otpCode}`);

    return NextResponse.json({ 
      message: 'Kayıt başarılı. Lütfen e-postanıza gelen doğrulama kodunu girin.',
      requireOtp: true 
    }, { status: 201 });

  } catch (error) {
    console.error('Kayıt Hatası:', error);
    return NextResponse.json({ error: 'Sunucu hatası oluştu.' }, { status: 500 });
  }
}