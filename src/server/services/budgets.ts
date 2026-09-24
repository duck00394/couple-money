/**
 * 每月分類預算（Phase 3-4 B）。
 *
 * **統計口徑不是在這裡定義的**：「已支出」直接取自 `monthStats()` 的分類統計
 * （也就是 /stats 與搜尋頁那一套：支出 − 退款，轉帳／結算／期初／餘額調整／基金投入
 * ／未入金獎金一律不算，已作廢的交易也不算）。這裡只負責把預算金額接上去。
 *
 * 預算不是金流：不產生 Transaction／Payment／Split，不影響餘額、欠款、基金與 /stats 的金額。
 */
import { prisma, lockBook } from "../db";
import { assert } from "../domain/errors";
import { assertBudgetAmount, budgetProgress, summarizeBudgets, type BudgetProgress, type BudgetSummary } from "../domain/budget";
import { clampMonth, MONTH } from "../domain/stats";
import { assertCanWrite, type BookContext } from "./books";
import { COUPLE } from "./tasks";
import { monthBorneByCategory, monthStats } from "./stats";
import { auditIn } from "./funds";

export { clampMonth };

export interface BudgetRow {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryArchived: boolean;
  month: string;
  isActive: boolean;
  note: string | null;
  /** "COUPLE" = 兩人共用；其他值 = 該 userId 的個人預算 */
  subjectKey: string;
  /** 個人預算才有：那個人的暱稱 */
  personName: string | null;
  progress: BudgetProgress;
}

/** 一個分類在這個月的全部預算：共同一筆 + 每個人各一筆。 */
export interface BudgetGroup {
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryArchived: boolean;
  /** 這個分類這個月的總已支出（= 每個人負擔的加總，與 /stats 同一個數字） */
  spent: number;
  /** 共同預算（沒設就是 null） */
  couple: BudgetRow | null;
  /** 個人預算，依帳本成員順序 */
  people: BudgetRow[];
  /**
   * 畫面最上面那一行「共同」。
   * 有共同預算就用它；只有個人預算時，金額是個人預算的合計。
   * 兩種情況的「已支出」都是分類總支出。
   */
  combined: { amount: number; fromPeople: boolean; progress: BudgetProgress } | null;
}

export interface BudgetOverview {
  month: string;
  /** 依分類分組（畫面用） */
  groups: BudgetGroup[];
  /** 全部預算列（首頁摘要用，含共同與個人） */
  rows: BudgetRow[];
  summary: BudgetSummary;
  /** 這個月還可以新增「共同預算」的分類 */
  available: Array<{ id: string; name: string; icon: string }>;
  /** 這個月還可以新增「個人預算」的分類（兩個人都還沒設） */
  availablePersonal: Array<{ id: string; name: string; icon: string }>;
  /** 帳本成員（設定個人預算時要填幾個欄位） */
  members: Array<{ userId: string; nickname: string }>;
}

function assertMonth(month: string): string {
  assert(MONTH.test(month), "BUDGET_MONTH", "月份格式不正確");
  return month;
}

/**
 * 某個月的預算總覽。
 *
 * 「已支出」有兩種，但**都來自同一批交易資料**：
 *   - 共同預算：分類總支出，直接取自 `monthStats()` 的分類統計（與 V1 完全相同）
 *   - 個人預算：`monthBorneByCategory()` 的分帳後實際負擔（不是付款人金額）
 * 兩者的關係是 Σ(每人負擔) = 分類總支出，有整合測試釘住。
 *
 * 查詢次數固定（monthStats、負擔、Budget、分類），不會 N+1。
 */
