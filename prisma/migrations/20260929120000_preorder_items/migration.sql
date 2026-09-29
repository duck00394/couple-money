-- 預購：誰付多少 + 明細品項。純新增，不動任何既有欄位。
ALTER TABLE "Preorder" ADD COLUMN "splitRule" JSONB;

CREATE TABLE "PreorderItem" (
    "id" TEXT NOT NULL,
    "preorderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "ownerId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PreorderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PreorderItem_preorderId_idx" ON "PreorderItem"("preorderId");

ALTER TABLE "PreorderItem" ADD CONSTRAINT "PreorderItem_preorderId_fkey"
    FOREIGN KEY ("preorderId") REFERENCES "Preorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreorderItem" ADD CONSTRAINT "PreorderItem_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
