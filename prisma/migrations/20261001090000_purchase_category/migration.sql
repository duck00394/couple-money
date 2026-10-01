-- V12-2：購買紀錄加上「商品分類」這一層（吊娃／S娃／扭蛋／景品／一番賞／其他）
--
-- 商品分類掛在 Book 底下由所有作品共用：吉伊卡哇的吊娃與排球少年的吊娃是同一種商品類型，
-- 新增一次全部作品都用得到。角色則相反，是依作品分開管理的（PurchaseTag.groupId）。
--
-- 這一層一樣不碰財務：PurchaseEntry 仍然不產生 TransactionPayment / TransactionSplit。
--
-- 既有資料的處理順序很重要：先建表、先種分類、欄位先可空、回填之後才設 NOT NULL，
-- 不然已經有購買紀錄的帳本會在 ALTER TABLE 當場失敗。

-- CreateTable
CREATE TABLE "PurchaseCategory" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseCategory_bookId_sortOrder_idx" ON "PurchaseCategory"("bookId", "sortOrder");

-- AddForeignKey
ALTER TABLE "PurchaseCategory" ADD CONSTRAINT "PurchaseCategory_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 每個帳本「至多一個」預設商品分類（刪除分類時的落點）。
-- 跟 PurchaseTag 同一套做法：Prisma schema 沒有 partial index 的語法，
-- 所以這一行只存在於 migration.sql，schema.prisma 上面有註解指向這裡 —— 不要刪掉它。
-- 「至少一個」由 service 保證（ensureCategories 建出來，且拒絕刪除 default）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "PurchaseCategory_one_default_per_book"
  ON "PurchaseCategory"("bookId") WHERE "isDefault";

-- 已經在用購買紀錄的帳本：把六種預設商品分類種出來，舊紀錄才有地方落腳。
-- 只處理真的有購買紀錄的帳本，沒用過這個功能的帳本留給 service 第一次建作品時再建。
INSERT INTO "PurchaseCategory" ("id", "bookId", "name", "isDefault", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || b.id || c.name),
  b.id, c.name, c.name = '其他', c.ord, now(), now()
FROM (SELECT DISTINCT "bookId" AS id FROM "PurchaseEntry") b
CROSS JOIN (VALUES
  ('吊娃', 1), ('S娃', 2), ('扭蛋', 3), ('景品', 4), ('一番賞', 5), ('其他', 6)
) AS c(name, ord);

-- AlterTable：先可空
ALTER TABLE "PurchaseEntry" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "PurchaseKeyword" ADD COLUMN "categoryId" TEXT;

-- 回填：舊的購買紀錄一律先放到該帳本的預設分類（「其他」），之後可以自己改
UPDATE "PurchaseEntry" e
SET "categoryId" = (
  SELECT c.id FROM "PurchaseCategory" c WHERE c."bookId" = e."bookId" AND c."isDefault" LIMIT 1
)
WHERE e."categoryId" IS NULL;

-- 回填完才設 NOT NULL
ALTER TABLE "PurchaseEntry" ALTER COLUMN "categoryId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "PurchaseEntry_groupId_categoryId_idx" ON "PurchaseEntry"("groupId", "categoryId");

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PurchaseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseKeyword" ADD CONSTRAINT "PurchaseKeyword_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PurchaseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
