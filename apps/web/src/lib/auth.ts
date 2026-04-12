// apps/web/src/lib/auth.ts
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@contentforge/database"; // Monorepo veritabanı bağlantınız
import bcrypt from "bcrypt";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Lütfen email ve şifrenizi girin.");
        }

        // 1. Kullanıcıyı veritabanından bul
        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) {
          throw new Error("Bu email adresi ile kayıtlı bir kullanıcı bulunamadı.");
        }

        // 2. ADIM 4: E-posta Doğrulama Kontrolü (OTP)
        // Eğer kullanıcı henüz doğrulanmamışsa girişi engelle
        if (!user.isVerified) {
          throw new Error("Lütfen hesabınızı kullanmadan önce e-posta adresinizi doğrulayın.");
        }

        // 3. Şifre Kontrolü
        const isPasswordCorrect = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );

        if (!isPasswordCorrect) {
          throw new Error("Hatalı şifre girdiniz.");
        }

        // 4. Başarılı: Kullanıcı nesnesini döndür
        return {
          id: user.id,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    // JWT içine kullanıcı id ve rol bilgisini ekliyoruz
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
      }
      return token;
    },
    // Session (Frontend) tarafında bu bilgileri erişilebilir kılıyoruz
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/login", // Custom login sayfamıza yönlendirir
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};