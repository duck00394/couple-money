-- V16：帳本自己的「換回台幣」匯率。
--
-- 之前這個匯率只能在設定頁（/rates）設，而且那張 ExchangeRate 表是給
-- 「台幣帳本裡的單筆外幣消費」用的。日圓帳本要的是反過來的東西：
-- 整本帳是日圓，只是想在旁邊看一行「大概多少台幣」。
--
-- 所以直接存在 Book 上，建帳本時就一起填（不用再跑去設定頁）。
-- **它只影響顯示**：帳務計算一行都不碰它，改匯率不會動到任何一筆交易。
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "homeRateUnits" INTEGER;
ALTER TABLE "Book" ADD COLUMN IF NOT EXISTS "homeRateMinor" INTEGER;
