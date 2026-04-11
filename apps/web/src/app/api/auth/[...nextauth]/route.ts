// apps/web/src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// NextAuth'u çalıştır ve handler nesnesine ata
const handler = NextAuth(authOptions);

// Next.js App Router yapısı gereği GET ve POST metodlarını dışa aktar
export { handler as GET, handler as POST };