export async function budgetOverview(ctx: BookContext, month: string): Promise<BudgetOverview> {
  assertMonth(month);
  const [budgets, stats, borne, categories] = await Promise.all([
    prisma.budget.findMany({
      where: { bookId: ctx.book.id, month },
      include: { category: { select: { name: true, icon: true, isArchived: true } } },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    }),
    monthStats(ctx, month),
    monthBorneByCategory(ctx, month),
    prisma.category.findMany({
      where: { bookId: ctx.book.id, kind: "EXPENSE", isArchived: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, icon: true },
    }),
  ]);

  const members = ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }));
  const nick = (uid: string) => members.find((m) => m.userId === uid)?.nickname ?? "已離開的成員";
  // 分類總已支出：沿用 /stats 的分類統計（沒花錢的分類不會出現 → 0）
  const spentByCategory = new Map(stats.categories.map((c) => [c.categoryId, c.amount]));
  const borneOf = (categoryId: string, userId: string) => borne.get(categoryId)?.get(userId) ?? 0;

  const toRow = (b: (typeof budgets)[number]): BudgetRow => {
    const personal = b.subjectKey !== COUPLE;
    const spent = personal ? borneOf(b.categoryId, b.subjectKey) : spentByCategory.get(b.categoryId) ?? 0;
    return {
      id: b.id,
      categoryId: b.categoryId,
      categoryName: b.category.name,
      categoryIcon: b.category.icon,
      categoryArchived: b.category.isArchived,
      month: b.month,
      isActive: b.isActive,
      note: b.note,
      subjectKey: b.subjectKey,
      personName: personal ? nick(b.subjectKey) : null,
      progress: budgetProgress(b.amount, spent),
    };
  };

  const rows = budgets.map(toRow);

  // 依分類分組，分類順序照既有的 sortOrder；不在清單裡的（已停用分類）排在後面
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const byCategory = new Map<string, BudgetRow[]>();
  for (const r of rows) byCategory.set(r.categoryId, [...(byCategory.get(r.categoryId) ?? []), r]);

  const groups: BudgetGroup[] = [...byCategory.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 9999) - (order.get(b[0]) ?? 9999))
    .map(([categoryId, list]) => {
      const first = list[0];
      const couple = list.find((r) => r.subjectKey === COUPLE) ?? null;
      const people = members
        .map((m) => list.find((r) => r.subjectKey === m.userId))
        .filter((r): r is BudgetRow => !!r);
      const spent = spentByCategory.get(categoryId) ?? 0;
      const peopleTotal = people.filter((p) => p.isActive).reduce((a, p) => a + p.progress.amount, 0);
      const combined = couple
        ? { amount: couple.progress.amount, fromPeople: false, progress: couple.progress }
        : peopleTotal > 0
          ? { amount: peopleTotal, fromPeople: true, progress: budgetProgress(peopleTotal, spent) }
          : null;
      return {
        categoryId,
        categoryName: first.categoryName,
        categoryIcon: first.categoryIcon,
        categoryArchived: first.categoryArchived,
        spent,
        couple,
        people,
        combined,
      };
    });

  const coupleTaken = new Set(budgets.filter((b) => b.subjectKey === COUPLE).map((b) => b.categoryId));
  const personalTaken = new Set(budgets.filter((b) => b.subjectKey !== COUPLE).map((b) => b.categoryId));
  return {
    month,
    groups,
    rows,
    summary: summarizeBudgets(rows),
    available: categories.filter((c) => !coupleTaken.has(c.id)),
    availablePersonal: categories.filter((c) => !personalTaken.has(c.id)),
    members,
  };
}

/** 首頁的一行摘要（沒有預算就回 null，首頁才不會多一塊空的）。 */
export async function budgetSummary(ctx: BookContext, month: string): Promise<BudgetSummary | null> {
  const { summary } = await budgetOverview(ctx, month);
  return summary.count > 0 ? summary : null;
}

async function loadCategory(tx: Parameters<typeof auditIn>[0], ctx: BookContext, categoryId: string) {
  const category = await (tx as typeof prisma).category.findFirst({ where: { id: categoryId, bookId: ctx.book.id } });
  assert(category, "BUDGET_CATEGORY", "找不到這個分類");
  assert(category.kind === "EXPENSE", "BUDGET_CATEGORY_KIND", "只能為支出分類設定預算");
  return category;
}

/** 檢查 subjectKey：只能是 COUPLE 或這個帳本的成員。 */
function assertSubject(ctx: BookContext, subjectKey: string): string {
  if (subjectKey === COUPLE) return COUPLE;
  assert(ctx.members.some((m) => m.userId === subjectKey), "BUDGET_SUBJECT", "只能為帳本裡的人設定個人預算");
  return subjectKey;
}

const subjectLabel = (ctx: BookContext, subjectKey: string) =>
  subjectKey === COUPLE ? "共同" : ctx.members.find((m) => m.userId === subjectKey)?.nickname ?? "個人";

export interface BudgetEntryInput {
  /** COUPLE 或成員 userId */
  subjectKey: string;
  amount: number;
}

/**
 * 建立這個月某個分類的預算。
 * 一次可以建立多筆（例如個人預算：A 一筆、B 一筆），整批在同一個 DB transaction 內，
 * 任何一筆不合法就全部不建立。
 */
