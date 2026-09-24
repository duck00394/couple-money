/**
 * 共同基金。
 *
 *   實際基金金額：FundTransaction（投入／取回／基金支出／獎金入金）加總，每一筆都掛在某個帳戶的「指定額度」上
 *   尚未入金獎金：TaskReward − TaskPenalty（尚未結算），只是承諾，不是現金，不影響任何帳戶
 *   帳戶可自由使用：帳戶餘額 − 已指定給基金；投入基金不得超過它
 */
import { Prisma, type FundTxType } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { buildTransferLines } from "../domain/ledger";
import { progressOf, REAL_FUND_TX_TYPES, signedFundAmount, summarizeFund, summarizePending, type FundEntry, type PendingSummary } from "../domain/fund";
import { MAX_AMOUNT, formatMoney } from "@/lib/money";
import { fromDateKey, keyToDbDate } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { assertFresh } from "./conflict";
import { toIconKey } from "../../lib/icons";

type Client = Tx | typeof prisma;
const REQ_ID = /^[\w:-]{8,80}$/;
const REAL = { in: [...REAL_FUND_TX_TYPES] as FundTxType[] };

export async function auditIn(tx: Client, ctx: BookContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  const json = (v: unknown) => (v === null || v === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));
  await tx.auditLog.create({
    data: { bookId: ctx.book.id, actorId: ctx.me.userId, action, entityType, entityId, before: json(before), after: json(after) },
  });
}

// ───────────────────────── 金額（一律由紀錄加總） ─────────────────────────

/** 實際基金金額 */
export async function fundBalances(client: Client, bookId: string, fundIds?: string[]) {
  const rows = await client.fundTransaction.groupBy({
    by: ["fundId"],
    where: { bookId, deletedAt: null, type: REAL, ...(fundIds ? { fundId: { in: fundIds } } : {}) },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.fundId, r._sum.amount ?? 0]));
}

async function fundBalance(client: Client, bookId: string, fundId: string) {
  return (await fundBalances(client, bookId, [fundId])).get(fundId) ?? 0;
}

/** 每個帳戶已指定給基金的金額（所有基金加總）。 */
export async function earmarkedByAccount(client: Client, bookId: string) {
  const rows = await client.fundTransaction.groupBy({
    by: ["accountId"],
    where: { bookId, deletedAt: null, type: REAL, accountId: { not: null } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.accountId!, r._sum.amount ?? 0]));
}

/** 某個基金在各帳戶的指定額度。excludeTransactionId：編輯消費時排除自己原本的那筆。 */
async function fundAllocations(client: Client, bookId: string, fundId: string, excludeTransactionId?: string) {
  const rows = await client.fundTransaction.groupBy({
    by: ["accountId"],
    where: {
      bookId,
      fundId,
      deletedAt: null,
      type: REAL,
      accountId: { not: null },
      ...(excludeTransactionId ? { OR: [{ transactionId: null }, { transactionId: { not: excludeTransactionId } }] } : {}),
    },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.accountId!, r._sum.amount ?? 0]));
}

async function accountBalance(client: Client, accountId: string) {
  const r = await client.transactionPayment.aggregate({
    where: { accountId, transaction: { deletedAt: null, status: "POSTED" } },
    _sum: { amount: true },
  });
  return -(r._sum.amount ?? 0);
}

/** 帳戶可自由使用金額 = 帳戶餘額 − 已指定給基金。 */
export async function accountFreeAmount(client: Client, bookId: string, accountId: string) {
  const [balance, earmarked] = await Promise.all([accountBalance(client, accountId), earmarkedByAccount(client, bookId)]);
  const e = earmarked.get(accountId) ?? 0;
  return { balance, earmarked: e, free: balance - e };
}

