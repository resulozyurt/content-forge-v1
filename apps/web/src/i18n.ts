// apps/web/src/i18n.ts
import { getRequestConfig } from 'next-intl/server';

// 1. Expand the supported locales array to include Turkish
const locales = ['en', 'tr'];

export default getRequestConfig(async (config) => {
  // 2. Safely resolve the requested locale 
  let locale = config.locale || (config.requestLocale ? await config.requestLocale : 'en');

  // 3. Implement a strict fallback mechanism to English if an unsupported locale is detected
  if (!locale || !locales.includes(locale as any)) {
    locale = 'en'; 
  }

  return {
    locale,
    // 4. Dynamically import the corresponding translation matrix
    messages: (await import(`../messages/${locale}.json`)).default
  };
});