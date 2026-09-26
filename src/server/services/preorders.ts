/**
 * 預購訂單。
 *
 * 這一層只做三件事：建立／修改訂單、把付款串到訂單上、算出「已付／待結」。
 *
 * **完全沒有第二套付款系統**：每一次付款都是用既有的 `createTransaction()`
 * 建立一筆普通的 EXPENSE，只是多帶一個 preorderId。所以帳戶餘額、分帳、
 * 統計、CSV、退款、交易明細全部自動沿用同一套邏輯，一行都沒有改。
 *
 * **待結款不是支出**：還沒付的錢仍然在帳戶裡，不扣餘額、不進統計。
 * 已付與待結一律由 Transaction 現算，訂單本身不存任何金額狀態。
 */
import { prisma } from "../db";
import { assert } from "../domain/errors";
import { moneyOf, stateOf, sortKey, daysUntil, type PreorderMoney, type PreorderState } from "../domain/preorder";
import { MAX_AMOUNT } from "@/lib/money";
import { dbDateToKey, keyToDbDate, toDateKey } from "@/lib/dates";
import { toIconKey } from "@/lib/icons";
import { assertCanWrite, type BookContext } from "./books";
import { createTransaction, type TransactionInput } from "./ledger";
import { refundedByTransaction } from "./transfers";
import { auditIn } from "./funds";

export interface PreorderInput {
  name: string;
  seller: string;
  emoji: string;
  expectedOn: string | null;
  itemAmount: number;
  shipping: number;
  /** null = 共同 */
  ownerId: string | null;
  note: string;
}

function validate(ctx: BookContext, input: PreorderInput) {
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 40, "PREORDER_NAME", "品名需為 1～40 個字");
  assert(Number.isInteger(input.itemAmount) && input.itemAmount > 0 && input.itemAmount <= MAX_AMOUNT, "PREORDER_AMOUNT", "請輸入正確的商品金額");
  assert(Number.isInteger(input.shipping) && input.shipping >= 0 && input.shipping <= MAX_AMOUNT, "PREORDER_SHIPPING", "請輸入正確的運費");
  assert(input.seller.length <= 40, "PREORDER_SELLER", "賣家最多 40 個字");
  assert(input.note.length <= 200, "PREORDER_NOTE", "備註最多 200 個字");
  assert(input.ownerId === null || ctx.members.some((m) => m.userId === input.ownerId), "PREORDER_OWNER", "請選擇這是誰的預購");
  return {
    name,
    seller: input.seller.trim() || null,
    emoji: toIconKey(input.emoji || "package"),
    expectedOn: input.expectedOn ? keyToDbDate(input.expectedOn) : null,
    itemAmount: input.itemAmount,
    shipping: input.shipping,
    ownerId: input.ownerId,
    note: input.note.trim() || null,
  };
}

export async function createPreorder(ctx: BookContext, input: PreorderInput) {
  assertCanWrite(ctx);
  const data = validate(ctx, input);
  const row = await prisma.preorder.create({ data: { ...data, bookId: ctx.book.id, createdById: ctx.me.userId } });
  await auditIn(prisma, ctx, "CREATE", "Preorder", row.id, null, data);
  return row;
}

export async function updatePreorder(ctx: BookContext, id: string, input: PreorderInput) {
  assertCanWrite(ctx);
  const before = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  assert(before, "PREORDER_NOT_FOUND", "找不到這張預購");
  const data = validate(ctx, input);
  const row = await prisma.preorder.update({ where: { id }, data });
  await auditIn(prisma, ctx, "UPDATE", "Preorder", id, before, data);
  return row;
}

/**
 * 取消／恢復訂單。
 * 取消**不會**自動產生任何金流 —— 已經付出去的錢仍然是已付。
 * 如果實際收到退款，請到那筆付款上走既有的退款流程，這樣「取消但不退款」
 * 也不會留下錯誤的財務紀錄。
 */
export async function setPreorderCancelled(ctx: BookContext, id: string, cancelled: boolean) {
  assertCanWrite(ctx);
  const before = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  assert(before, "PREORDER_NOT_FOUND", "找不到這張預購");
  const row = await prisma.preorder.update({ where: { id }, data: { cancelledAt: cancelled ? new Date() : null } });
  await auditIn(prisma, ctx, cancelled ? "CANCEL" : "REOPEN", "Preorder", id, before, { cancelledAt: row.cancelledAt });
  return row;
}

/** 刪除訂單。付款紀錄不會跟著消失，只是不再屬於任何一張預購。 */
export async function deletePreorder(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  const before = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  assert(before, "PREORDER_NOT_FOUND", "找不到這張預購");
  await prisma.$transaction(async (tx) => {
    await tx.transaction.updateMany({ where: { preorderId: id }, data: { preorderId: null } });
    await tx.preorder.update({ where: { id }, data: { deletedAt: new Date() } });
    await auditIn(tx, ctx, "DELETE", "Preorder", id, before, null);
  });
}

