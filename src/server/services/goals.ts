import { prisma, type Tx } from "../db";
import { assert, DomainError } from "../domain/errors";
import { progressOf } from "../domain/fund";
import { MAX_AMOUNT } from "@/lib/money";
import { dbDateToKey, diffDays, fromDateKey, keyToDbDate, toDateKey } from "@/lib/dates";
import { assertCanWrite, type BookContext } from "./books";
import { assertFresh } from "./conflict";
import { auditIn, createFund, fundBalances, pendingByFund } from "./funds";

export interface GoalInput {
  name: string;
  description: string;
  emoji: string;
  targetAmount: number;
  startDate: string;
  deadline: string | null;
  /** 既有基金 id；"NEW" = 建立同名基金；null = 不連結 */
  fundId: string | null;
  isActive: boolean;
}

function validate(input: GoalInput) {
  const name = input.name.trim();
  assert(name.length >= 1 && name.length <= 30, "GOAL_NAME", "目標名稱需為 1～30 個字");
  assert(input.description.length <= 300, "GOAL_DESC", "描述最多 300 個字");
  assert(Number.isSafeInteger(input.targetAmount) && input.targetAmount > 0 && input.targetAmount <= MAX_AMOUNT, "GOAL_TARGET", "請輸入正確的目標金額");
  let start: Date;
  try {
    start = fromDateKey(input.startDate);
    if (input.deadline) fromDateKey(input.deadline);
  } catch {
    throw new DomainError("GOAL_DATE", "日期格式不正確");
  }
  assert(!input.deadline || input.deadline >= input.startDate, "GOAL_DEADLINE", "目標日期不能早於開始日期");
  void start;
  return {
    name,
    description: input.description.trim() || null,
    emoji: input.emoji.trim() || "🎯",
    targetAmount: input.targetAmount,
    startDate: keyToDbDate(input.startDate),
    deadline: input.deadline ? keyToDbDate(input.deadline) : null,
    isActive: input.isActive,
  };
}

async function resolveFund(ctx: BookContext, fundId: string | null, name: string, emoji: string, target: number, deadline: string | null) {
  if (fundId === "NEW") {
    return (await createFund(ctx, { name: name.slice(0, 20), emoji, targetAmount: target, dueDate: deadline })).id;
  }
  if (fundId) {
    const f = await prisma.fund.findFirst({ where: { id: fundId, bookId: ctx.book.id, deletedAt: null } });
    assert(f, "FUND_NOT_FOUND", "找不到基金");
  }
  return fundId;
}

export async function createGoal(ctx: BookContext, input: GoalInput) {
  assertCanWrite(ctx);
  const data = validate(input);
  const fundId = await resolveFund(ctx, input.fundId, data.name, data.emoji, data.targetAmount, input.deadline);
  const goal = await prisma.goal.create({ data: { ...data, fundId, bookId: ctx.book.id, createdById: ctx.me.userId } });
  await auditIn(prisma, ctx, "CREATE", "Goal", goal.id, null, goal);
  return goal;
}

export async function updateGoal(ctx: BookContext, goalId: string, input: GoalInput, expectedUpdatedAt?: string | null) {
  assertCanWrite(ctx);
  const before = await prisma.goal.findFirst({ where: { id: goalId, bookId: ctx.book.id, deletedAt: null } });
  assert(before, "GOAL_NOT_FOUND", "找不到目標");
  assertFresh(before, expectedUpdatedAt, "個目標");
  const data = validate(input);
  const fundId = await resolveFund(ctx, input.fundId, data.name, data.emoji, data.targetAmount, input.deadline);
  // 改了目標金額或基金 → 重新判斷是否達成
  const reset = before.targetAmount !== data.targetAmount || before.fundId !== fundId;
  const goal = await prisma.goal.update({
    where: { id: goalId },
    data: { ...data, fundId, ...(reset ? { status: "ACTIVE", achievedAt: null } : {}) },
  });
  await auditIn(prisma, ctx, "UPDATE", "Goal", goalId, before, goal);
  return goal;
}

/** 手動標記完成／取消完成（例如不需要存錢的目標）。 */
export async function setGoalAchieved(ctx: BookContext, goalId: string, achieved: boolean) {
  assertCanWrite(ctx);
  const goal = await prisma.goal.findFirst({ where: { id: goalId, bookId: ctx.book.id, deletedAt: null } });
  assert(goal, "GOAL_NOT_FOUND", "找不到目標");
  await prisma.goal.update({
    where: { id: goalId },
    data: achieved ? { status: "ACHIEVED", achievedAt: new Date() } : { status: "ACTIVE", achievedAt: null },
  });
  await auditIn(prisma, ctx, achieved ? "ACHIEVE" : "REOPEN", "Goal", goalId, null, null);
}

