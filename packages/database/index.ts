// packages/database/index.ts
import { PrismaClient } from '@prisma/client';

// Prisma'nın ürettiği tüm tipleri (User, Role vb.) diğer projelere aç
export * from '@prisma/client';

// Next.js geliştirme ortamında sürekli yeni bağlantı açıp veritabanını şişirmemesi için Global Singleton deseni
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;