/** 尚未入金的獎金與懲罰（依基金）。 */
export async function pendingByFund(client: Client, bookId: string, fundIds?: string[]) {
  const where = { bookId, depositEntryId: null, ...(fundIds ? { fundId: { in: fundIds } } : { fundId: { not: null } }) };
  const [rewards, penalties] = await Promise.all([
    client.taskReward.findMany({ where: { ...where, deletedAt: null }, select: { fundId: true, userId: true, amount: true } }),
    client.taskPenalty.findMany({ where: { ...where, waivedAt: null, amount: { gt: 0 } }, select: { fundId: true, userId: true, amount: true } }),
  ]);
  const ids = new Set([...rewards, ...penalties].map((x) => x.fundId!));
  const result = new Map<string, PendingSummary>();
  for (const id of ids) {
    result.set(id, summarizePending(rewards.filter((r) => r.fundId === id), penalties.filter((p) => p.fundId === id)));
  }
  return result;
}

const emptyPending = (): PendingSummary => summarizePending([], []);

async function loadAccount(client: Client, ctx: BookContext, accountId: string | null, label: string) {
  assert(accountId, "FUND_ACCOUNT_REQUIRED", `請選擇${label}`);
  const acc = await client.account.findFirst({ where: { id: accountId, bookId: ctx.book.id, deletedAt: null } });
  assert(acc, "FUND_ACCOUNT", "帳戶不存在");
  return acc;
}

// ───────────────────────── 基金 ─────────────────────────

export interface FundInput {
  name: string;
  emoji?: string;
  description?: string;
  targetAmount: number | null;
  dueDate: string | null;
}

function validateFund(input: FundInput) {
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 20, "FUND_NAME", "基金名稱需為 1～20 個字");
  assert((input.description ?? "").length <= 200, "FUND_DESC", "說明最多 200 個字");
  assert(
    input.targetAmount === null || (Number.isSafeInteger(input.targetAmount) && input.targetAmount > 0 && input.targetAmount <= MAX_AMOUNT),
    "FUND_TARGET",
    "目標金額不正確",
  );
  if (input.dueDate) {
    try {
      fromDateKey(input.dueDate);
    } catch {
      throw new DomainError("FUND_DUE", "到期日期格式不正確");
    }
  }
  return {
    name,
    emoji: toIconKey(input.emoji ?? "piggy-bank"),
    description: input.description?.trim() || null,
    targetAmount: input.targetAmount,
    dueDate: input.dueDate ? keyToDbDate(input.dueDate) : null,
  };
}

export async function createFund(ctx: BookContext, input: FundInput, client: Client = prisma) {
  assertCanWrite(ctx);
  const data = validateFund(input);
  const fund = await client.fund.create({ data: { ...data, bookId: ctx.book.id, createdById: ctx.me.userId } });
  await auditIn(client, ctx, "CREATE", "Fund", fund.id, null, data);
  return fund;
}

export async function updateFund(ctx: BookContext, fundId: string, input: FundInput & { isArchived: boolean }, expectedUpdatedAt?: string | null) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.fund.findFirst({ where: { id: fundId, bookId: ctx.book.id, deletedAt: null } });
    assert(before, "FUND_NOT_FOUND", "找不到基金");
    assertFresh(before, expectedUpdatedAt, "個基金");
    const data = validateFund(input);
    await tx.fund.update({ where: { id: fundId }, data: { ...data, isArchived: input.isArchived } });
    await auditIn(tx, ctx, "UPDATE", "Fund", fundId, before, { ...data, isArchived: input.isArchived });
  });
}

/** 檢查基金是否可以刪除（申請與同意時都會檢查）。 */
export async function assertFundDeletable(client: Client, ctx: BookContext, fundId: string) {
  const fund = await client.fund.findFirst({ where: { id: fundId, bookId: ctx.book.id, deletedAt: null } });
  assert(fund, "FUND_NOT_FOUND", "找不到基金");
  const balance = await fundBalance(client, ctx.book.id, fundId);
  assert(balance === 0, "FUND_NOT_EMPTY", `基金實際金額還有 ${formatMoney(balance)}，請先取回或改用封存`);
  const pending = (await pendingByFund(client, ctx.book.id, [fundId])).get(fundId);
  assert(!pending || (pending.rewards === 0 && pending.penalties === 0), "FUND_HAS_PENDING", "還有尚未入金的獎金或懲罰，請先入金或改用封存");
  const usedByTask = await client.task.count({ where: { fundId, deletedAt: null } });
  assert(usedByTask === 0, "FUND_IN_USE", "還有任務把獎金存到這個基金，請先修改任務");
  return fund;
}

