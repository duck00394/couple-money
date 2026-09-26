-- 預購訂單。純新增：一張新表 + Transaction 一個可為 null 的關聯欄位。
-- 既有資料完全不受影響（舊的 Transaction 的 preorderId 一律是 NULL）。
CREATE TABLE "Preorder" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seller" TEXT,
    "emoji" TEXT NOT NULL DEFAULT 'package',
    "expectedOn" DATE,
    "itemAmount" INTEGER NOT NULL,
    "shipping" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Preorder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Preorder_bookId_cancelledAt_expectedOn_idx" ON "Preorder"("bookId", "cancelledAt", "expectedOn");

ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Preorder" ADD CONSTRAINT "Preorder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Transaction" ADD COLUMN "preorderId" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_preorderId_fkey" FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Transaction_preorderId_idx" ON "Transaction"("preorderId");