export interface PreorderView {
  id: string;
  name: string;
  seller: string | null;
  emoji: string;
  expectedOn: string | null;
  itemAmount: number;
  shipping: number;
  ownerId: string | null;
  note: string | null;
  money: PreorderMoney;
  state: PreorderState;
  daysLeft: number | null;
  payments: Array<{ id: string; amount: number; occurredOn: string; title: string | null; refunded: number }>;
}

/** 把一批訂單加上「已付／待結」。金額一律由 Transaction 現算。 */
async function withMoney(bookId: string, rows: Array<Awaited<ReturnType<typeof createPreorder>>>, today: string): Promise<PreorderView[]> {
  const ids = rows.map((r) => r.id);
  // 有效的付款：這張單底下沒被作廢的 EXPENSE
  const txs = ids.length
    ? await prisma.transaction.findMany({
        where: { bookId, preorderId: { in: ids }, type: "EXPENSE", status: "POSTED", deletedAt: null },
        select: { id: true, preorderId: true, amount: true, occurredAt: true, title: true },
        orderBy: { occurredAt: "asc" },
      })
    : [];
  // 退款沿用既有的計算，不自己重算
  const refunds = await refundedByTransaction(prisma, bookId, txs.map((t) => t.id));

  return rows.map((r) => {
    const mine = txs.filter((t) => t.preorderId === r.id);
    const gross = mine.reduce((a, t) => a + t.amount, 0);
    const refunded = mine.reduce((a, t) => a + (refunds.get(t.id) ?? 0), 0);
    // 取消掉的訂單「不用再付了」，所以待結一律是 0；已付的錢不會憑空消失，
    // 真的有退款時走既有的退款流程，退款會自己把已付降回去。
    const raw = moneyOf(r.itemAmount, r.shipping, gross, refunded);
    const money = r.cancelledAt ? { ...raw, remaining: 0 } : raw;
    const expectedOn = r.expectedOn ? dbDateToKey(r.expectedOn) : null;
    return {
      id: r.id,
      name: r.name,
      seller: r.seller,
      emoji: r.emoji,
      expectedOn,
      itemAmount: r.itemAmount,
      shipping: r.shipping,
      ownerId: r.ownerId,
      note: r.note,
      money,
      state: stateOf(r.cancelledAt, money),
      daysLeft: daysUntil(expectedOn, today),
      payments: mine.map((t) => ({
        id: t.id,
        amount: t.amount,
        occurredOn: dbDateToKey(t.occurredAt),
        title: t.title,
        refunded: refunds.get(t.id) ?? 0,
      })),
    };
  });
}

export async function listPreorders(ctx: BookContext, opts: { today?: string } = {}): Promise<PreorderView[]> {
  const today = opts.today ?? toDateKey(new Date());
  const rows = await prisma.preorder.findMany({ where: { bookId: ctx.book.id, deletedAt: null } });
  const views = await withMoney(ctx.book.id, rows, today);
  return views.sort((a, b) => {
    const ka = sortKey(a.state, a.expectedOn, a.daysLeft);
    const kb = sortKey(b.state, b.expectedOn, b.daysLeft);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]) || a.name.localeCompare(b.name);
  });
}

export async function getPreorder(ctx: BookContext, id: string, opts: { today?: string } = {}) {
  const today = opts.today ?? toDateKey(new Date());
  const row = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  if (!row) return null;
  return (await withMoney(ctx.book.id, [row], today))[0];
}

/** 首頁提醒用：還在進行中、還有待結款的訂單。 */
export async function pendingPreorders(ctx: BookContext, opts: { today?: string } = {}) {
  const list = await listPreorders(ctx, opts);
  const open = list.filter((p) => p.state === "ACTIVE");
  return { count: open.length, remaining: open.reduce((a, p) => a + p.money.remaining, 0), soonest: open[0] ?? null };
}

/**
 * 記錄一次付款：建立一筆普通的 EXPENSE，並掛到這張預購單上。
 *
 * 這裡**沒有任何自己的金額計算**——金額、帳戶、分帳、基金全部交給
 * `createTransaction()`，跟使用者手動記一筆完全走同一條路。
 */
export async function payPreorder(
  ctx: BookContext,
  id: string,
  input: Omit<TransactionInput, "type" | "preorderId"> & { type?: "EXPENSE" },
) {
  assertCanWrite(ctx);
  const po = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  assert(po, "PREORDER_NOT_FOUND", "找不到這張預購");
  return createTransaction(ctx, { ...input, type: "EXPENSE", preorderId: id });
}
