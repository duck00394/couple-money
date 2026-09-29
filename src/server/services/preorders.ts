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
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { assert } from "../domain/errors";
import { itemsTotal, moneyOf, sharesOf, stateOf, sortKey, daysUntil, type PreorderMoney, type PreorderShare, type PreorderState } from "../domain/preorder";
import { computeSplit, type SplitRule } from "../domain/split";
import { formatMoney, MAX_AMOUNT } from "@/lib/money";
import { dbDateToKey, keyToDbDate, toDateKey } from "@/lib/dates";
import { toIconKey } from "@/lib/icons";
import { assertCanWrite, type BookContext } from "./books";
import { createTransaction, type TransactionInput } from "./ledger";
import { refundedByTransaction } from "./transfers";
import { auditIn } from "./funds";

export interface PreorderItemInput {
  name: string;
  unitAmount: number;
  qty: number;
  /** null = 共同 */
  ownerId: string | null;
}

export interface PreorderInput {
  name: string;
  seller: string;
  emoji: string;
  expectedOn: string | null;
  /** 沒有明細品項時用這個；有明細品項時會被它們的加總蓋掉 */
  itemAmount: number;
  shipping: number;
  /** null = 共同。沒設分帳規則時，它決定誰付多少 */
  ownerId: string | null;
  note: string;
  /** 誰付多少（沿用既有的分帳規則）。undefined = 不變動、null = 清掉回到依 ownerId */
  splitRule?: SplitRule | null;
  /** 明細品項。undefined = 不變動、[] = 清空 */
  items?: PreorderItemInput[];
  /** 付款時預設帶的分類（統計才不會整包落在「未分類」）。null = 不帶 */
  categoryId?: string | null;
}

/** 明細品項：檢查每一列，並回傳寫進資料庫的樣子。 */
function validateItems(ctx: BookContext, items: PreorderItemInput[]) {
  assert(items.length <= 50, "PREORDER_ITEMS", "明細品項最多 50 項");
  return items.map((it, i) => {
    const name = it.name.trim();
    assert(name.length >= 1 && name.length <= 40, "PREORDER_ITEM_NAME", "每個品項都要有 1～40 個字的名稱");
    assert(Number.isInteger(it.unitAmount) && it.unitAmount > 0 && it.unitAmount <= MAX_AMOUNT, "PREORDER_ITEM_AMOUNT", `「${name}」的單價不正確`);
    assert(Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= 999, "PREORDER_ITEM_QTY", `「${name}」的數量要在 1～999 之間`);
    assert(it.ownerId === null || ctx.members.some((m) => m.userId === it.ownerId), "PREORDER_ITEM_OWNER", `「${name}」的「誰的」不正確`);
    return { name, unitAmount: it.unitAmount, qty: it.qty, ownerId: it.ownerId, sortOrder: i };
  });
}

/**
 * 誰付多少：沿用既有的分帳規則引擎驗證，錯的規則不會被存下來。
 * 用的是「應付總額」去算，所以 AMOUNT 規則的加總必須剛好等於應付總額。
 */
function validateSplit(ctx: BookContext, rule: SplitRule | null | undefined, total: number) {
  if (rule === undefined) return undefined;
  if (rule === null) return null;
  const ids = new Set(ctx.members.map((m) => m.userId));
  assert(rule.participants.length > 0 && rule.participants.every((p) => ids.has(p.userId)), "PREORDER_SPLIT", "「誰付多少」的對象必須是帳本成員");
  assert(total > 0, "PREORDER_SPLIT", "要先有應付總額才能設定誰付多少");
  computeSplit(total, rule); // 算不出來就直接丟既有的分帳錯誤訊息
  return rule;
}

