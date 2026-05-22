// apps/web/src/lib/billing.ts
import { prisma } from "@contentforge/database";

export class BillingGuard {
  /**
   * Validates if the user has sufficient credits before starting an operation.
   * Throws a descriptive error if the balance is inadequate, halting the API pipeline.
   *
   * @param userId - Unique identifier of the target user.
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
   * Safely deducts user credits using a two-step approach:
   *   1. Pre-check wallet balance outside the transaction (fast read).
   *   2. Atomic $transaction with explicit timeout/maxWait options to prevent
   *      P2028 "Transaction already closed" failures under Railway DB latency.
   *
   * Previously used a single interactive $transaction that encompassed the
   * wallet read + update + ledger insert. Under load the three sequential
   * DB round-trips exceeded Prisma's default 5 000 ms interactive-transaction
   * timeout, producing:
   *   PrismaClientKnownRequestError P2028 — Transaction already closed.
   *
   * Fix: wallet existence/balance is validated outside the transaction via a
   * plain findUnique (no lock needed for the read), then the two mutating
   * statements (update + create) run inside a short interactive transaction
   * with timeout: 15_000 / maxWait: 5_000 so Railway has enough headroom.
   *
   * @param userId - Unique identifier of the target user.
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
      // ── Step 1: Pre-check balance (plain read, no transaction overhead) ──
      const wallet = await prisma.wallet.findUnique({
        where: { userId },
      });

      if (!wallet || wallet.creditsAvailable < amount) {
        throw new Error("Insufficient credits available in the user wallet.");
      }

      // ── Step 2: Atomic deduction — only the two mutating writes ──────────
      // timeout:  max wall-clock ms Prisma waits for the interactive tx to complete.
      // maxWait:  max ms Prisma waits to acquire a connection from the pool.
      // Both raised well above the observed 6 502 ms failure threshold.
      await prisma.$transaction(
        async (tx) => {
          // Decrement balance
          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              creditsAvailable: {
                decrement: amount,
              },
            },
          });

          // Append immutable audit-trail entry
          await tx.transaction.create({
            data: {
              userId,
              amount: -amount,
              type,
              description:
                description ||
                `Automated deduction: ${amount} credits allocated for ${type.toLowerCase()}.`,
            },
          });
        },
        {
          timeout: 15_000, // ms — interactive transaction wall-clock limit
          maxWait: 5_000,  // ms — connection acquisition wait limit
        }
      );

      console.log(
        `[BILLING_LEDGER] Successfully logged ${amount} credit deduction for user ${userId}.`
      );
    } catch (error) {
      console.error("[BILLING_GUARD_FAULT]: Failed to process credit transaction.", error);
      throw error; // Re-throw so the calling API route registers the failure correctly
    }
  }
}