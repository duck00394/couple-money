import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { maskLabel } from "@/server/domain/streak";
import type { BookContext } from "@/server/services/books";
import type { TaskCard } from "@/server/services/tasks";
import { QuickCheckIn } from "./CheckInWidgets";

const STATUS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "✓ 已完成", cls: "bg-emerald-50 text-emerald-700" },
  PENDING: { label: "⏳ 待確認", cls: "bg-amber-50 text-amber-800" },
  REJECTED: { label: "被拒絕", cls: "bg-red-50 text-red-700" },
};

export function TaskRow({ card, ctx, showSchedule }: { card: TaskCard; ctx: BookContext; showSchedule?: boolean }) {
  const { task, today, stats } = card;
  const who = task.scope === "SHARED" ? "共同" : task.assigneeId === ctx.me.userId ? "我" : ctx.partner?.nickname ?? "";
  const status = today ? STATUS[today.status] : null;
  const doable = card.canCheckIn && (!today || today.status === "REJECTED");
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${task.isActive ? "" : "opacity-50"}`} data-testid="task-row">
      <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-100 text-lg">{task.emoji}</span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-stone-800">{task.title}{!task.isActive && "（停用）"}</p>
          <p className="truncate text-xs text-stone-500">
            {who}
            {showSchedule && `・${maskLabel(task.daysOfWeek)}`}
            {stats.current > 0 && <span className="text-orange-600">・🔥{stats.current} 天</span>}
            {task.rewardAmount > 0 && `・+${formatMoney(task.rewardAmount)}`}
            {task.requiresPhoto && "・📷"}
          </p>
        </div>
      </Link>
      {doable ? (
        task.requiresPhoto ? (
          <Link href={`/tasks/${task.id}`} className="press rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm" aria-label={`打卡 ${task.title}`}>打卡</Link>
        ) : (
          <QuickCheckIn taskId={task.id} title={task.title} />
        )
      ) : status && card.scheduledToday ? (
        <Link href={`/tasks/${task.id}`} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status.cls}`} data-testid="task-status">{status.label}</Link>
      ) : card.scheduledToday ? (
        <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs text-stone-500">未完成</span>
      ) : (
        <span className="text-xs text-stone-400">{stats.weekDone}/{stats.weekScheduled} 本週</span>
      )}
    </div>
  );
}
