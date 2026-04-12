// apps/web/src/lib/billing.ts
import { db } from "@contentforge/database";

export class BillingGuard {
  static async checkCredits(userId: string, requiredCredits: number = 1): Promise<string> {
    const wallet = await db.wallet.findUnique({
      where: { userId },
    });

    if (!wallet || wallet.creditsAvailable < requiredCredits) {
      throw new Error(`Insufficient balance. This operation requires ${requiredCredits} credits.`);
    }

    return wallet.id;
  }

  /**
   * Deducts credits and records a transaction log in the ledger.
   */
  static async deductCredits(
    userId: string, 
    amount: number = 1, 
    type: "RESEARCH" | "GENERATION" | "EDIT" | "PROOFREAD",
    description?: string
  ): Promise<void> {
    await db.$transaction([
      // 1. Update the wallet balance
      db.wallet.update({
        where: { userId },
        data: {
          creditsAvailable: {
            decrement: amount
          }
        }
      }),
      // 2. Create a persistent audit log of the transaction
      db.transaction.create({
        data: {
          userId,
          amount: -amount, // Record as a negative outflow
          type,
          description
        }
      })
    ]);
    
    console.log(`[BILLING_LEDGER] Successfully logged ${amount} credit deduction for user ${userId}.`);
  }
}