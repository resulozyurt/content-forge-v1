import crypto from 'crypto';

// .env dosyasında mutlaka 32 karakterlik bir ENCRYPTION_KEY tanımlanmalı.
// Örn: ENCRYPTION_KEY="12345678901234567890123456789012"
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || ''; 
const ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  console.warn("Kritik Uyarı: .env dosyasında 32 karakterlik geçerli bir ENCRYPTION_KEY bulunamadı!");
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  // IV, AuthTag ve şifrelenmiş metni birleştirip string olarak dönüyoruz
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(hash: string): string {
  try {
    const parts = hash.split(':');
    if (parts.length !== 3) throw new Error('Geçersiz şifrelenmiş metin formatı');

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
  } catch (error) {
    console.error("Şifre çözme hatası:", error);
    throw new Error("Şifrelenmiş veri çözülemedi.");
  }
}