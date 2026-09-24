-- 新增「兩人各自完成」的任務類型。
--
-- 為什麼是新增一個值而不是改 SHARED 的語意：
--   既有 SHARED 任務的歷史 CheckIn / TaskPenalty / TaskMilestoneClaim / UserAchievement
--   全部用 subjectKey = 'COUPLE' 記錄。若把 SHARED 改成「各自完成」，那些歷史紀錄
--   會變成不屬於任何人的孤兒，連續天數、里程碑與徽章都要重算。
--   新增 EACH 可以讓既有資料一個字都不用動。
--
-- 這支 migration 只加列舉值，不搬移任何資料。
ALTER TYPE "TaskScope" ADD VALUE IF NOT EXISTS 'EACH';
