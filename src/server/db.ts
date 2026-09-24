import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** 全域共用一個 PrismaClient（開發模式熱重載時避免連線爆量）。 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** 鎖定帳本列：所有財務寫入都先鎖定，再檢查、再寫入（不變式 6）。 */
export async function lockBook(tx: Tx, bookId: string) {
  await tx.$queryRaw`SELECT id FROM "Book" WHERE id = ${bookId} FOR UPDATE`;
}
