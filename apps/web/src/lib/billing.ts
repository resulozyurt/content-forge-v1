import { prisma } from "@contentforge/database";

/**
 * Safely deducts user credits utilizing a Prisma $transaction.
 * This ensures atomicity and prevents race conditions where concurrent API requests
 * might bypass balance checks, effectively eliminating the risk of negative balances.
 *
 * @param userId - Unique identifier of the target user.
 * @param amount - Quantity of credits to be deducted.
 * @param type - Categorization of the transaction.
 * @param description - Optional telemetry or audit log context.
 * @returns Boolean indicating the success of the transaction.
 */
export async function deductCredits(
  userId: string,
  amount: number,
  type: "RESEARCH" | "GENERATION" | "EDIT" | "PROOFREAD" | "TOPUP",
  description?: string
): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Retrieve the wallet state within the transaction context
      const wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      // 2. Validate sufficient funds strictly before proceeding
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

      // 4. Record the audit trail
      await tx.transaction.create({
        data: {
          userId,
          amount: -amount,
          type,
          description: description || `Automated deduction: ${amount} credits allocated for ${type.toLowerCase()}.`,
        },
      });
    });

    return true;
  } catch (error) {
    console.error("[BILLING_GUARD_FAULT]: Failed to process credit transaction.", error);
    return false;
  }
}