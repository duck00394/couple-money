-- V12：購買紀錄（Purchase Log）
--
-- 這四張表完全不參與財務計算：不產生 TransactionPayment / TransactionSplit，
-- 所以 accountBalances() 與 netPositions() 看不到它們。Transaction 沒有新增任何欄位
-- （PurchaseEntry.transactionId 是這邊的外鍵，Transaction 那側只是 Prisma 的反向宣告）。

-- CreateTable
CREATE TABLE "PurchaseGroup" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'gift',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseTag" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseKeyword" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tagId" TEXT,
    "word" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseEntry" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "ownerId" TEXT,
    "transactionId" TEXT,
    "title" TEXT,
    "occurredAt" TIMESTAMP(3),
    "amount" INTEGER,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseGroup_bookId_sortOrder_idx" ON "PurchaseGroup"("bookId", "sortOrder");

-- CreateIndex
CREATE INDEX "PurchaseTag_groupId_sortOrder_idx" ON "PurchaseTag"("groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "PurchaseKeyword_bookId_idx" ON "PurchaseKeyword"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseKeyword_bookId_word_key" ON "PurchaseKeyword"("bookId", "word");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseEntry_transactionId_key" ON "PurchaseEntry"("transactionId");

-- CreateIndex
CREATE INDEX "PurchaseEntry_bookId_groupId_idx" ON "PurchaseEntry"("bookId", "groupId");

-- CreateIndex
CREATE INDEX "PurchaseEntry_bookId_ownerId_idx" ON "PurchaseEntry"("bookId", "ownerId");

-- CreateIndex
CREATE INDEX "PurchaseEntry_groupId_tagId_idx" ON "PurchaseEntry"("groupId", "tagId");

-- AddForeignKey
ALTER TABLE "PurchaseGroup" ADD CONSTRAINT "PurchaseGroup_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseTag" ADD CONSTRAINT "PurchaseTag_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseKeyword" ADD CONSTRAINT "PurchaseKeyword_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseKeyword" ADD CONSTRAINT "PurchaseKeyword_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PurchaseTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PurchaseGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PurchaseTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseEntry" ADD CONSTRAINT "PurchaseEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 每個作品「至多一個」預設角色。
--
-- Prisma schema 沒有 partial index 的語法，所以這一行只存在於 migration.sql，
-- schema.prisma 的 PurchaseTag 上面有註解指向這裡 —— 不要刪掉它。
-- 「至少一個」由 service 保證（建立 group 時同一個 $transaction 內一起建，且拒絕刪除 default）。
--
-- 實測過：prisma migrate deploy / migrate dev / db push 都不會把它砍掉，
-- 因為 shadow database 是照 migration 歷史重放出來的，兩邊都有這個 index，不算 drift。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "PurchaseTag_one_default_per_group"
  ON "PurchaseTag"("groupId") WHERE "isDefault";
