-- 「每週」的定義改成「一週內任意一天完成一次」，不再綁定星期幾。
-- 既有的每週任務原本只排了一天，改成每天都可以做（真正的限制在 checkIn 的同週檢查）。
UPDATE "Task" SET "daysOfWeek" = 127 WHERE "frequency" = 'WEEKLY' AND "daysOfWeek" <> 127;
