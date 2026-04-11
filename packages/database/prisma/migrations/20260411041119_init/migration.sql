-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AIModel" AS ENUM ('CLAUDE_3_5_SONNET', 'GPT_4_OMNI');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creditsAvailable" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "aiModel" "AIModel" NOT NULL DEFAULT 'CLAUDE_3_5_SONNET',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "inputPayload" JSONB NOT NULL,
    "outputContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enUS" TEXT NOT NULL,
    "trTR" TEXT,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Tool_slug_key" ON "Tool"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Translation_key_key" ON "Translation"("key");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentJob" ADD CONSTRAINT "ContentJob_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
