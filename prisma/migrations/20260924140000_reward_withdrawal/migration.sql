-- 任務獎勵「提列」：把個人獎勵餘額換成一筆真正的 INCOME Transaction。
--
-- 只加兩個欄位指向那筆交易，沿用既有的 depositEntryId 慣例（null = 還沒用掉）：
--   TaskReward.withdrawalId   提列後指向那筆 INCOME
--   TaskPenalty.withdrawalId  提列時一起結清（否則懲罰會一直重複扣餘額）
-- 既有資料一律是 NULL，行為完全不變。
ALTER TABLE "TaskReward" ADD COLUMN "withdrawalId" TEXT;
ALTER TABLE "TaskPenalty" ADD COLUMN "withdrawalId" TEXT;

ALTER TABLE "TaskReward" ADD CONSTRAINT "TaskReward_withdrawalId_fkey"
  FOREIGN KEY ("withdrawalId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskPenalty" ADD CONSTRAINT "TaskPenalty_withdrawalId_fkey"
  FOREIGN KEY ("withdrawalId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TaskReward_userId_withdrawalId_idx" ON "TaskReward"("userId", "withdrawalId");
