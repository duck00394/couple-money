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
import { monthStats } from "./stats";
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
  progress: BudgetProgress;
}

export interface BudgetOverview {
  month: string;
  rows: BudgetRow[];
  summary: BudgetSummary;
  /** 這個月還可以新增預算的分類（未停用、還沒有預算） */
  available: Array<{ id: string; name: string; icon: string }>;
}

function assertMonth(month: string): string {
  assert(MONTH.test(month), "BUDGET_MONTH", "月份格式不正確");
  return month;
}

/** 某個月的預算總覽。一次 monthStats + 一次 Budget 查詢 + 一次分類查詢，不會 N+1。 */
export async function budgetOverview(ctx: BookContext, month: string): Promise<BudgetOverview> {
  assertMonth(month);
  const [budgets, stats, categories] = await Promise.all([
    prisma.budget.findMany({
      where: { bookId: ctx.book.id, month },
      include: { category: { select: { name: true, icon: true, isArchived: true } } },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    }),
    monthStats(ctx, month),
    prisma.category.findMany({
      where: { bookId: ctx.book.id, kind: "EXPENSE", isArchived: false },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, icon: true },
    }),
  ]);

  // 已支出：直接沿用 /stats 的分類統計（沒有花錢的分類不會出現在裡面 → 0）
  const spentByCategory = new Map(stats.categories.map((c) => [c.categoryId, c.amount]));

  const rows: BudgetRow[] = budgets.map((b) => ({
    id: b.id,
    categoryId: b.categoryId,
    categoryName: b.category.name,
    categoryIcon: b.category.icon,
    categoryArchived: b.category.isArchived,
    month: b.month,
    isActive: b.isActive,
    note: b.note,
    progress: budgetProgress(b.amount, spentByCategory.get(b.categoryId) ?? 0),
  }));

  const taken = new Set(budgets.map((b) => b.categoryId));
  return {
    month,
    rows,
    summary: summarizeBudgets(rows),
    available: categories.filter((c) => !taken.has(c.id)),
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

export async function createBudget(ctx: BookContext, input: { categoryId: string; month: string; amount: number; note?: string }) {
  assertCanWrite(ctx);
  const month = assertMonth(input.month);
  const amount = assertBudgetAmount(input.amount);
  const note = (input.note ?? "").trim().slice(0, 100) || null;
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const category = await loadCategory(tx, ctx, input.categoryId);
    assert(!category.isArchived, "BUDGET_CATEGORY_ARCHIVED", `「${category.name}」已停用，請先重新啟用分類再設定預算`);
    const exists = await tx.budget.findUnique({
      where: { bookId_categoryId_month: { bookId: ctx.book.id, categoryId: category.id, month } },
    });
    assert(!exists, "BUDGET_DUPLICATE", `「${category.name}」這個月已經有預算了，請直接修改它`);
    const created = await tx.budget.create({
      data: {
        bookId: ctx.book.id, categoryId: category.id, month, amount, note,
        createdById: ctx.me.userId, updatedById: ctx.me.userId,
      },
    });
    await auditIn(tx, ctx, "CREATE", "Budget", created.id, null, { name: category.name, month, amount });
    return created;
  });
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
