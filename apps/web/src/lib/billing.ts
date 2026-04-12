// apps/web/src/lib/billing.ts
import { prisma } from "@contentforge/database";

export class BillingGuard {
  static async checkCredits(userId: string, requiredCredits: number = 1): Promise<string> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet || wallet.creditsAvailable < requiredCredits) {
      throw new Error(`Insufficient balance. This operation requires ${requiredCredits} credits.`);
    }

    return wallet.id;
  }

  static async deductCredits(
    userId: string, 
    amount: number = 1, 
    type: "RESEARCH" | "GENERATION" | "EDIT" | "PROOFREAD",
    description?: string
  ): Promise<void> {
    await prisma.$transaction([
      prisma.wallet.update({
        where: { userId },
        data: {
          creditsAvailable: {
            decrement: amount
          }
        }
      }),
      prisma.transaction.create({
        data: {
          userId,
          amount: -amount,
          type,
          description
        }
      })
    ]);
    
    console.log(`[BILLING_LEDGER] Successfully logged ${amount} credit deduction for user ${userId}.`);
  }
}