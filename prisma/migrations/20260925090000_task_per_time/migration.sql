-- 「每次」任務：做一次賺一次，同一天可以重複完成。
--
-- 最小改動：CheckIn 加一個 seq 欄位，把唯一鍵從 (task, subject, date)
-- 換成 (task, subject, date, seq)。
--   每日／每週／自訂：seq 恆為 0 → 唯一鍵的效果與原本完全相同，防重複機制不變
--   每次：seq 依序遞增 → 同一天可以有很多筆
-- 既有資料一律 seq = 0，行為不受影響。
ALTER TYPE "TaskFrequency" ADD VALUE IF NOT EXISTS 'PER_TIME';

ALTER TABLE "CheckIn" ADD COLUMN "seq" INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS "CheckIn_taskId_subjectKey_date_key";
CREATE UNIQUE INDEX "CheckIn_taskId_subjectKey_date_seq_key" ON "CheckIn"("taskId", "subjectKey", "date", "seq");
