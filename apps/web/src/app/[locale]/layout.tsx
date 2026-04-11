// apps/web/src/app/[locale]/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";
import { Providers } from "@/components/providers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ContentForge AI",
  description: "Enterprise grade AI content generation platform",
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  // Next.js 15/16 mimarisinde params bir Promise'dir, önce çözümlüyoruz
  const resolvedParams = await params;

  // O anki dile ait tüm çeviri sözlüğünü (en.json) arka plandan çekiyoruz
  const messages = await getMessages();

  return (
    <html lang={resolvedParams.locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-white dark:bg-gray-950 antialiased`}
        suppressHydrationWarning
      >
        {/* İstemci bileşenleri (Sidebar vb.) dilleri okuyabilsin diye sarmalıyoruz */}
        <NextIntlClientProvider messages={messages}>
          <Providers>
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}