/** 真正刪除（只由刪除申請流程呼叫）。 */
export async function performDeleteFund(tx: Tx, ctx: BookContext, fundId: string) {
  const fund = await assertFundDeletable(tx, ctx, fundId);
  await tx.fund.update({ where: { id: fundId }, data: { deletedAt: new Date() } });
  await auditIn(tx, ctx, "DELETE", "Fund", fundId, fund, null);
}

export interface FundView {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  targetAmount: number | null;
  dueDate: Date | null;
  isArchived: boolean;
  /** 實際基金金額 */
  balance: number;
  /** 尚未入金淨額（獎金 − 懲罰） */
  pending: number;
  /** 實際金額的進度 */
  progress: number | null;
  /** 含尚未入金獎金的總進度 */
  totalProgress: number | null;
  remaining: number | null;
}

export async function listFunds(ctx: BookContext, opts: { includeArchived?: boolean } = {}): Promise<FundView[]> {
  const funds = await prisma.fund.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, ...(opts.includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ isArchived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const ids = funds.map((f) => f.id);
  const [bal, pend] = await Promise.all([fundBalances(prisma, ctx.book.id, ids), pendingByFund(prisma, ctx.book.id, ids)]);
  return funds.map((f) => {
    const balance = bal.get(f.id) ?? 0;
    const pending = pend.get(f.id)?.net ?? 0;
    return {
      id: f.id,
      name: f.name,
      emoji: f.emoji,
      description: f.description,
      targetAmount: f.targetAmount,
      dueDate: f.dueDate,
      isArchived: f.isArchived,
      balance,
      pending,
      progress: progressOf(balance, f.targetAmount),
      totalProgress: progressOf(balance + Math.max(0, pending), f.targetAmount),
      remaining: f.targetAmount ? Math.max(0, f.targetAmount - balance) : null,
    };
  });
}

export async function getFundDetail(ctx: BookContext, fundId: string) {
  const fund = await prisma.fund.findFirst({ where: { id: fundId, bookId: ctx.book.id, deletedAt: null } });
  if (!fund) return null;
  const [entries, pendingRewards, pendingPenalties] = await Promise.all([
    prisma.fundTransaction.findMany({
      where: { fundId, deletedAt: null, type: REAL },
      include: { transaction: { include: { category: true, payments: { include: { account: true } } } } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.taskReward.findMany({ where: { fundId, deletedAt: null, depositEntryId: null }, include: { task: true, checkIn: true }, orderBy: { createdAt: "desc" } }),
    prisma.taskPenalty.findMany({ where: { fundId, waivedAt: null, depositEntryId: null, amount: { gt: 0 } }, include: { task: true }, orderBy: { date: "desc" } }),
  ]);
  const summary = summarizeFund(entries as FundEntry[]);
  const pending = summarizePending(pendingRewards, pendingPenalties);
  return {
    fund,
    entries,
    summary,
    pending,
    pendingRewards,
    pendingPenalties,
    progress: progressOf(summary.balance, fund.targetAmount),
    totalProgress: progressOf(summary.balance + Math.max(0, pending.net), fund.targetAmount),
    remaining: fund.targetAmount ? Math.max(0, fund.targetAmount - summary.balance) : null,
  };
}

// ───────────────────────── 投入／取回 ─────────────────────────

export async function addFundEntry(
  ctx: BookContext,
  input: {
    fundId: string;
    type: "DEPOSIT" | "WITHDRAW";
    amount: number;
    userId: string | null;
    accountId: string | null;
    note: string;
    occurredOn: string;
    clientRequestId: string;
  },
) {
  assertCanWrite(ctx);
  assert(REQ_ID.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  assert(input.type === "DEPOSIT" || input.type === "WITHDRAW", "FUND_TYPE", "不支援的類型");
  assert(input.amount <= MAX_AMOUNT, "FUND_AMOUNT", "金額太大");
  const amount = signedFundAmount(input.type, input.amount);
  assert(input.note.length <= 200, "FUND_NOTE", "備註最多 200 個字");
  assert(input.userId === null || ctx.members.some((m) => m.userId === input.userId), "FUND_USER", "投入者必須是帳本成員");
  let occurredAt: Date;
  try {
    occurredAt = fromDateKey(input.occurredOn);
  } catch {
    throw new DomainError("FUND_DATE", "日期格式不正確");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const dup = await tx.fundTransaction.findUnique({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
      if (dup) return dup;
      const fund = await tx.fund.findFirst({ where: { id: input.fundId, bookId: ctx.book.id, deletedAt: null } });
      assert(fund, "FUND_NOT_FOUND", "找不到基金");
      assert(!fund.isArchived, "FUND_ARCHIVED", "基金已封存");
      const acc = await loadAccount(tx, ctx, input.accountId, input.type === "DEPOSIT" ? "錢放在哪個帳戶" : "從哪個帳戶的額度取回");
      if (input.type === "DEPOSIT") {
        const { free } = await accountFreeAmount(tx, ctx.book.id, acc.id);
        assert(
          input.amount <= free,
          "FUND_OVER_FREE",
          `「${acc.name}」可自由使用的金額只剩 ${formatMoney(Math.max(0, free))}，不能投入 ${formatMoney(input.amount)}。基金只能指定帳戶裡真的有、還沒被其他基金指定的錢。`,
        );
      } else {
        const alloc = (await fundAllocations(tx, ctx.book.id, fund.id)).get(acc.id) ?? 0;
        assert(input.amount <= alloc, "FUND_ALLOCATION_INSUFFICIENT", `「${acc.name}」裡指定給這個基金的只有 ${formatMoney(Math.max(0, alloc))}`);
      }
      const entry = await tx.fundTransaction.create({
        data: {
          bookId: ctx.book.id,
          fundId: fund.id,
          type: input.type,
          amount,
          userId: input.userId,
          accountId: acc.id,
          occurredAt,
          note: input.note.trim() || null,
          clientRequestId: input.clientRequestId,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
        },
      });
      await auditIn(tx, ctx, "CREATE", "FundTransaction", entry.id, null, entry);
      return entry;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.fundTransaction.findUniqueOrThrow({
        where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } },
      });
    }
    throw e;
  }
}

/** 取消投入／取回。取消後：該帳戶對這個基金的額度不可為負、帳戶可自由使用金額不可為負。 */
export async function cancelFundEntry(ctx: BookContext, entryId: string) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const e = await tx.fundTransaction.findFirst({ where: { id: entryId, bookId: ctx.book.id } });
    assert(e, "FUND_ENTRY_NOT_FOUND", "找不到紀錄");
    assert(e.type === "DEPOSIT" || e.type === "WITHDRAW", "FUND_ENTRY_SOURCE", "這筆紀錄請從原本的消費或獎金入金取消");
    if (e.deletedAt) return;
    await tx.fundTransaction.update({ where: { id: e.id }, data: { deletedAt: new Date(), deletedById: ctx.me.userId } });
    if (e.accountId) {
      const alloc = (await fundAllocations(tx, ctx.book.id, e.fundId)).get(e.accountId) ?? 0;
      assert(alloc >= 0, "FUND_NEGATIVE", "這筆投入已經被基金支出或取回用掉，不能取消");
      const { free } = await accountFreeAmount(tx, ctx.book.id, e.accountId);
      assert(e.type === "DEPOSIT" || free >= 0, "FUND_OVER_FREE", "帳戶可自由使用的金額不足，不能取消這筆取回");
    }
    await auditIn(tx, ctx, "DELETE", "FundTransaction", e.id, e, null);
  });
}

// ───────────────────────── 任務獎金入金 ─────────────────────────

/**
 * 把基金所有「尚未入金」的獎金（扣掉懲罰）實際入金：
 *   有來源帳戶：建立一筆帳戶間轉帳（來源 → 入金帳戶），來源帳戶可自由使用金額要夠
 *   沒有來源帳戶：錢已經在入金帳戶裡，只指定用途，入金帳戶可自由使用金額要夠
 * 之後建立 REWARD_DEPOSIT（實際基金金額 +），並把這些獎金／懲罰標記為已結算。
 */
export async function depositRewards(
  ctx: BookContext,
  input: { fundId: string; targetAccountId: string; sourceAccountId: string | null; note: string; occurredOn: string; clientRequestId: string },
) {
  assertCanWrite(ctx);
  assert(REQ_ID.test(input.clientRequestId), "TX_REQUEST_ID", "請重新整理頁面後再試");
  let occurredAt: Date;
  try {
    occurredAt = fromDateKey(input.occurredOn);
  } catch {
    throw new DomainError("FUND_DATE", "日期格式不正確");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const dup = await tx.fundTransaction.findUnique({ where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } } });
      if (dup) return dup;
      const fund = await tx.fund.findFirst({ where: { id: input.fundId, bookId: ctx.book.id, deletedAt: null } });
      assert(fund, "FUND_NOT_FOUND", "找不到基金");
      const [rewards, penalties] = await Promise.all([
        tx.taskReward.findMany({ where: { fundId: fund.id, deletedAt: null, depositEntryId: null } }),
        tx.taskPenalty.findMany({ where: { fundId: fund.id, waivedAt: null, depositEntryId: null, amount: { gt: 0 } } }),
      ]);
      const pending = summarizePending(rewards, penalties);
      assert(pending.rewards > 0, "REWARD_NOTHING", "目前沒有尚未入金的獎金");
      assert(pending.net > 0, "REWARD_NET_NEGATIVE", `懲罰（${formatMoney(pending.penalties)}）比獎金（${formatMoney(pending.rewards)}）多，目前不能入金`);
      const amount = pending.net;
      const target = await loadAccount(tx, ctx, input.targetAccountId, "入金到哪個帳戶");
      assert(target.type !== "CREDIT_CARD", "REWARD_TARGET_CARD", "不能入金到信用卡");

      let transactionId: string | null = null;
      if (input.sourceAccountId) {
        const source = await loadAccount(tx, ctx, input.sourceAccountId, "錢從哪個帳戶轉入");
        assert(source.id !== target.id, "TRANSFER_SAME", "來源帳戶和入金帳戶不能相同");
        assert(source.type !== "CREDIT_CARD", "TRANSFER_FROM_CARD", `「${source.name}」是信用卡，不能當轉出帳戶`);
        const { free } = await accountFreeAmount(tx, ctx.book.id, source.id);
        assert(amount <= free, "FUND_OVER_FREE", `「${source.name}」可自由使用的金額只剩 ${formatMoney(Math.max(0, free))}，不夠轉入 ${formatMoney(amount)}`);
        const lines = buildTransferLines(amount, { id: source.id, ownerId: source.ownerId }, { id: target.id, ownerId: target.ownerId });
        const t = await tx.transaction.create({
          data: {
            bookId: ctx.book.id,
            type: "TRANSFER",
            occurredAt,
            amount,
            title: `任務獎金入金：${fund.name}`,
            note: input.note.trim() || null,
            sourceType: "REWARD_DEPOSIT",
            sourceId: fund.id,
            clientRequestId: `reward-deposit:${input.clientRequestId}`,
            createdById: ctx.me.userId,
            updatedById: ctx.me.userId,
            payments: { create: lines.payments },
          },
        });
        transactionId = t.id;
      } else {
        const { free } = await accountFreeAmount(tx, ctx.book.id, target.id);
        assert(amount <= free, "FUND_OVER_FREE", `「${target.name}」可自由使用的金額只剩 ${formatMoney(Math.max(0, free))}，不夠入金 ${formatMoney(amount)}。請改選「錢從哪個帳戶轉入」。`);
      }

      const entry = await tx.fundTransaction.create({
        data: {
          bookId: ctx.book.id,
          fundId: fund.id,
          type: "REWARD_DEPOSIT",
          amount: signedFundAmount("REWARD_DEPOSIT", amount),
          userId: null,
          accountId: target.id,
          transactionId,
          occurredAt,
          note: input.note.trim() || `獎金 ${formatMoney(pending.rewards)}${pending.penalties ? ` − 懲罰 ${formatMoney(pending.penalties)}` : ""}`,
          sourceType: "TASK_REWARDS",
          sourceId: fund.id,
          clientRequestId: input.clientRequestId,
          createdById: ctx.me.userId,
          updatedById: ctx.me.userId,
        },
      });
      await tx.taskReward.updateMany({ where: { id: { in: rewards.map((r) => r.id) } }, data: { depositEntryId: entry.id } });
      if (penalties.length) await tx.taskPenalty.updateMany({ where: { id: { in: penalties.map((p) => p.id) } }, data: { depositEntryId: entry.id } });
      await auditIn(tx, ctx, "REWARD_DEPOSIT", "FundTransaction", entry.id, null, { amount, rewards: rewards.map((r) => r.id), penalties: penalties.map((p) => p.id), transactionId });
      return entry;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return prisma.fundTransaction.findUniqueOrThrow({ where: { bookId_clientRequestId: { bookId: ctx.book.id, clientRequestId: input.clientRequestId } } });
    }
    throw e;
  }
}

