// apps/web/src/lib/auth.ts
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@contentforge/database";
import bcrypt from "bcrypt";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // 1. Gelen verileri kontrol et
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        // 2. Kullanıcıyı veritabanında bul
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        });

        if (!user || !user.passwordHash) {
          throw new Error("Invalid email or password");
        }

        // 3. Şifreyi bcrypt ile doğrula
        const isPasswordValid = await bcrypt.compare(credentials.password, user.passwordHash);

        if (!isPasswordValid) {
          throw new Error("Invalid email or password");
        }

        // 4. OTP / E-posta Doğrulama Kontrolü (Gelecekteki OTP modülümüz için altyapı)
        if (!user.isVerified) {
          throw new Error("Please verify your email address to login.");
        }

        // 5. Başarılı! Token'a yazılacak bilgileri dön
        return {
          id: user.id,
          email: user.email,
          role: user.role,
        };
      }
    })
  ],
  session: {
    strategy: "jwt", // Sunucu hafızasını yormamak için JWT kullanıyoruz
    maxAge: 30 * 24 * 60 * 60, // 30 gün
  },
  callbacks: {
    async jwt({ token, user }) {
      // Giriş yapıldığında user nesnesi gelir, içindeki verileri token'a aktarırız
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      // İstemciye (tarayıcıya) gönderilecek session nesnesini token ile doldururuz
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    }
  },
  pages: {
    signIn: '/auth/login', // Hata olursa veya yetkisiz erişim olursa buraya yönlendir
  }
};