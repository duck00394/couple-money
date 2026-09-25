/**
 * Phase 3-3：固定支出（房租、水電、訂閱…）。
 *
 * 固定支出「設定」不是金流：建立它不會扣任何帳戶、也不會產生 Transaction。
 * 到了應付日，使用者按「產生記帳」才會用既有的記帳流程（分帳、金流、稽核都沿用）建立一筆真正的支出，
 * 並在 Transaction 上記住 recurringExpenseId + recurringDueDate（同一個應付日只能產生一筆，資料庫唯一鍵擋住）。
 */
import { Prisma, type RecurringStatus } from "@prisma/client";
import { prisma, lockBook, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { computeSplit, SPLIT_METHODS, type SplitRule } from "../domain/split";
import {
  computeNextDueDate, dueState, FREQUENCY_LABEL, isDue, scheduleLabel, validateSchedule,
  type DueState, type RecurringFrequency, type RecurringSchedule,
} from "../domain/recurring";
import { formatMoney, MAX_AMOUNT } from "@/lib/money";
import { dbDateToKey, fromDateKey, keyToDbDate, toDateKey } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { auditIn } from "./funds";
import { assertFresh } from "./conflict";
import { createTransactionIn } from "./ledger";

type Client = Tx | typeof prisma;

export interface RecurringInput {
  name: string;
  note: string;
  amount: number;
  categoryId: string | null;
  accountId: string;
  split: SplitRule;
  frequency: RecurringFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  startDate: string;
  endDate: string | null;
}

const scheduleOf = (r: { frequency: RecurringFrequency; dayOfWeek: number | null; dayOfMonth: number | null; month: number | null }): RecurringSchedule => ({
  frequency: r.frequency,
  dayOfWeek: r.dayOfWeek,
  dayOfMonth: r.dayOfMonth,
  month: r.month,
});

const dateKey = (d: Date | null) => (d ? dbDateToKey(d) : null);
const todayKey = () => toDateKey(new Date());

function validateDate(key: string, message: string) {
  try {
    fromDateKey(key);
  } catch {
    throw new DomainError("RECURRING_DATE", message);
  }
  return key;
}

async function validate(client: Client, ctx: BookContext, input: RecurringInput, keepCategoryId?: string | null) {
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 30, "RECURRING_NAME", "名稱需為 1～30 個字");
  assert(input.note.length <= 500, "RECURRING_NOTE", "備註最多 500 個字");
  assert(Number.isSafeInteger(input.amount) && input.amount > 0 && input.amount <= MAX_AMOUNT, "RECURRING_AMOUNT", "請輸入正確的金額");
  validateSchedule(scheduleOf(input));
  const startDate = validateDate(input.startDate, "開始日期格式不正確");
  const endDate = input.endDate ? validateDate(input.endDate, "結束日期格式不正確") : null;
  assert(!endDate || endDate >= startDate, "RECURRING_END_DATE", "結束日期不能早於開始日期");

  const account = await client.account.findFirst({ where: { id: input.accountId, bookId: ctx.book.id, deletedAt: null } });
  assert(account, "RECURRING_ACCOUNT", "請選擇付款帳戶");
  assert(account.isActive, "RECURRING_ACCOUNT_INACTIVE", `「${account.name}」已停用，請先選擇其他付款帳戶。`);
  if (input.categoryId) {
    const cat = await client.category.findFirst({ where: { id: input.categoryId, bookId: ctx.book.id } });
    assert(cat, "RECURRING_CATEGORY", "分類不存在");
    assert(cat.kind === "EXPENSE", "RECURRING_CATEGORY_KIND", "固定支出只能選支出分類");
    assert(!cat.isArchived || input.categoryId === keepCategoryId, "RECURRING_CATEGORY_ARCHIVED", `「${cat.name}」已停用，請選擇其他分類`);
  }
  assert(SPLIT_METHODS.includes(input.split.method), "SPLIT_METHOD", "不支援的分帳方式");
  const memberIds = new Set(ctx.members.map((m) => m.userId));
  assert(input.split.participants.every((p) => memberIds.has(p.userId)), "SPLIT_MEMBER", "分攤對象必須是帳本成員");
  computeSplit(input.amount, input.split); // 分帳規則本身是否合法（比例／金額加總）
  return { name, note: input.note.trim() || null, startDate, endDate, account };
}

// ───────────────────────── CRUD ─────────────────────────

