-- V15：帳本系統升級（原帳本 / 旅遊帳本 / 自訂帳本）。
--
-- 這支 migration 刻意很小，因為**多帳本的底層本來就已經在了**：
--   * Book 已有 status，而 canWrite 本來就要求 status = 'ACTIVE'
--   * User.activeBookId 已存在，getBookContext() 已經在用它挑帳本
--   * 所有財務資料早就是 bookId scoped，loadContext() 也早就在驗 membership
-- 所以只補四樣東西：類型、結案時間、旅遊的起訖日與備註。
-- 沒有任何資料搬遷風險：新欄位都可空或有預設值。

-- 1) 結案狀態。
--    不是新發明一套權限 —— ACTIVE 以外的狀態本來就寫不進任何財務資料。
ALTER TYPE "BookStatus" ADD VALUE IF NOT EXISTS 'CLOSED';

-- 2) 帳本類型。
CREATE TYPE "BookType" AS ENUM ('MAIN', 'TRIP', 'CUSTOM');

-- 3) Book 的新欄位。
--    type 預設 MAIN：既有的每一本帳本都是那對情侶的原帳本，
--    所以不需要回填，預設值就是正確答案。
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "type"     "BookType" NOT NULL DEFAULT 'MAIN';
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "startOn"  DATE;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "endOn"    DATE;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "note"     TEXT;

-- 4) 一個人在同一組成員底下只會有一本 MAIN。
--    這條不用唯一索引強制（Book 沒有「這組情侶」的欄位可以當 scope，
--    Couple 才是 1:1），改由 service 層保證：建立第二本帳本的路徑只接受
--    TRIP / CUSTOM，而 MAIN 只會從 onboarding 的 createBook() 產生。
