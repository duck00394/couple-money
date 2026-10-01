-- 修正 20261001090000 的回填漏洞。
--
-- 那一版只幫「已經有 PurchaseEntry」的帳本種出商品分類：
--   FROM (SELECT DISTINCT "bookId" FROM "PurchaseEntry")
-- 但在加入商品分類之前就建好作品、卻還沒記過任何一筆的帳本完全被漏掉。
-- 結果是新增購買紀錄的表單上「商品分類」整區空白，送出鈕因為選不到分類而一直是灰的，
-- 而且畫面上沒有任何出路 —— 使用者只能卡在那裡。
--
-- 這裡補種給「有購買資料（作品或紀錄）但一個商品分類都沒有」的帳本。
-- 已經有分類的帳本不會被動到，所以重複執行也安全。
INSERT INTO "PurchaseCategory" ("id", "bookId", "name", "isDefault", "sortOrder", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text || b.id || c.name),
  b.id, c.name, c.name = '其他', c.ord, now(), now()
FROM (
  SELECT DISTINCT "bookId" AS id FROM "PurchaseGroup"
  UNION
  SELECT DISTINCT "bookId" AS id FROM "PurchaseEntry"
) b
CROSS JOIN (VALUES
  ('吊娃', 1), ('S娃', 2), ('扭蛋', 3), ('景品', 4), ('一番賞', 5), ('其他', 6)
) AS c(name, ord)
WHERE NOT EXISTS (SELECT 1 FROM "PurchaseCategory" x WHERE x."bookId" = b.id);
