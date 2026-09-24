/**
 * Phase 3-2：帳戶間轉帳與退款。
 *
 * 轉帳：Σpayment = 0，不算收支、不影響誰欠誰，轉出金額受「可自由使用金額」限制（保護基金指定的錢）。
 * 退款：獨立的一筆 REFUND，用 relatedId 指回原始消費，不修改原始消費，分帳依原始比例回沖。
 */
import { Prisma } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { buildFlowLines, buildTransferLines } from "../domain/ledger";
import { assertEarmarkBacked, assertTransferable, type TransferAccount } from "../domain/transfer";
import { assertRefundAmount, refundSplitRule } from "../domain/refund";
import { fromDateTime } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { accountFreeAmount, auditIn } from "./funds";
import { TX_INCLUDE } from "./search";

type Client = Tx | typeof prisma;
const REQ_ID = /^[\w:-]{8,80}$/;

/** 帳戶 + 餘額 + 已指定給基金（轉帳檢查用）。 */
export async function loadTransferAccount(client: Client, ctx: BookContext, accountId: string, label: string): Promise<TransferAccount & { ownerId: string | null }> {
  assert(accountId, "TRANSFER_ACCOUNT", `請選擇${label}`);
  const acc = await client.account.findFirst({ where: { id: accountId, bookId: ctx.book.id, deletedAt: null } });
  assert(acc, "TRANSFER_ACCOUNT", `找不到${label}`);
  const { balance, earmarked } = await accountFreeAmount(client, ctx.book.id, acc.id);
  return { id: acc.id, name: acc.name, ownerId: acc.ownerId, isCard: acc.type === "CREDIT_CARD", balance, earmarked };
}

function parseWhen(occurredOn: string, occurredTime: string | null | undefined, code: string) {
  try {
    return fromDateTime(occurredOn, occurredTime);
  } catch {
    throw new DomainError(code, "日期或時間格式不正確");
  }
}

// ───────────────────────── 帳戶間轉帳 ─────────────────────────

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredOn: string;
  occurredTime?: string | null;
  note: string;
  clientRequestId: string;
}

export async function createTransfer(ctx: BookContext, input: TransferInput) {
  assertCanWrite(ctx);
  assert(REQ_ID.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  assert(input.note.length <= 200, "TRANSFER_NOTE", "備註最多 200 個字");
  const occurredAt = parseWhen(input.occurredOn, input.occurredTime, "TRANSFER_DATE");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const dup = await tx.transaction.findUnique({ where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } } });
      if (dup) return dup; // 重複送出：回傳第一次建立的那筆，不會重複產生金流
      const from = await loadTransferAccount(tx, ctx, input.fromAccountId, "轉出帳戶");
      const to = await loadTransferAccount(tx, ctx, input.toAccountId, "轉入帳戶");
      assertTransferable(from, to, input.amount);
      const lines = buildTransferLines(input.amount, { id: from.id, ownerId: from.ownerId }, { id: to.id, ownerId: to.ownerId });
      const created = await tx.transaction.create({
        data: {
          bookId: ctx.book.id,
          type: "TRANSFER",
          occurredAt,
          amount: input.amount,
          title: `轉帳：${from.name} → ${to.name}`,
          note: input.note.trim() || null,
          clientRequestId: input.clientRequestId,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
          payments: { create: lines.payments },
        },
      });
      await auditIn(tx, ctx, "CREATE", "Transaction", created.id, null, { type: "TRANSFER", amount: input.amount, from: from.id, to: to.id, payments: lines.payments });
      return created;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.transaction.findUniqueOrThrow({ where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } } });
    }
    throw e;
  }
}

/** 動到帳戶餘額之後，檢查每個帳戶「已指定給基金」的錢都還有實際餘額對應得到。 */
export async function assertAccountsEarmarkBacked(tx: Tx, ctx: BookContext, accountIds: string[], action: "cancel" | "spend" = "cancel") {
  const ids = [...new Set(accountIds)].filter(Boolean);
  if (ids.length === 0) return;
  const accounts = await Promise.all(ids.map((id) => loadTransferAccount(tx, ctx, id, "帳戶")));
  assertEarmarkBacked(accounts, action);
}

/** 作廢轉帳後，兩個帳戶的「已指定給基金」都還要有實際的錢對應得到。 */
export async function assertTransferCancelable(tx: Tx, ctx: BookContext, accountIds: string[]) {
  await assertAccountsEarmarkBacked(tx, ctx, accountIds, "cancel");
}

// ───────────────────────── 退款 ─────────────────────────

/** 每筆消費「已退款」金額（不含已作廢的退款）。 */
export async function refundedByTransaction(client: Client, bookId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await client.transaction.groupBy({
    by: ["relatedId"],
    where: { bookId, type: "REFUND", status: "POSTED", deletedAt: null, relatedId: { in: ids } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.relatedId!, r._sum.amount ?? 0]));
}

export async function refundedAmount(client: Client, bookId: string, id: string) {
  return (await refundedByTransaction(client, bookId, [id])).get(id) ?? 0;
}

export interface RefundInput {
  /** 原始消費 */
  originalId: string;
  amount: number;
  /** 退款實際進到哪個帳戶 */
  accountId: string;
  occurredOn: string;
  occurredTime?: string | null;
  note: string;
  clientRequestId: string;
}

