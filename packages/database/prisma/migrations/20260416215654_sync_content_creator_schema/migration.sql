/*
  Warnings:

  - You are about to drop the column `inputData` on the `ContentJob` table. All the data in the column will be lost.
  - Added the required column `inputPayload` to the `ContentJob` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ContentJob" DROP COLUMN "inputData",
ADD COLUMN     "inputPayload" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "Tool" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;
