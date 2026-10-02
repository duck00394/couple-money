-- V14：多幣別＋自訂匯率。
--
-- 設計原則：**匯率是交易發生時的資料，不是永遠動態查詢的資料。**
-- 所以分錄（amount / TransactionPayment / TransactionSplit）一律維持「本位幣」，
-- 外幣只是掛在 Transaction 上的快照。這表示：
--   * 餘額、欠款、結算、預算、統計、基金的既有邏輯一行都不用改
--   * 改匯率設定不可能影響歷史交易 —— 歷史交易的 amount 早就是算好的本位幣數字
--
-- 這支 migration **沒有任何資料搬遷**，只有改名與新增可空欄位，
-- 所以對既有的 TWD 資料完全無風險（規格點 22）。

-- 1) Book.currency → Book.baseCurrency
--    只是改名讓語意清楚（「本位幣」）。這個欄位從來沒有被任何邏輯讀過，
--    所有既有帳本的值都是 'TWD'，改名不影響任何一筆資料。
ALTER TABLE "Book" RENAME COLUMN "currency" TO "baseCurrency";

-- 2) Transaction 的外幣欄位。
--    "currency" 欄位本來就存在（預設 'TWD'），這次才第一次真的被使用。
--    三個新欄位都可空：
--      foreignAmount IS NULL  ⇒ 這筆就是本位幣，匯率視為 1
--    既有資料不需要回填，自然就是正確的（規格點 22）。
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "foreignAmount"    INTEGER;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "rateForeignUnits" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "rateBaseMinor"    INTEGER;

-- 3) 帳本自訂匯率。
--    存法與畫面一致：「100 JPY = 21.5 TWD」→ foreignUnits = 100、baseMinor = 2150，
--    而不是 0.215 —— 避免來回轉換誤差，顯示也不用再組一次。
CREATE TABLE "ExchangeRate" (
  "id"           TEXT         NOT NULL,
  "bookId"       TEXT         NOT NULL,
  "currency"     TEXT         NOT NULL,
  "foreignUnits" INTEGER      NOT NULL,
  "baseMinor"    INTEGER      NOT NULL,
  "updatedById"  TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- 一本帳本對一個幣別只會有一組匯率（改匯率是更新這一列，不是新增一列）
CREATE UNIQUE INDEX "ExchangeRate_bookId_currency_key" ON "ExchangeRate"("bookId", "currency");
CREATE INDEX "ExchangeRate_bookId_idx" ON "ExchangeRate"("bookId");

ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
