-- 商品分類改成**依作品分開管理**（原本掛在 Book 底下由所有作品共用）。
--
-- 原因：每個 IP 會出的東西本來就不一樣。吉伊卡哇有一番賞、別的作品可能根本沒有；
-- 排球少年可能有色紙、吉伊卡哇沒有。共用一份會讓每個作品的選單都塞滿用不到的東西。
-- 角色（PurchaseTag）本來就是依作品管理，現在兩者一致。
--
-- 既有資料的搬法：把每個帳本現有的那一套分類「複製」到它底下的每個作品，
-- 再用 (作品, 分類名稱) 把購買紀錄與關鍵字指到新的那一份。
-- 名稱是對應的鑰匙，所以使用者改過名的分類也跟著走。

-- 1) 先加可空的 groupId，並**先把舊的帳本層級唯一索引拿掉**。
--    順序很重要：下一步要把預設分類複製到每個作品，同一個帳本就會同時存在多個
--    isDefault = true 的列，舊索引還活著的話當場就撞上去。
ALTER TABLE "PurchaseCategory" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
DROP INDEX IF EXISTS "PurchaseCategory_one_default_per_book";

-- 2) 每個作品複製一份自己的分類（沿用原本的名稱、是否預設、排序）
-- bookId 這時候還是 NOT NULL，所以複製時要一起帶（第 7 步才會把它拿掉）
INSERT INTO "PurchaseCategory" ("id", "bookId", "groupId", "name", "isDefault", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || g.id || c.id),
  g."bookId", g.id, c."name", c."isDefault", c."sortOrder", now(), now()
FROM "PurchaseGroup" g
JOIN "PurchaseCategory" c ON c."bookId" = g."bookId" AND c."groupId" IS NULL;

-- 3) 購買紀錄指到自己作品底下的那一份（用名稱對應）
UPDATE "PurchaseEntry" e
SET "categoryId" = n.id
FROM "PurchaseCategory" old, "PurchaseCategory" n
WHERE e."categoryId" = old.id
  AND old."groupId" IS NULL
  AND n."groupId" = e."groupId"
  AND n."name" = old."name";

-- 4) 關鍵字同樣處理（PurchaseKeyword 本來就有 groupId）
UPDATE "PurchaseKeyword" k
SET "categoryId" = n.id
FROM "PurchaseCategory" old, "PurchaseCategory" n
WHERE k."categoryId" = old.id
  AND old."groupId" IS NULL
  AND n."groupId" = k."groupId"
  AND n."name" = old."name";

-- 5) 保險：萬一有紀錄沒對到（名稱被改掉又剛好對不上），落到該作品的預設分類，
--    絕對不要讓它指著等一下要被刪掉的舊列
UPDATE "PurchaseEntry" e
SET "categoryId" = (
  SELECT n.id FROM "PurchaseCategory" n
  WHERE n."groupId" = e."groupId" AND n."isDefault" LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM "PurchaseCategory" o WHERE o.id = e."categoryId" AND o."groupId" IS NULL);

UPDATE "PurchaseKeyword" k
SET "categoryId" = NULL
WHERE EXISTS (SELECT 1 FROM "PurchaseCategory" o WHERE o.id = k."categoryId" AND o."groupId" IS NULL);

-- 6) 舊的帳本層級分類可以走了
DELETE FROM "PurchaseCategory" WHERE "groupId" IS NULL;

-- 7) 換成作品層級的結構
DROP INDEX IF EXISTS "PurchaseCategory_bookId_sortOrder_idx";
ALTER TABLE "PurchaseCategory" DROP CONSTRAINT IF EXISTS "PurchaseCategory_bookId_fkey";
ALTER TABLE "PurchaseCategory" DROP COLUMN "bookId";
ALTER TABLE "PurchaseCategory" ALTER COLUMN "groupId" SET NOT NULL;

CREATE INDEX "PurchaseCategory_groupId_sortOrder_idx" ON "PurchaseCategory"("groupId", "sortOrder");
ALTER TABLE "PurchaseCategory" ADD CONSTRAINT "PurchaseCategory_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 每個作品「至多一個」預設分類（刪分類時的落點）。
-- Prisma schema 沒有 partial index 的語法，所以這一行只存在於 migration.sql，
-- schema.prisma 的 PurchaseCategory 上面有註解指向這裡 —— 不要刪掉它。
-- 「至少一個」由 service 保證（建立作品時一起建，且拒絕刪除 default）。
CREATE UNIQUE INDEX "PurchaseCategory_one_default_per_group"
  ON "PurchaseCategory"("groupId") WHERE "isDefault";
