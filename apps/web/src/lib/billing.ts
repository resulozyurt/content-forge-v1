// apps/web/src/lib/billing.ts
import { prisma } from "@contentforge/database";

export class BillingGuard {
  /**
   * Validates if the user has sufficient credits before starting an operation.
   * Throws a descriptive error if the balance is inadequate, halting the API pipeline.
   * * @param userId - Unique identifier of the target user.
   * @param requiredCredits - The amount of credits required to proceed.
   * @returns The wallet ID upon successful validation.
   */
  static async checkCredits(userId: string, requiredCredits: number = 1): Promise<string> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet || wallet.creditsAvailable < requiredCredits) {
      throw new Error(`Insufficient balance. This operation requires ${requiredCredits} credits.`);
    }

    return wallet.id;
  }

  /**
   * Safely deducts user credits utilizing an atomic Prisma $transaction.
   * This structure inherently prevents race conditions where concurrent API requests
   * might bypass initial balance checks.
   * * @param userId - Unique identifier of the target user.
   * @param amount - Quantity of credits to be deducted.
   * @param type - Categorization of the transaction for ledger auditing.
   * @param description - Optional telemetry context.
   */
  static async deductCredits(
    userId: string, 
    amount: number = 1, 
    type: "RESEARCH" | "GENERATION" | "EDIT" | "PROOFREAD" | "TOPUP",
    description?: string
  ): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Retrieve the wallet state securely within the transaction context
        const wallet = await tx.wallet.findUnique({
          where: { userId },
        });

        // 2. Validate sufficient funds strictly before proceeding with the deduction
        if (!wallet || wallet.creditsAvailable < amount) {
          throw new Error("Insufficient credits available in the user wallet.");
        }

        // 3. Execute the atomic deduction
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            creditsAvailable: {
              decrement: amount,
            },
          },
        });

        // 4. Record the audit trail in the ledger
        await tx.transaction.create({
          data: {
            userId,
            amount: -amount,
            type,
            description: description || `Automated deduction: ${amount} credits allocated for ${type.toLowerCase()}.`,
          },
        });
      });
      
      console.log(`[BILLING_LEDGER] Successfully logged ${amount} credit deduction for user ${userId}.`);
    } catch (error) {
      console.error("[BILLING_GUARD_FAULT]: Failed to process credit transaction.", error);
      throw error; // Re-throw to ensure the calling API route properly registers the failure
    }
  }
}