/**
 * 最近動態（Phase 3-4 H）。
 *
 * 資料來源**只有既有的 AuditLog**：沒有新增 schema、沒有 Notification 資料表、沒有背景排程。
 * AuditLog 仍然是完整稽核紀錄，這裡只是把其中「對方做的、值得知道的事」整理成人看得懂的列表。
 *
 * 權限：查詢一律鎖在 `ctx.book.id`（`getBookContext()` 只會回傳你仍是 ACTIVE 成員的帳本），
 * 所以離開帳本的人根本走不到這裡，也不可能讀到別的帳本的動態。
 */
import { prisma } from "../db";
import { describeAudit, isNotifiable, type AuditRow, type LinkedInfo, type NotificationView } from "../domain/notification";
import { formatMoney } from "@/lib/money";
import { toDateKey } from "@/lib/dates";
import type { BookContext } from "./books";

export const RECENT_DAYS = 30;
export const RECENT_LIMIT = 50;

/** 白名單：只查這些 entityType，順便在資料庫層就把匯出、系統懲罰等雜訊擋掉。 */
const TYPES = [
  "Transaction", "Account", "Attachment", "Settlement",
  "CheckIn", "Task", "TaskPenalty",
  "Fund", "FundTransaction", "Goal", "RecurringExpense", "Category", "Budget", "BookMember",
];