/** 取消獎金入金：轉帳與基金紀錄 soft delete，獎金／懲罰回到「尚未入金」。入金後已被用掉就不能取消。 */
export async function cancelRewardDeposit(ctx: BookContext, entryId: string) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const e = await tx.fundTransaction.findFirst({ where: { id: entryId, bookId: ctx.book.id } });
    assert(e, "FUND_ENTRY_NOT_FOUND", "找不到紀錄");
    assert(e.type === "REWARD_DEPOSIT", "FUND_ENTRY_SOURCE", "這不是獎金入金紀錄");
    if (e.deletedAt) return;
    const now = new Date();
    await tx.fundTransaction.update({ where: { id: e.id }, data: { deletedAt: now, deletedById: ctx.me.userId } });
    if (e.transactionId) await tx.transaction.update({ where: { id: e.transactionId }, data: { deletedAt: now, deletedById: ctx.me.userId } });
    await tx.taskReward.updateMany({ where: { depositEntryId: e.id }, data: { depositEntryId: null } });
    await tx.taskPenalty.updateMany({ where: { depositEntryId: e.id }, data: { depositEntryId: null } });
    const alloc = (await fundAllocations(tx, ctx.book.id, e.fundId)).get(e.accountId!) ?? 0;
    assert(alloc >= 0, "FUND_NEGATIVE", "入金後這筆錢已經被基金支出或取回用掉，不能取消");
    await auditIn(tx, ctx, "CANCEL", "FundTransaction", e.id, e, null);
  });
}