export async function createRecurring(ctx: BookContext, input: RecurringInput, today = todayKey()) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
  await lockBook(tx, ctx.book.id);
  const { name, note, startDate, endDate } = await validate(tx, ctx, input);
  const nextDueDate = computeNextDueDate(scheduleOf(input), { startDate, endDate, today });
  const created = await tx.recurringExpense.create({
    data: {
      bookId: ctx.book.id,
      name,
      note,
      amount: input.amount,
      categoryId: input.categoryId,
      accountId: input.accountId,
      splitRule: input.split as unknown as Prisma.InputJsonValue,
      frequency: input.frequency,
      dayOfWeek: input.frequency === "WEEKLY" ? input.dayOfWeek : null,
      dayOfMonth: input.frequency === "WEEKLY" ? null : input.dayOfMonth,
      month: input.frequency === "YEARLY" ? input.month : null,
      startDate: keyToDbDate(startDate),
      endDate: endDate ? keyToDbDate(endDate) : null,
      nextDueDate: nextDueDate ? keyToDbDate(nextDueDate) : null,
      createdById: ctx.me.userId,
      updatedById: ctx.me.userId,
    },
  });
  await auditIn(tx, ctx, "CREATE", "RecurringExpense", created.id, null, { ...input, nextDueDate });
  return created;
  });
}

async function load(client: Client, ctx: BookContext, id: string) {
  const r = await client.recurringExpense.findFirst({ where: { id, bookId: ctx.book.id, deletedAt: null } });
  assert(r, "RECURRING_NOT_FOUND", "找不到這筆固定支出");
  return r;
}

export async function updateRecurring(ctx: BookContext, id: string, input: RecurringInput, today = todayKey(), expectedUpdatedAt?: string | null) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => updateRecurringIn(tx, ctx, id, input, today, expectedUpdatedAt));
}

async function updateRecurringIn(tx: Tx, ctx: BookContext, id: string, input: RecurringInput, today: string, expectedUpdatedAt?: string | null) {
  await lockBook(tx, ctx.book.id);
  const before = await load(tx, ctx, id);
  assertFresh(before, expectedUpdatedAt, "筆固定支出");
  const { name, note, startDate, endDate } = await validate(tx, ctx, input, before.categoryId);
  // 週期或起訖日期改變 → 從今天（或開始日期）重新算下一次；只改金額、名稱等不會影響待處理項目
  const scheduleChanged =
    before.frequency !== input.frequency ||
    before.dayOfWeek !== (input.frequency === "WEEKLY" ? input.dayOfWeek : null) ||
    before.dayOfMonth !== (input.frequency === "WEEKLY" ? null : input.dayOfMonth) ||
    before.month !== (input.frequency === "YEARLY" ? input.month : null) ||
    dateKey(before.startDate) !== startDate ||
    dateKey(before.endDate) !== endDate;
  let nextDueDate = dateKey(before.nextDueDate);
  if (scheduleChanged) {
    nextDueDate = computeNextDueDate(scheduleOf(input), { startDate, endDate, today });
  } else if (nextDueDate && endDate && nextDueDate > endDate) {
    nextDueDate = null;
  }
  const updated = await tx.recurringExpense.update({
    where: { id },
    data: {
      name,
      note,
      amount: input.amount,
      categoryId: input.categoryId,
      accountId: input.accountId,
      splitRule: input.split as unknown as Prisma.InputJsonValue,
      frequency: input.frequency,
      dayOfWeek: input.frequency === "WEEKLY" ? input.dayOfWeek : null,
      dayOfMonth: input.frequency === "WEEKLY" ? null : input.dayOfMonth,
      month: input.frequency === "YEARLY" ? input.month : null,
      startDate: keyToDbDate(startDate),
      endDate: endDate ? keyToDbDate(endDate) : null,
      nextDueDate: nextDueDate ? keyToDbDate(nextDueDate) : null,
      updatedById: ctx.me.userId,
    },
  });
  await auditIn(tx, ctx, "UPDATE", "RecurringExpense", id, before, { ...input, nextDueDate });
  return updated;
}

/** 停用／重新啟用。重新啟用不會補停用期間漏掉的付款，從今天之後的第一個週期重新開始。 */
export async function setRecurringActive(ctx: BookContext, id: string, active: boolean, today = todayKey()) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
  await lockBook(tx, ctx.book.id);
  const before = await load(tx, ctx, id);
  const status: RecurringStatus = active ? "ACTIVE" : "PAUSED";
  // 重新啟用：從今天之後的第一個週期開始（不補停用期間漏掉的付款）；
  // 如果今天這一期已經產生過了，就直接跳到下一期，不會又變成待處理。
  const lastGenerated = dateKey(before.lastGeneratedDate);
  const nextDueDate = active
    ? computeNextDueDate(scheduleOf(before), {
        startDate: dateKey(before.startDate)!,
        endDate: dateKey(before.endDate),
        today,
        after: lastGenerated && lastGenerated >= today ? lastGenerated : null,
      })
    : dateKey(before.nextDueDate);
  const updated = await tx.recurringExpense.update({
    where: { id },
    data: { status, nextDueDate: nextDueDate ? keyToDbDate(nextDueDate) : null, updatedById: ctx.me.userId },
  });
  await auditIn(tx, ctx, active ? "RESUME" : "PAUSE", "RecurringExpense", id, { status: before.status, nextDueDate: dateKey(before.nextDueDate) }, { status, nextDueDate });
  return updated;
  });
}