function validate(ctx: BookContext, input: PreorderInput) {
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 40, "PREORDER_NAME", "品名需為 1～40 個字");
  const items = input.items === undefined ? undefined : validateItems(ctx, input.items);
  // 有明細品項時，商品金額一律是它們的加總，不吃傳進來的數字
  const itemAmount = items && items.length > 0 ? itemsTotal(items) : input.itemAmount;
  assert(Number.isInteger(itemAmount) && itemAmount > 0 && itemAmount <= MAX_AMOUNT, "PREORDER_AMOUNT", "請輸入正確的商品金額");
  assert(Number.isInteger(input.shipping) && input.shipping >= 0 && input.shipping <= MAX_AMOUNT, "PREORDER_SHIPPING", "請輸入正確的運費");
  assert(input.seller.length <= 40, "PREORDER_SELLER", "賣家最多 40 個字");
  assert(input.note.length <= 200, "PREORDER_NOTE", "備註最多 200 個字");
  assert(input.ownerId === null || ctx.members.some((m) => m.userId === input.ownerId), "PREORDER_OWNER", "請選擇這是誰的預購");
  const splitRule = validateSplit(ctx, input.splitRule, itemAmount + input.shipping);
  return {
    data: {
      categoryId: input.categoryId ?? null,
      name,
      seller: input.seller.trim() || null,
      emoji: toIconKey(input.emoji || "package"),
      expectedOn: input.expectedOn ? keyToDbDate(input.expectedOn) : null,
      itemAmount,
      shipping: input.shipping,
      ownerId: input.ownerId,
      note: input.note.trim() || null,
      ...(splitRule !== undefined ? { splitRule: splitRule as unknown as Prisma.InputJsonValue | typeof Prisma.DbNull } : {}),
    },
    items,
  };
}

export async function createPreorder(ctx: BookContext, input: PreorderInput) {
  assertCanWrite(ctx);
  const { data, items } = validate(ctx, input);
  const row = await prisma.preorder.create({
    data: {
      ...data,
      bookId: ctx.book.id,
      createdById: ctx.me.userId,
      ...(items && items.length > 0 ? { items: { create: items } } : {}),
    },
  });
  await auditIn(prisma, ctx, "CREATE", "Preorder", row.id, null, { ...data, items });
  return row;
}

export async function updatePreorder(ctx: BookContext, id: string, input: PreorderInput) {
  assertCanWrite(ctx);
  const before = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  assert(before, "PREORDER_NOT_FOUND", "找不到這張預購");
  const { data, items } = validate(ctx, input);

  // 把總額改到低於已付金額是合理的（降價、少買一件），所以不阻擋；
  // 但要讓這件事在動態紀錄裡看得出來，之後對帳才知道超付是哪一次改出來的。
  const paidBefore = (await getPreorder(ctx, id))?.money.paid ?? 0;
  const newTotal = data.itemAmount + data.shipping;
  const overpaidAfter = Math.max(0, paidBefore - newTotal);

  const row = await prisma.$transaction(async (tx) => {
    // 明細品項整批換掉：數量會變、順序會變，一列一列比對沒有意義
    if (items !== undefined) {
      await tx.preorderItem.deleteMany({ where: { preorderId: id } });
      if (items.length > 0) await tx.preorderItem.createMany({ data: items.map((it) => ({ ...it, preorderId: id })) });
    }
    return tx.preorder.update({ where: { id }, data });
  });
  await auditIn(prisma, ctx, "UPDATE", "Preorder", id, before, {
    ...data,
    items,
    ...(overpaidAfter > 0 ? { paidBefore, overpaidAfter } : {}),
  });
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
  /** 每個人應負擔／已負擔／還需付多少 */
  shares: PreorderShare[];
  /** 誰付多少的規則；null = 依「誰的」（共同就平分） */
  splitRule: SplitRule | null;
  /** 付款時預設帶的分類 */
  categoryId: string | null;
  /** 明細品項（沒有就是空的，商品金額由上面那個欄位決定） */
  items: Array<{ id: string; name: string; unitAmount: number; qty: number; ownerId: string | null; total: number }>;
  state: PreorderState;
  daysLeft: number | null;
  payments: Array<{ id: string; amount: number; occurredOn: string; title: string | null; refunded: number }>;
}

/** 把一批訂單加上「已付／待結」。金額一律由 Transaction 現算。 */
export const PREORDER_INCLUDE = { items: { orderBy: { sortOrder: "asc" } } } as const;
type PreorderRow = Prisma.PreorderGetPayload<{ include: typeof PREORDER_INCLUDE }>;

