-- 預購的預設分類：付款時自動帶入，統計才不會整包落在「未分類」。純新增。
ALTER TABLE "Preorder" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "Preorder_categoryId_idx" ON "Preorder"("categoryId");
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
