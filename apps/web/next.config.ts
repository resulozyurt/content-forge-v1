// apps/web/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js'e dışarıdaki paketimizi derlemesini söylüyoruz
  transpilePackages: ["@contentforge/database"],
};

export default nextConfig;