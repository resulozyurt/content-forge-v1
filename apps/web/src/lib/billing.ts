import { db } from '@contentforge/database'; // Monorepo veritabanı paketiniz

export class BillingGuard {
  /**
   * Kullanıcının yeterli kredisi olup olmadığını kontrol eder.
   * Yetersizse hata fırlatır, yeterliyse cüzdan (wallet) ID'sini döner.
   */
  static async checkCredits(userId: string, requiredCredits: number = 1): Promise<string> {
    const wallet = await db.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new Error("Kullanıcıya ait cüzdan (wallet) bulunamadı.");
    }

    if (wallet.creditsAvailable < requiredCredits) {
      throw new Error(`Yetersiz bakiye. Bu işlem için ${requiredCredits} kredi gerekiyor.`);
    }

    return wallet.id;
  }

  /**
   * Başarılı bir işlemden sonra kullanıcının kredisini düşer.
   */
  static async deductCredits(userId: string, amount: number = 1): Promise<void> {
    await db.wallet.update({
      where: { userId },
      data: {
        creditsAvailable: {
          decrement: amount
        }
      }
    });
  }
}