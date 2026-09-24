-- CreateEnum
CREATE TYPE "DeleteRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "FundTxType" ADD VALUE 'REWARD_DEPOSIT';

-- DropForeignKey
ALTER TABLE "TaskPenalty" DROP CONSTRAINT "TaskPenalty_fundTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "TaskReward" DROP CONSTRAINT "TaskReward_fundTransactionId_fkey";

-- DropIndex
DROP INDEX "TaskPenalty_fundTransactionId_key";

-- DropIndex
DROP INDEX "TaskReward_fundTransactionId_key";

-- 轉換既有資料：舊版打卡後直接進基金的獎金／懲罰紀錄改為「尚未入金」
-- （基金紀錄 soft delete 保留；TaskReward／TaskPenalty 本身不動，會出現在「尚未入金獎金」）
UPDATE "FundTransaction"
SET "deletedAt" = CURRENT_TIMESTAMP, "note" = COALESCE("note", '') || '（改為尚未入金）'
WHERE "type" IN ('TASK_REWARD', 'MILESTONE_BONUS', 'TASK_PENALTY') AND "deletedAt" IS NULL;

-- AlterTable
ALTER TABLE "TaskPenalty" DROP COLUMN "fundTransactionId",
ADD COLUMN     "depositEntryId" TEXT;

-- AlterTable
ALTER TABLE "TaskReward" DROP COLUMN "fundTransactionId",
ADD COLUMN     "depositEntryId" TEXT;

-- CreateTable
CREATE TABLE "DeleteRequest" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "DeleteRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeleteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeleteRequest_bookId_status_idx" ON "DeleteRequest"("bookId", "status");

-- CreateIndex
CREATE INDEX "DeleteRequest_entityType_entityId_idx" ON "DeleteRequest"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "TaskReward_fundId_depositEntryId_idx" ON "TaskReward"("fundId", "depositEntryId");

-- AddForeignKey
ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_depositEntryId_fkey" FOREIGN KEY ("depositEntryId") REFERENCES "FundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPenalty" ADD CONSTRAINT "TaskPenalty_depositEntryId_fkey" FOREIGN KEY ("depositEntryId") REFERENCES "FundTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeleteRequest" ADD CONSTRAINT "DeleteRequest_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

