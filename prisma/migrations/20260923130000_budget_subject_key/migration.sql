-- 分類預算加上 subjectKey：區分「共同預算」與「個人預算」。
--
-- 為什麼要這個欄位：沒有它就無法表示「同一個分類同一個月，A 與 B 各有自己的額度」。
-- 為什麼用 sentinel 而不是 nullable ownerId：Postgres 的 UNIQUE 會把多個 NULL 視為相異，
-- 那樣會允許同一個分類出現多筆「共同預算」。
--
-- 對既有資料的影響：全部自動成為 subjectKey = 'COUPLE'，金額、備註、啟用狀態、
-- 統計口徑與行為完全不變。不碰任何交易、分帳、餘額或統計資料。

ALTER TABLE "Budget" ADD COLUMN "subjectKey" TEXT NOT NULL DEFAULT 'COUPLE';

DROP INDEX "Budget_bookId_categoryId_month_key";

CREATE UNIQUE INDEX "Budget_bookId_categoryId_month_subjectKey_key"
  ON "Budget"("bookId", "categoryId", "month", "subjectKey");