export async function createRefund(ctx: BookContext, input: RefundInput) {
  assertCanWrite(ctx);
  assert(REQ_ID.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  assert(input.note.length <= 500, "REFUND_NOTE", "備註最多 500 個字");
  const occurredAt = parseWhen(input.occurredOn, input.occurredTime, "REFUND_DATE");
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const dup = await tx.transaction.findUnique({ where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } } });
      if (dup) return dup;
      const original = await tx.transaction.findFirst({
        where: { id: input.originalId, bookId: ctx.book.id, deletedAt: null, status: "POSTED" },
        include: { splits: true, category: true },
      });
      assert(original, "REFUND_SOURCE_NOT_FOUND", "找不到原始消費，可能已被刪除");
      assert(original.type === "EXPENSE", "REFUND_SOURCE_TYPE", "只有支出可以退款");
      const refunded = await refundedAmount(tx, ctx.book.id, original.id);
      assertRefundAmount({ amount: original.amount, refunded }, input.amount);

      const acc = await tx.account.findFirst({ where: { id: input.accountId, bookId: ctx.book.id, deletedAt: null } });
      assert(acc, "REFUND_ACCOUNT", "請選擇退款進到哪個帳戶");
      if (acc.ownerId) {
        const owner = await tx.bookMember.findUnique({ where: { bookId_userId: { bookId: ctx.book.id, userId: acc.ownerId } } });
        assert(owner?.status === "ACTIVE", "REFUND_ACCOUNT_OWNER", "這個帳戶的擁有者已經不在帳本中");
      }

      const rule = refundSplitRule(original.splits, input.amount);
      const lines = buildFlowLines("REFUND", input.amount, [{ account: { id: acc.id, ownerId: acc.ownerId }, amount: input.amount }], rule);
      const created = await tx.transaction.create({
        data: {
          bookId: ctx.book.id,
          type: "REFUND",
          occurredAt,
          amount: input.amount,
          title: original.title,
          merchant: original.merchant,
          note: input.note.trim() || null,
          categoryId: original.categoryId,
          relatedId: original.id,
          splitRule: rule as unknown as Prisma.InputJsonValue,
          clientRequestId: input.clientRequestId,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
          payments: { create: lines.payments },
          splits: { create: lines.splits },
        },
      });
      await auditIn(tx, ctx, "CREATE", "Transaction", created.id, null, {
        type: "REFUND", amount: input.amount, relatedId: original.id, accountId: acc.id, payments: lines.payments, splits: lines.splits,
      });
      return created;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.transaction.findUniqueOrThrow({ where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } } });
    }
    throw e;
  }
}

export interface RefundableItem {
  id: string;
  title: string;
  occurredOn: Date;
  amount: number;
  refunded: number;
  refundable: number;
  accountName: string;
  accountId: string;
  fundName: string | null;
}

/** 退款頁的「選擇原始消費」清單：可退款金額 > 0 的支出。 */
export async function listRefundable(ctx: BookContext, opts: { take?: number; includeId?: string | null } = {}): Promise<RefundableItem[]> {
  // 先找出已經退到滿的消費，查詢時就排除掉，避免「最近 60 筆剛好都退完」時看起來沒有東西可退
  const refundedAll = await prisma.transaction.groupBy({
    by: ["relatedId"],
    where: { bookId: ctx.book.id, type: "REFUND", status: "POSTED", deletedAt: null, relatedId: { not: null } },
    _sum: { amount: true },
  });
  const fullyRefunded: string[] = [];
  if (refundedAll.length > 0) {
    const originals = await prisma.transaction.findMany({
      where: { id: { in: refundedAll.map((r) => r.relatedId!) } },
      select: { id: true, amount: true },
    });
    for (const o of originals) {
      const done = refundedAll.find((r) => r.relatedId === o.id)?._sum.amount ?? 0;
      if (done >= o.amount) fullyRefunded.push(o.id);
    }
  }
  const rows = await prisma.transaction.findMany({
    where: {
      bookId: ctx.book.id, type: "EXPENSE", status: "POSTED", deletedAt: null,
      ...(fullyRefunded.length ? { id: { notIn: fullyRefunded } } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: opts.take ?? 60,
    include: { category: true, payments: { include: { account: true } }, fundEntry: { include: { fund: true } } },
  });
  if (opts.includeId && !rows.some((r) => r.id === opts.includeId)) {
    const extra = await prisma.transaction.findFirst({
      where: { id: opts.includeId, bookId: ctx.book.id, type: "EXPENSE", status: "POSTED", deletedAt: null },
      include: { category: true, payments: { include: { account: true } }, fundEntry: { include: { fund: true } } },
    });
    if (extra) rows.unshift(extra);
  }
  const refunded = await refundedByTransaction(prisma, ctx.book.id, rows.map((r) => r.id));
  return rows
    .map((r) => {
      const done = refunded.get(r.id) ?? 0;
      const acc = r.payments[0]?.account;
      return {
        id: r.id,
        title: r.title || r.merchant || r.category?.name || "消費",
        occurredOn: r.occurredAt,
        amount: r.amount,
        refunded: done,
        refundable: Math.max(0, r.amount - done),
        accountName: acc?.name ?? "",
        accountId: acc?.id ?? "",
        // 只給名字：圖示要用 <ArtIcon> 畫出來，串進字串會變成「piggy-bank 日本旅遊」
        fundName: r.fundEntry && !r.fundEntry.deletedAt ? r.fundEntry.fund.name : null,
      };
    })
    .filter((r) => r.refundable > 0 || r.id === opts.includeId);
}

/** 某筆消費的退款紀錄（詳細頁用）。 */
export async function refundsOf(ctx: BookContext, originalId: string) {
  return prisma.transaction.findMany({
    where: { bookId: ctx.book.id, type: "REFUND", relatedId: originalId, deletedAt: null, status: "POSTED" },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    include: TX_INCLUDE,
  });
}
