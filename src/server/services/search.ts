/**
 * 記帳搜尋與篩選。所有條件都限制在目前帳本（bookId）內，傳入別的帳本的 id 只會查不到。
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { totalsFromGroups, type TransactionFilter } from "../domain/search";
import { addDays } from "@/lib/dates";
import type { BookContext } from "./books";

const dayStart = (key: string) => new Date(`${key}T00:00:00+08:00`);

export function buildTransactionWhere(bookId: string, f: TransactionFilter): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [{ bookId, deletedAt: null, status: "POSTED" }];
  if (f.from) and.push({ occurredAt: { gte: dayStart(f.from) } });
  if (f.to) and.push({ occurredAt: { lt: dayStart(addDays(f.to, 1)) } });
  switch (f.kind) {
    case null:
      break;
    case "FUND_EXPENSE":
      and.push({ type: "EXPENSE", fundEntry: { is: { deletedAt: null } } });
      break;
    case "RECURRING":
      and.push({ recurringExpenseId: { not: null } });
      break;
    case "REWARD_DEPOSIT":
      and.push({ type: "TRANSFER", sourceType: "REWARD_DEPOSIT" });
      break;
    default:
      and.push({ type: f.kind });
  }
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.person) and.push({ payments: { some: { userId: f.person === "JOINT" ? null : f.person } } });
  if (f.accountId) and.push({ payments: { some: { accountId: f.accountId } } });
  if (f.fundId) {
    and.push({ OR: [{ fundEntry: { is: { fundId: f.fundId, deletedAt: null } } }, { sourceType: "REWARD_DEPOSIT", sourceId: f.fundId }] });
  }
  if (f.tag) and.push({ tags: { some: { tag: { name: f.tag } } } });
  if (f.min !== null) and.push({ amount: { gte: f.min } });
  if (f.max !== null) and.push({ amount: { lte: f.max } });
  if (f.q) {
    const contains = { contains: f.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { title: contains },
        { note: contains },
        { merchant: contains },
        { category: { is: { name: contains } } },
        { tags: { some: { tag: { name: contains } } } },
        { payments: { some: { account: { name: contains } } } },
        { recurring: { is: { name: contains } } },
      ],
    });
  }
  return { AND: and };
}

export const TX_INCLUDE = {
  payments: { include: { account: true } },
  splits: true,
  category: true,
  settlement: true,
  fundEntry: { include: { fund: true } },
  tags: { include: { tag: true } },
  recurring: { select: { id: true, name: true, deletedAt: true } },
} satisfies Prisma.TransactionInclude;

export async function searchTransactions(ctx: BookContext, f: TransactionFilter, opts: { take?: number; skip?: number } = {}) {
  const where = buildTransactionWhere(ctx.book.id, f);
  const [items, groups] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
      include: TX_INCLUDE,
    }),
    prisma.transaction.groupBy({ by: ["type"], where, _count: { _all: true }, _sum: { amount: true } }),
  ]);
  const totals = totalsFromGroups(groups.map((g) => ({ type: g.type, count: g._count._all, amount: g._sum.amount ?? 0 })));
  return { items, totals };
}
export type SearchItem = Awaited<ReturnType<typeof searchTransactions>>["items"][number];

/** 篩選抽屜需要的選項。 */
export async function searchOptions(ctx: BookContext) {
  const [categories, accounts, funds, tags] = await Promise.all([
    prisma.category.findMany({ where: { bookId: ctx.book.id }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.account.findMany({ where: { bookId: ctx.book.id, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.fund.findMany({ where: { bookId: ctx.book.id, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.tag.findMany({ where: { bookId: ctx.book.id, transactions: { some: { transaction: { deletedAt: null } } } }, orderBy: { name: "asc" } }),
  ]);
  const nick = (uid: string | null) => (uid === null ? "共同" : uid === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === uid)?.nickname ?? "已離開");
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    accounts: accounts.map((a) => ({ id: a.id, name: `${nick(a.ownerId)}・${a.name}` })),
    funds: funds.map((f) => ({ id: f.id, name: f.name })),
    tags: tags.map((t) => t.name),
    people: [
      { id: ctx.me.userId, name: "我" },
      ...(ctx.partner ? [{ id: ctx.partner.userId, name: ctx.partner.nickname }] : []),
      { id: "JOINT", name: "共同帳戶" },
    ],
  };
}
