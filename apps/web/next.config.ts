// apps/web/next.config.ts
import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl eklentisine dosyamızın tam yolunu gösteriyoruz
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const nextConfig: NextConfig = {
  transpilePackages: ["@contentforge/database"],
};

export default withNextIntl(nextConfig);