// ───────────────────────── 與消費連動（基金支出） ─────────────────────────

/**
 * 讓一筆消費與基金支出保持同步（由 ledger 服務在同一個 DB transaction 內呼叫）。
 * 基金支出只代表「這筆錢是基金的用途」：付款帳戶照常扣款、分帳照常產生欠款，不會扣兩次。
 * 會動用某個帳戶裡指定給這個基金的額度（預設優先用付款帳戶）。
 * fundId === undefined：不變動；null：取消連結；字串：連結／更新。
 */
export async function syncFundExpense(
  tx: Tx,
  ctx: BookContext,
  t: { id: string; type: string; amount: number; occurredAt: Date; deletedAt?: Date | null },
  payer: { accountId: string; userId: string | null } | null,
  fundId: string | null | undefined,
  fundAccountId?: string | null,
) {
  if (fundId === undefined) return;
  const existing = await tx.fundTransaction.findUnique({ where: { transactionId: t.id } });
  const shouldLink = !!fundId && t.type === "EXPENSE" && !t.deletedAt;
  if (!shouldLink) {
    if (existing && !existing.deletedAt) {
      await tx.fundTransaction.update({ where: { id: existing.id }, data: { deletedAt: new Date(), deletedById: ctx.me.userId } });
    }
    return;
  }
  const fund = await tx.fund.findFirst({ where: { id: fundId, bookId: ctx.book.id, deletedAt: null } });
  assert(fund, "FUND_NOT_FOUND", "找不到基金");
  assert(!fund.isArchived || existing?.fundId === fund.id, "FUND_ARCHIVED", "基金已封存");

  const alloc = await fundAllocations(tx, ctx.book.id, fund.id, t.id);
  const total = [...alloc.values()].reduce((a, b) => a + b, 0);
  // 基金整體就不夠 → 先給比較好懂的訊息
  assert(
    total >= t.amount,
    "FUND_OVER_BALANCE",
    `「${fund.name}」實際金額只有 ${formatMoney(Math.max(0, total))}，不夠支出 ${formatMoney(t.amount)}（尚未入金的獎金不能拿來付款）`,
  );
  // 產品規則：一定要由使用者指定動用哪個帳戶的額度，系統不會自己挑別的帳戶
  assert(fundAccountId, "FUND_ACCOUNT_REQUIRED", `請選擇要動用哪個帳戶裡指定給「${fund.name}」的額度`);
  const fundAcc = await tx.account.findFirst({ where: { id: fundAccountId, bookId: ctx.book.id, deletedAt: null } });
  assert(fundAcc, "FUND_ACCOUNT", "找不到這個帳戶");
  assert(fundAcc.isActive || existing?.accountId === fundAccountId, "FUND_ACCOUNT_INACTIVE", `「${fundAcc.name}」已停用，請選擇其他帳戶`);
  const have = alloc.get(fundAccountId) ?? 0;
  assert(
    have >= t.amount,
    "FUND_ALLOCATION_INSUFFICIENT",
    `「${fundAcc.name}」裡指定給「${fund.name}」的額度只有 ${formatMoney(Math.max(0, have))}，不夠這筆 ${formatMoney(t.amount)}。請改選其他帳戶，或先把基金的錢移過去。`,
  );
  const accountId = fundAccountId;
  const data = {
    fundId: fund.id,
    type: "EXPENSE" as FundTxType,
    amount: signedFundAmount("EXPENSE", t.amount),
    userId: payer?.userId ?? null,
    accountId,
    occurredAt: t.occurredAt,
    sourceType: "TRANSACTION",
    sourceId: t.id,
    updatedById: ctx.me.userId,
  };
  if (existing) {
    await tx.fundTransaction.update({ where: { id: existing.id }, data: { ...data, deletedAt: null, deletedById: null } });
  } else {
    await tx.fundTransaction.create({
      data: { ...data, bookId: ctx.book.id, transactionId: t.id, clientRequestId: `tx:${t.id}`, createdById: ctx.me.userId },
    });
  }
}

/** 記帳表單用：每個基金在各帳戶的指定額度。 */
export async function allocationsForForm(ctx: BookContext) {
  const rows = await prisma.fundTransaction.groupBy({
    by: ["fundId", "accountId"],
    where: { bookId: ctx.book.id, deletedAt: null, type: REAL, accountId: { not: null } },
    _sum: { amount: true },
  });
  return rows.filter((r) => (r._sum.amount ?? 0) > 0).map((r) => ({ fundId: r.fundId, accountId: r.accountId!, amount: r._sum.amount ?? 0 }));
}

export { emptyPending };
