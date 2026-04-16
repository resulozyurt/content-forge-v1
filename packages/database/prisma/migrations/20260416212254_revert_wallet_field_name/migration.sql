/*
  Warnings:

  - You are about to drop the column `credits` on the `Wallet` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "credits",
ADD COLUMN     "creditsAvailable" INTEGER NOT NULL DEFAULT 0;
