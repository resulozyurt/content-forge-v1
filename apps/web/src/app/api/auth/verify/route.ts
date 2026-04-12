import { NextResponse } from 'next/server';
import { db } from '@contentforge/database';

export async function POST(req: Request) {
  try {
    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json({ error: 'Email ve doğrulama kodu zorunludur.' }, { status: 400 });
    }

    const user = await db.user.findUnique({ where: { email } });

    if (!user) {
      return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 });
    }

    if (user.isVerified) {
      return NextResponse.json({ error: 'Bu hesap zaten doğrulanmış.' }, { status: 400 });
    }

    if (user.otpCode !== code || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      return NextResponse.json({ error: 'Geçersiz veya süresi dolmuş doğrulama kodu.' }, { status: 400 });
    }

    // OTP doğru. Kullanıcıyı onayla, Cüzdan (Wallet) ve Ayarlar (Settings) tablosunu oluştur
    await db.$transaction(async (tx) => {
      // 1. Kullanıcıyı güncelle ve OTP'yi temizle
      await tx.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      // 2. Başlangıç bakiyesiyle Cüzdan oluştur (Örn: Demo için 10 kredi hediye edilebilir, şimdilik 0)
      await tx.wallet.create({
        data: {
          userId: user.id,
          creditsAvailable: 0, 
        },
      });

      // 3. Boş UserSettings kaydı oluştur (WP entegrasyonu vb. için)
      await tx.userSettings.create({
        data: {
          userId: user.id,
          defaultStatus: "draft"
        }
      });
    });

    return NextResponse.json({ message: 'Hesabınız başarıyla doğrulandı. Giriş yapabilirsiniz.' }, { status: 200 });

  } catch (error) {
    console.error('Doğrulama Hatası:', error);
    return NextResponse.json({ error: 'Doğrulama sırasında bir hata oluştu.' }, { status: 500 });
  }
}