function pickId(value: unknown, key: string): string | undefined {
  const v = (value as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : undefined;
}

export interface ActivityItem extends NotificationView {
  /** 帳本時區的 YYYY-MM-DD，畫面用來分組 */
  dateKey: string;
}

export async function listActivity(
  ctx: BookContext,
  opts: { take?: number; days?: number; includeMine?: boolean } = {},
): Promise<ActivityItem[]> {
  const take = Math.min(RECENT_LIMIT, Math.max(1, opts.take ?? RECENT_LIMIT));
  const since = new Date(Date.now() - (opts.days ?? RECENT_DAYS) * 86400_000);

  const rows = await prisma.auditLog.findMany({
    where: {
      bookId: ctx.book.id,
      createdAt: { gte: since },
      entityType: { in: TYPES },
      ...(opts.includeMine ? {} : { actorId: { not: ctx.me.userId } }),
    },
    orderBy: { createdAt: "desc" },
    take: take * 2, // 多抓一點，篩掉不在白名單的 action 之後再截斷
    select: { id: true, action: true, entityType: true, entityId: true, actorId: true, createdAt: true, before: true, after: true },
  });
  const notifiable = rows.filter((r) => isNotifiable(r.entityType, r.action)).slice(0, take);
  if (notifiable.length === 0) return [];

  // ── 關聯資料一次查好（每種型別一個查詢，不會 N+1）──
  const idsOf = (type: string) => notifiable.filter((r) => r.entityType === type).map((r) => r.entityId);
  const txIds = new Set<string>(idsOf("Transaction"));
  for (const r of notifiable) {
    // 收據與餘額調整要連到對應的那一筆記帳
    const linkedTx = pickId(r.after, "transactionId") ?? pickId(r.before, "transactionId");
    if (linkedTx) txIds.add(linkedTx);
  }

  const [transactions, accounts, checkIns, tasks, funds, fundEntries, goals, recurrings, penalties] = await Promise.all([
    txIds.size
      ? prisma.transaction.findMany({ where: { id: { in: [...txIds] }, bookId: ctx.book.id }, select: { id: true, title: true, deletedAt: true } })
      : [],
    idsOf("Account").length
      ? prisma.account.findMany({ where: { id: { in: idsOf("Account") }, bookId: ctx.book.id }, select: { id: true, name: true, deletedAt: true } })
      : [],
    idsOf("CheckIn").length
      ? prisma.checkIn.findMany({ where: { id: { in: idsOf("CheckIn") }, bookId: ctx.book.id }, select: { id: true, taskId: true, task: { select: { title: true, deletedAt: true } } } })
      : [],
    idsOf("Task").length
      ? prisma.task.findMany({ where: { id: { in: idsOf("Task") }, bookId: ctx.book.id }, select: { id: true, title: true, deletedAt: true } })
      : [],
    idsOf("Fund").length
      ? prisma.fund.findMany({ where: { id: { in: idsOf("Fund") }, bookId: ctx.book.id }, select: { id: true, name: true, deletedAt: true } })
      : [],
    idsOf("FundTransaction").length
      ? prisma.fundTransaction.findMany({ where: { id: { in: idsOf("FundTransaction") }, bookId: ctx.book.id }, select: { id: true, fundId: true, fund: { select: { name: true, deletedAt: true } } } })
      : [],
    idsOf("Goal").length
      ? prisma.goal.findMany({ where: { id: { in: idsOf("Goal") }, bookId: ctx.book.id }, select: { id: true, name: true, deletedAt: true } })
      : [],
    idsOf("RecurringExpense").length
      ? prisma.recurringExpense.findMany({ where: { id: { in: idsOf("RecurringExpense") }, bookId: ctx.book.id }, select: { id: true, name: true, deletedAt: true } })
      : [],
    idsOf("TaskPenalty").length
      ? prisma.taskPenalty.findMany({ where: { id: { in: idsOf("TaskPenalty") }, bookId: ctx.book.id }, select: { id: true, taskId: true, task: { select: { title: true, deletedAt: true } } } })
      : [],
  ]);

  const txMap = new Map(transactions.map((t) => [t.id, t]));
  const map = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const accountMap = map(accounts);
  const checkInMap = map(checkIns);
  const taskMap = map(tasks);
  const fundMap = map(funds);
  const entryMap = map(fundEntries);
  const goalMap = map(goals);
  const recurringMap = map(recurrings);
  const penaltyMap = map(penalties);

  const nickname = (userId: string | null) =>
    ctx.members.find((m) => m.userId === userId)?.nickname ?? "已離開的成員";

  const linkedOf = (r: (typeof notifiable)[number]): LinkedInfo => {
    const linkedTxId = pickId(r.after, "transactionId") ?? pickId(r.before, "transactionId");
    const linkedTx = linkedTxId ? txMap.get(linkedTxId) : undefined;
    const withTx = linkedTx ? { transactionId: linkedTx.id, transactionAlive: !linkedTx.deletedAt } : {};
    switch (r.entityType) {
      case "Transaction": {
        const t = txMap.get(r.entityId);
        return { name: t?.title ?? undefined, alive: !!t && !t.deletedAt };
      }
      case "Account": {
        const a = accountMap.get(r.entityId);
        return { name: a?.name, alive: !!a && !a.deletedAt, ...withTx };
      }
      case "Attachment": {
        // 記帳已作廢時，連結收起來；只留「某筆記帳的收據被動過」這個事實
        return { name: linkedTx && !linkedTx.deletedAt ? linkedTx.title ?? undefined : undefined, ...withTx };
      }
      case "CheckIn": {
        const ci = checkInMap.get(r.entityId);
        return { name: ci?.task.title, alive: !!ci && !ci.task.deletedAt, transactionId: ci?.taskId };
      }
      case "Task": {
        const t = taskMap.get(r.entityId);
        return { name: t?.title, alive: !!t && !t.deletedAt };
      }
      case "TaskPenalty": {
        const p = penaltyMap.get(r.entityId);
        return { name: p?.task.title, alive: !!p && !p.task.deletedAt, transactionId: p?.taskId };
      }
      case "Fund": {
        const f = fundMap.get(r.entityId);
        return { name: f?.name, alive: !!f && !f.deletedAt, transactionId: f?.id };
      }
      case "FundTransaction": {
        const e = entryMap.get(r.entityId);
        return { name: e?.fund.name, alive: !!e && !e.fund.deletedAt, transactionId: e?.fundId };
      }
      case "Goal": {
        const g = goalMap.get(r.entityId);
        return { name: g?.name, alive: !!g && !g.deletedAt };
      }
      case "RecurringExpense": {
        const x = recurringMap.get(r.entityId);
        return { name: x?.name, alive: !!x && !x.deletedAt };
      }
      default:
        return {};
    }
  };

  const out: ActivityItem[] = [];
  for (const r of notifiable) {
    const view = describeAudit(r as AuditRow, {
      actorName: nickname(r.actorId),
      linked: linkedOf(r),
      money: formatMoney,
    });
    if (view) out.push({ ...view, dateKey: toDateKey(r.createdAt) });
  }
  return out;
}