export async function createBudgets(
  ctx: BookContext,
  input: { categoryId: string; month: string; entries: BudgetEntryInput[]; note?: string },
) {
  assertCanWrite(ctx);
  const month = assertMonth(input.month);
  const note = (input.note ?? "").trim().slice(0, 100) || null;
  assert(input.entries.length > 0, "BUDGET_AMOUNT", "請至少填一個預算金額");
  const entries = input.entries.map((e) => ({ subjectKey: assertSubject(ctx, e.subjectKey), amount: assertBudgetAmount(e.amount) }));
  assert(new Set(entries.map((e) => e.subjectKey)).size === entries.length, "BUDGET_DUPLICATE", "同一個人只能設定一筆預算");

  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const category = await loadCategory(tx, ctx, input.categoryId);
    assert(!category.isArchived, "BUDGET_CATEGORY_ARCHIVED", `「${category.name}」已停用，請先重新啟用分類再設定預算`);
    const created = [];
    for (const e of entries) {
      const exists = await tx.budget.findUnique({
        where: { bookId_categoryId_month_subjectKey: { bookId: ctx.book.id, categoryId: category.id, month, subjectKey: e.subjectKey } },
      });
      assert(!exists, "BUDGET_DUPLICATE", `「${category.name}」這個月已經有${subjectLabel(ctx, e.subjectKey)}預算了，請直接修改它`);
      const row = await tx.budget.create({
        data: {
          bookId: ctx.book.id, categoryId: category.id, month, amount: e.amount, note, subjectKey: e.subjectKey,
          createdById: ctx.me.userId, updatedById: ctx.me.userId,
        },
      });
      await auditIn(tx, ctx, "CREATE", "Budget", row.id, null, {
        name: category.name, month, amount: e.amount, subject: subjectLabel(ctx, e.subjectKey),
      });
      created.push(row);
    }
    return created;
  });
}

/** 單筆版本（預設是共同預算，與 V1 行為完全相同）。 */
export async function createBudget(
  ctx: BookContext,
  input: { categoryId: string; month: string; amount: number; note?: string; subjectKey?: string },
) {
  const [row] = await createBudgets(ctx, {
    categoryId: input.categoryId,
    month: input.month,
    note: input.note,
    entries: [{ subjectKey: input.subjectKey ?? COUPLE, amount: input.amount }],
  });
  return row;
}

export async function updateBudget(ctx: BookContext, id: string, input: { amount: number; note?: string }) {
  assertCanWrite(ctx);
  const amount = assertBudgetAmount(input.amount);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.budget.findFirst({ where: { id, bookId: ctx.book.id }, include: { category: { select: { name: true } } } });
    assert(before, "BUDGET_NOT_FOUND", "找不到這筆預算");
    const note = input.note === undefined ? before.note : (input.note.trim().slice(0, 100) || null);
    const updated = await tx.budget.update({ where: { id }, data: { amount, note, updatedById: ctx.me.userId } });
    await auditIn(tx, ctx, "UPDATE", "Budget", id, { amount: before.amount }, { name: before.category.name, month: before.month, amount });
    return updated;
  });
}

/** 停用／重新啟用：停用的預算保留紀錄，但不納入摘要與檢查。 */
export async function setBudgetActive(ctx: BookContext, id: string, active: boolean) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.budget.findFirst({ where: { id, bookId: ctx.book.id }, include: { category: { select: { name: true } } } });
    assert(before, "BUDGET_NOT_FOUND", "找不到這筆預算");
    if (before.isActive === active) return before;
    const updated = await tx.budget.update({ where: { id }, data: { isActive: active, updatedById: ctx.me.userId } });
    await auditIn(tx, ctx, active ? "RESTORE" : "ARCHIVE", "Budget", id, { isActive: before.isActive }, { name: before.category.name, month: before.month, isActive: active });
    return updated;
  });
}

/** 刪除預算。預算不是財務紀錄，刪掉不會影響任何交易或統計。 */
export async function deleteBudget(ctx: BookContext, id: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const before = await tx.budget.findFirst({ where: { id, bookId: ctx.book.id }, include: { category: { select: { name: true } } } });
    assert(before, "BUDGET_NOT_FOUND", "找不到這筆預算");
    await tx.budget.delete({ where: { id } });
    await auditIn(tx, ctx, "DELETE", "Budget", id, { name: before.category.name, month: before.month, amount: before.amount }, null);
  });
}

/** 分類管理用：這個分類有幾筆預算（有的話就不能硬刪分類）。 */
export async function budgetsForCategory(ctx: BookContext, categoryId: string) {
  return prisma.budget.count({ where: { bookId: ctx.book.id, categoryId } });
}