/** 刪除設定（soft delete）。已經產生的交易一律保留，不會被刪。 */
export async function deleteRecurring(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  await prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await load(tx, ctx, id);
    await tx.recurringExpense.update({ where: { id }, data: { deletedAt: new Date(), deletedById: ctx.me.userId } });
    await auditIn(tx, ctx, "DELETE", "RecurringExpense", id, before, null);
  });
}

// ───────────────────────── 讀取 ─────────────────────────

export interface RecurringView {
  id: string;
  name: string;
  note: string | null;
  amount: number;
  accountId: string;
  accountName: string;
  accountIsActive: boolean;
  /** 付款人：由帳戶擁有者決定（null = 共同帳戶） */
  payerId: string | null;
  payerName: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  frequency: RecurringFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  month: number | null;
  scheduleText: string;
  splitText: string;
  split: SplitRule;
  startDate: string;
  endDate: string | null;
  nextDueDate: string | null;
  lastGeneratedDate: string | null;
  status: RecurringStatus;
  state: DueState;
  /** 已經產生過幾筆交易 */
  generated: number;
  /** 樂觀鎖用：編輯時帶回來比對，擋掉覆蓋另一半的修改 */
  updatedAt: string;
}

export async function listRecurring(ctx: BookContext, today = todayKey()): Promise<RecurringView[]> {
  const rows = await prisma.recurringExpense.findMany({
    where: { bookId: ctx.book.id, deletedAt: null },
    orderBy: [{ status: "asc" }, { nextDueDate: "asc" }, { createdAt: "asc" }],
  });
  const [accounts, categories, counts] = await Promise.all([
    prisma.account.findMany({ where: { bookId: ctx.book.id } }),
    prisma.category.findMany({ where: { bookId: ctx.book.id } }),
    prisma.transaction.groupBy({
      by: ["recurringExpenseId"],
      where: { bookId: ctx.book.id, recurringExpenseId: { in: rows.map((r) => r.id) }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  const countBy = new Map(counts.map((c) => [c.recurringExpenseId!, c._count._all]));
  const nick = (uid: string | null) => (uid === null ? "共同" : uid === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === uid)?.nickname ?? "");
  return rows.map((r) => {
    const acc = accounts.find((a) => a.id === r.accountId);
    const cat = categories.find((c) => c.id === r.categoryId);
    const split = r.splitRule as unknown as SplitRule;
    return {
      id: r.id,
      name: r.name,
      note: r.note,
      amount: r.amount,
      accountId: r.accountId,
      accountName: acc?.name ?? "（帳戶已刪除）",
      accountIsActive: acc?.isActive ?? false,
      payerId: acc?.ownerId ?? null,
      categoryId: r.categoryId,
      categoryName: cat?.name ?? null,
      categoryIcon: cat?.icon ?? null,
      frequency: r.frequency,
      dayOfWeek: r.dayOfWeek,
      dayOfMonth: r.dayOfMonth,
      month: r.month,
      scheduleText: scheduleLabel(scheduleOf(r)),
      splitText: splitLabel(split, ctx),
      split,
      startDate: dateKey(r.startDate)!,
      endDate: dateKey(r.endDate),
      nextDueDate: dateKey(r.nextDueDate),
      lastGeneratedDate: dateKey(r.lastGeneratedDate),
      status: r.status,
      state: r.status === "PAUSED" ? "UPCOMING" : dueState(dateKey(r.nextDueDate), today),
      generated: countBy.get(r.id) ?? 0,
      payerName: nick(acc?.ownerId ?? null),
      updatedAt: r.updatedAt.toISOString(),
    } satisfies RecurringView;
  });
}

export function splitLabel(split: SplitRule, ctx: BookContext): string {
  const nick = (uid: string) => (uid === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === uid)?.nickname ?? "對方");
  switch (split.method) {
    case "EQUAL":
      return split.participants.length > 1 ? "平分" : `${nick(split.participants[0]?.userId ?? "")}全額負擔`;
    case "FULL":
      return `${nick(split.participants[0]?.userId ?? "")}全額負擔`;
    case "RATIO":
      return split.participants.map((p) => `${nick(p.userId)} ${p.value}%`).join("／");
    case "AMOUNT":
      return split.participants.map((p) => `${nick(p.userId)} ${formatMoney(p.value ?? 0)}`).join("／");
    default:
      return "依份數";
  }
}

/** 今天到期或已逾期、而且還在啟用中的固定支出。 */
export async function pendingRecurring(ctx: BookContext, today = todayKey()) {
  return (await listRecurring(ctx, today)).filter((r) => r.status === "ACTIVE" && isDue(r.nextDueDate, today));
}

export async function getRecurring(ctx: BookContext, id: string, today = todayKey()) {
  const view = (await listRecurring(ctx, today)).find((r) => r.id === id);
  if (!view) return null;
  const transactions = await prisma.transaction.findMany({
    where: { bookId: ctx.book.id, recurringExpenseId: id, deletedAt: null },
    orderBy: [{ recurringDueDate: "desc" }],
    include: { payments: { include: { account: true } }, category: true },
  });
  return { ...view, transactions };
}

// ───────────────────────── 產生實際交易 ─────────────────────────

/**
 * 到期後由使用者手動產生一筆真正的支出。
 * 防重複：同一個 (固定支出, 應付日) 只會有一筆交易（資料庫唯一鍵 + 固定的 clientRequestId + 帳本鎖），
 * 而且畫面送出的 expectedDueDate 與目前的應付日不同時會直接擋下來（連點兩下不會產生兩期）。
 */
export async function generateRecurring(
  ctx: BookContext,
  id: string,
  opts: { expectedDueDate?: string | null; today?: string } = {},
) {
  assertCanWrite(ctx);
  const today = opts.today ?? todayKey();
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBook(tx, ctx.book.id);
      const r = await load(tx, ctx, id);
      const due = dateKey(r.nextDueDate);
      assert(r.status === "ACTIVE", "RECURRING_PAUSED", "這筆固定支出已停用，請先重新啟用");
      // 先比對畫面上的應付日：連點兩下或兩支手機同時按時，第二次一定會對不上
      if (opts.expectedDueDate && opts.expectedDueDate !== due) {
        throw new DomainError("RECURRING_STALE", "這筆固定支出剛剛已經產生過了，請重新整理頁面");
      }
      assert(due, "RECURRING_ENDED", "這筆固定支出已經結束（超過結束日期）");
      assert(isDue(due, today), "RECURRING_NOT_DUE", `還沒到應付日（${due}），時間到了才能產生記帳`);
      const account = await tx.account.findFirst({ where: { id: r.accountId, bookId: ctx.book.id, deletedAt: null } });
      assert(account && account.isActive, "RECURRING_ACCOUNT_INACTIVE", "此固定支出使用的帳戶已停用，請先修改付款帳戶。");

      const existing = await tx.transaction.findFirst({
        where: { recurringExpenseId: r.id, recurringDueDate: keyToDbDate(due) },
      });
      // 這一期先前產生過又被刪除：唯一鍵讓它不能再產生一次，所以直接跳到下一期，不要卡在待處理
      const skipped = !!existing?.deletedAt;
      const created = skipped ? null : existing ?? (await createTransactionIn(tx, ctx, {
        type: "EXPENSE",
        amount: r.amount,
        accountId: r.accountId,
        categoryId: r.categoryId,
        title: r.name,
        note: r.note ?? "",
        occurredOn: due,
        split: r.splitRule as unknown as SplitRule,
        clientRequestId: `recurring:${r.id}:${due}`,
        recurringExpenseId: r.id,
        recurringDueDate: due,
      }));

      const nextDueDate = computeNextDueDate(scheduleOf(r), {
        startDate: dateKey(r.startDate)!,
        endDate: dateKey(r.endDate),
        today,
        after: due,
      });
      await tx.recurringExpense.update({
        where: { id: r.id },
        data: {
          nextDueDate: nextDueDate ? keyToDbDate(nextDueDate) : null,
          lastGeneratedDate: keyToDbDate(due),
          updatedById: ctx.me.userId,
        },
      });
      await auditIn(tx, ctx, skipped ? "SKIP" : "GENERATE", "RecurringExpense", r.id, { nextDueDate: due }, { transactionId: created?.id ?? null, dueDate: due, nextDueDate });
      return { transaction: created, dueDate: due, skipped };
    });
  } catch (e) {
    // 兩支手機同時按：第二個會撞唯一鍵（同一個應付日只能一筆）
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("RECURRING_ALREADY_GENERATED", "這個應付日已經產生過記帳了");
    }
    throw e;
  }
}

export { FREQUENCY_LABEL, scheduleLabel };