export async function assertGoalExists(client: Tx | typeof prisma, ctx: BookContext, goalId: string) {
  const goal = await client.goal.findFirst({ where: { id: goalId, bookId: ctx.book.id, deletedAt: null } });
  assert(goal, "GOAL_NOT_FOUND", "找不到目標");
  return goal;
}

/** 真正刪除（只由刪除申請流程呼叫：需要另一半同意）。基金與基金紀錄不受影響。 */
export async function performDeleteGoal(tx: Tx, ctx: BookContext, goalId: string) {
  const goal = await assertGoalExists(tx, ctx, goalId);
  await tx.goal.update({ where: { id: goalId }, data: { deletedAt: new Date() } });
  await auditIn(tx, ctx, "DELETE", "Goal", goalId, goal, null);
}

export interface GoalView {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  targetAmount: number;
  /** 實際金額（連結基金的實際基金金額） */
  current: number;
  /** 尚未入金獎金淨額（不算現金，只用於「含未入金」的進度） */
  pending: number;
  remaining: number;
  progress: number;
  totalProgress: number;
  startDate: string;
  deadline: string | null;
  daysLeft: number | null;
  isActive: boolean;
  status: "ACTIVE" | "ACHIEVED";
  achievedAt: Date | null;
  /** 樂觀鎖用（編輯表單帶回來比對） */
  updatedAt: string;
  fund: { id: string; name: string; emoji: string } | null;
}

/**
 * 目標列表。目前金額 = 連結基金的「實際基金金額」（由 FundTransaction 加總）。
 * 尚未入金的獎金另外列出，不算進目前金額，也不會讓目標自動完成。
 * 實際金額達到目標時自動標記完成；之後基金被花掉不會倒退（完成就是完成）。
 */
export async function listGoals(ctx: BookContext, opts: { includeInactive?: boolean; today?: string } = {}): Promise<GoalView[]> {
  const today = opts.today ?? toDateKey(new Date());
  const goals = await prisma.goal.findMany({
    where: { bookId: ctx.book.id, deletedAt: null, ...(opts.includeInactive ? {} : { isActive: true }) },
    include: { fund: true },
    orderBy: [{ isActive: "desc" }, { status: "asc" }, { createdAt: "asc" }],
  });
  const fundIds = goals.map((g) => g.fundId).filter((x): x is string => !!x);
  const [bal, pend] = await Promise.all([fundBalances(prisma, ctx.book.id, fundIds), pendingByFund(prisma, ctx.book.id, fundIds)]);
  const views: GoalView[] = [];
  for (const g of goals) {
    const fund = g.fund && !g.fund.deletedAt ? g.fund : null;
    const current = fund ? bal.get(fund.id) ?? 0 : 0;
    const pending = fund ? Math.max(0, pend.get(fund.id)?.net ?? 0) : 0;
    let { status, achievedAt } = g;
    if (status === "ACTIVE" && fund && current >= g.targetAmount) {
      status = "ACHIEVED";
      achievedAt = achievedAt ?? new Date();
      // 只在有編輯權限時寫回，而且只改仍然是「進行中」的那一列（不會蓋掉另一半剛剛的操作）
      if (ctx.canWrite) {
        await prisma.goal.updateMany({ where: { id: g.id, status: "ACTIVE" }, data: { status, achievedAt } });
      }
    }
    const deadline = g.deadline ? dbDateToKey(g.deadline) : null;
    views.push({
      id: g.id,
      name: g.name,
      description: g.description,
      emoji: g.emoji,
      targetAmount: g.targetAmount,
      current,
      remaining: Math.max(0, g.targetAmount - current),
      pending,
      progress: status === "ACHIEVED" && !fund ? 1 : progressOf(current, g.targetAmount) ?? 0,
      totalProgress: status === "ACHIEVED" && !fund ? 1 : progressOf(current + pending, g.targetAmount) ?? 0,
      startDate: dbDateToKey(g.startDate),
      deadline,
      daysLeft: deadline ? diffDays(deadline, today) : null,
      isActive: g.isActive,
      status,
      achievedAt,
      updatedAt: g.updatedAt.toISOString(),
      fund: fund ? { id: fund.id, name: fund.name, emoji: fund.emoji } : null,
    });
  }
  return views;
}

export async function getGoal(ctx: BookContext, goalId: string) {
  return (await listGoals(ctx, { includeInactive: true })).find((g) => g.id === goalId) ?? null;
}
