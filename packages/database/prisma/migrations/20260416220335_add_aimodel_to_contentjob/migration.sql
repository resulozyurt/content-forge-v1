/*
  Warnings:

  - Added the required column `updatedAt` to the `BrandProfile` table without a default value. This is not possible if the table is not empty.
  - Made the column `description` on table `BrandProfile` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sitemapUrl" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "description" SET NOT NULL;

-- AlterTable
ALTER TABLE "ContentJob" ADD COLUMN     "aiModel" "AIModel",
ADD COLUMN     "seoMetadata" JSONB;

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");
