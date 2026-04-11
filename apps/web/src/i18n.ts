// apps/web/src/i18n.ts
import { getRequestConfig } from 'next-intl/server';

const locales = ['en'];

export default getRequestConfig(async (config) => {
  // Next.js 15+ ve next-intl 3.22+ sürümlerine uyumlu güvenli dil okuma
  let locale = config.locale || (config.requestLocale ? await config.requestLocale : 'en');

  // Eğer dil tanımlı değilse veya desteklenmiyorsa, sistemi 404'e düşürme, zorla 'en' yap!
  if (!locale || !locales.includes(locale as any)) {
    locale = 'en'; 
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});