async function withMoney(
  bookId: string,
  memberIds: string[],
  rows: PreorderRow[],
  today: string,
): Promise<PreorderView[]> {
  const ids = rows.map((r) => r.id);
  // 有效的付款：這張單底下沒被作廢的 EXPENSE
  const txs = ids.length
    ? await prisma.transaction.findMany({
        where: { bookId, preorderId: { in: ids }, type: "EXPENSE", status: "POSTED", deletedAt: null },
        select: {
          id: true, preorderId: true, amount: true, occurredAt: true, title: true,
          // 「已負擔」直接用既有的分帳結果，預購這邊不另外發明一套分法
          splits: { select: { userId: true, amount: true } },
        },
        orderBy: { occurredAt: "asc" },
      })
    : [];
  // 退款沿用既有的計算，不自己重算
  const refunds = await refundedByTransaction(prisma, bookId, txs.map((t) => t.id));
  // 退款的分帳（負數）也要算進「已負擔」：退了錢的人就少負擔
  const refundSplits = txs.length
    ? await prisma.transaction.findMany({
        where: { bookId, type: "REFUND", status: "POSTED", deletedAt: null, relatedId: { in: txs.map((t) => t.id) } },
        select: { relatedId: true, splits: { select: { userId: true, amount: true } } },
      })
    : [];

  return rows.map((r) => {
    const mine = txs.filter((t) => t.preorderId === r.id);
    const gross = mine.reduce((a, t) => a + t.amount, 0);
    const refunded = mine.reduce((a, t) => a + (refunds.get(t.id) ?? 0), 0);
    // 取消掉的訂單「不用再付了」，所以待結一律是 0；已付的錢不會憑空消失，
    // 真的有退款時走既有的退款流程，退款會自己把已付降回去。
    const raw = moneyOf(r.itemAmount, r.shipping, gross, refunded);
    const money = r.cancelledAt ? { ...raw, remaining: 0 } : raw;
    const borne = new Map<string, number>();
    const add = (userId: string, amount: number) => borne.set(userId, (borne.get(userId) ?? 0) + amount);
    for (const t of mine) for (const sp of t.splits) add(sp.userId, sp.amount);
    for (const rf of refundSplits) {
      if (!mine.some((t) => t.id === rf.relatedId)) continue;
      for (const sp of rf.splits) add(sp.userId, sp.amount);
    }
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
      splitRule: (r.splitRule as unknown as SplitRule | null) ?? null,
      categoryId: r.categoryId,
      items: r.items.map((it) => ({
        id: it.id, name: it.name, unitAmount: it.unitAmount, qty: it.qty,
        ownerId: it.ownerId, total: it.unitAmount * it.qty,
      })),
      // 取消的單子不用再付了，每個人的「還需付」也一起歸零
      shares: sharesOf(
        r.cancelledAt ? 0 : money.total,
        (r.splitRule as unknown as SplitRule | null) ?? null,
        r.ownerId,
        memberIds,
        borne,
        // 沒有存分帳規則時，「依『誰的』」要看每個品項標的是誰，不是一律平分
        r.items.map((it) => ({ name: it.name, unitAmount: it.unitAmount, qty: it.qty, ownerId: it.ownerId })),
      ),
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
  const rows = await prisma.preorder.findMany({ where: { bookId: ctx.book.id, deletedAt: null }, include: PREORDER_INCLUDE });
  const views = await withMoney(ctx.book.id, ctx.members.map((m) => m.userId), rows, today);
  return views.sort((a, b) => {
    const ka = sortKey(a.state, a.expectedOn, a.daysLeft);
    const kb = sortKey(b.state, b.expectedOn, b.daysLeft);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]) || a.name.localeCompare(b.name);
  });
}

export async function getPreorder(ctx: BookContext, id: string, opts: { today?: string } = {}) {
  const today = opts.today ?? toDateKey(new Date());
  const row = await prisma.preorder.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null }, include: PREORDER_INCLUDE });
  if (!row) return null;
  return (await withMoney(ctx.book.id, ctx.members.map((m) => m.userId), [row], today))[0];
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
  // 用既有的讀取路徑拿狀態，狀態一律由 Transaction 現算，不另外判斷一次
  const view = await getPreorder(ctx, id);
  assert(view, "PREORDER_NOT_FOUND", "找不到這張預購");

  // 只有「進行中」才能付款。已結清再付會變成超付、已取消再付更是憑空多一筆支出，
  // 這條規則必須在這裡成立 —— UI 只是第二層防護。
  assert(
    view.state === "ACTIVE",
    "PREORDER_NOT_PAYABLE",
    view.state === "CANCELLED"
      ? "這張預購已經取消，不能再記錄付款。如果實際有退款，請到那筆付款走退款流程。"
      : `這張預購已經付清（應付 ${formatMoney(view.money.total)}、已付 ${formatMoney(view.money.paid)}），不能再記錄付款。` +
        "如果總額有變，請先修改預購金額。",
  );

  // 沒指定分類時帶預購自己的預設，統計才不會整包落在「未分類」
  const categoryId = input.categoryId ?? view.categoryId;
  return createTransaction(ctx, { ...input, categoryId, type: "EXPENSE", preorderId: id });
}
