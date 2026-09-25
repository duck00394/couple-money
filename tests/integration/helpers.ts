import "./env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/server/db";
import * as users from "../../src/server/services/users";
import * as books from "../../src/server/services/books";
import * as ledger from "../../src/server/services/ledger";
import { DomainError } from "../../src/server/domain/errors";

export const $ = (n: number) => n * 100;
export const rid = () => randomUUID();
export const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

/** 清空所有資料表（依 schema 動態取得，新增資料表不用改這裡）。 */
export async function reset() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(",")} CASCADE`);
}

export const rejects = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof DomainError && e.code === code);

/** 建立一對已綁定的情侶，回傳兩人的 context 與各自的現金帳戶、共同帳戶。 */
export async function setupCouple(tag = rid().slice(0, 6)) {
  const a = await users.registerUser({ email: `a-${tag}@example.com`, password: "password123", name: "Amy" });
  const b = await users.registerUser({ email: `b-${tag}@example.com`, password: "password123", name: "Ben" });
  await books.createBook(a.id, { name: "測試帳本", nickname: "小艾" });
  let ctxA = (await books.getBookContext(a.id))!;
  const inv = await books.getOrCreateInvite(ctxA);
  await books.acceptInvite(b.id, inv.code, "阿本");
  ctxA = await books.loadContext(a.id, ctxA.book.id);
  const ctxB = await books.loadContext(b.id, ctxA.book.id);
  const accounts = await ledger.listAccounts(ctxA);
  return {
    aId: a.id,
    bId: b.id,
    ctxA,
    ctxB,
    accA: accounts.find((x) => x.ownerId === a.id)!.id,
    accB: accounts.find((x) => x.ownerId === b.id)!.id,
    joint: accounts.find((x) => x.ownerId === null && x.type === "JOINT")!.id,
  };
}

export { prisma };
