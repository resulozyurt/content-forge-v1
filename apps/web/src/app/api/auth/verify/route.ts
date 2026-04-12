// apps/web/src/app/api/auth/verify/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@contentforge/database'; // <-- FIXED: Changed from db to prisma

export async function POST(req: Request) {
  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json({ error: 'Email ve doğrulama kodu zorunludur.' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 });
    }

    if (user.isVerified) {
      return NextResponse.json({ error: 'Bu hesap zaten doğrulanmış.' }, { status: 400 });
    }

    if (user.otpCode !== code || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return NextResponse.json({ error: 'Geçersiz veya süresi dolmuş doğrulama kodu.' }, { status: 400 });
    }

    // Execute atomic transaction to verify user and initialize dependencies
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      // Initialize the billing wallet
      await tx.wallet.create({
        data: {
          userId: user.id,
          creditsAvailable: 0, 
        },
      });

      // Initialize default user settings
      await tx.userSettings.create({
        data: {
          userId: user.id,
          defaultStatus: "draft"
        }
      });
    });

    return NextResponse.json({ message: 'Hesabınız başarıyla doğrulandı. Giriş yapabilirsiniz.' }, { status: 200 });

  } catch (error) {
    console.error('[VERIFICATION_FAULT]:', error);
    return NextResponse.json({ error: 'Doğrulama sırasında bir hata oluştu.' }, { status: 500 });
  }
}