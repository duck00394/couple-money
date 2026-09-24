import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { FREQUENCY_HINT, maskLabel } from "@/server/domain/streak";
import type { BookContext } from "@/server/services/books";
import type { TaskCard } from "@/server/services/tasks";
import { QuickCheckIn } from "./CheckInWidgets";
import { ArtIcon, ArtTile } from "./ArtIcon";

const STATUS: Record<string, { label: string; icon?: string; cls: string }> = {
  APPROVED: { label: "已完成", icon: "check", cls: "bg-brand-100 text-brand-700" },
  PENDING: { label: "待確認", icon: "hourglass", cls: "bg-amber-50 text-amber-800" },
  REJECTED: { label: "被拒絕", cls: "bg-red-50 text-red-700" },
};

/** 週期的白話說明，畫面上不出現 DAILY／WEEKLY／PER_TIME 這種程式用語。 */
function freqText(card: TaskCard) {
  const f = card.task.frequency as keyof typeof FREQUENCY_HINT;
  if (f === "CUSTOM") return `${maskLabel(card.task.daysOfWeek)}・每天最多一次`;
  return FREQUENCY_HINT[f] ?? "";
}

export function TaskRow({ card, ctx, showSchedule }: { card: TaskCard; ctx: BookContext; showSchedule?: boolean }) {
  const { task, today, stats } = card;
  const who = task.scope === "SHARED" ? "共同" : task.scope === "EACH" ? (card.subjectKey === ctx.me.userId ? "我（各自）" : `${ctx.partner?.nickname ?? "另一半"}（各自）`) : task.assigneeId === ctx.me.userId ? "我" : ctx.partner?.nickname ?? "";
  // 「每週」看的是整週，所以狀態標籤要看這一週有沒有完成，而不是今天
  const status = card.weekly
    ? (card.doneThisWeek ? STATUS.APPROVED : null)
    : today ? STATUS[today.status] : null;
  const doable = card.canCheckIn && (card.perTime || card.weekly || !today || today.status === "REJECTED");
  const mine = card.group !== "PARTNER";
  return (
    <div className={`px-4 py-3 ${task.isActive ? "" : "opacity-50"}`} data-testid="task-row">
      <div className="flex items-center gap-3">
        <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <ArtTile name={task.emoji} size={40} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-stone-800">{task.title}{!task.isActive && "（停用）"}</p>
            <p className="truncate text-xs text-stone-500">
              {who}・<span data-testid="task-frequency">{freqText(card)}</span>
              {task.rewardAmount > 0 && `・一次 +${formatMoney(task.rewardAmount)}`}
              {task.requiresPhoto && "・需照片"}
            </p>
            {showSchedule && !card.perTime && stats.current > 0 && (
              <p className="truncate text-xs text-brand-600">連續 {stats.current} {card.weekly ? "週" : "天"}</p>
            )}
          </div>
        </Link>
        {doable ? (
          task.requiresPhoto ? (
            <Link href={`/tasks/${task.id}`} className="press shrink-0 rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-4 py-2 text-sm font-semibold text-stone-800 shadow-sm" aria-label={`打卡 ${task.title}`}>
              {card.perTime && card.todayCount > 0 ? "再完成一次" : "打卡"}
            </Link>
          ) : (
            <QuickCheckIn taskId={task.id} title={task.title} label={card.perTime && card.todayCount > 0 ? "＋再完成一次" : "打卡"} />
          )
        ) : status && card.scheduledToday ? (
          <Link href={`/tasks/${task.id}`} className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${status.cls}`} data-testid="task-status">
            {status.icon && <ArtIcon name={status.icon} size={13} />}
            {card.weekly ? "本週已完成" : status.label}
          </Link>
        ) : card.scheduledToday ? (
          <span className="shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-xs text-stone-500">未完成</span>
        ) : (
          <span className="shrink-0 text-xs text-stone-400">{stats.weekDone}/{stats.weekScheduled} 本週</span>
        )}
      </div>

      {/* 「每週」任務：一眼看到這一週做了沒 */}
      {card.weekly && (
        <p className={`mt-1.5 pl-[52px] text-xs font-semibold ${card.doneThisWeek ? "text-brand-700" : "text-stone-500"}`} data-testid="weekly-state">
          {card.doneThisWeek
            ? `本週已完成${card.task.rewardAmount > 0 ? `・+${formatMoney(card.task.rewardAmount)}` : ""}`
            : "本週還可以完成一次"}
        </p>
      )}

      {/* 「每次」任務：今天累計做了幾次、賺了多少，不用點進去也看得到 */}
      {card.perTime && card.todayCount > 0 && (
        <p className="mt-1.5 pl-[52px] text-xs font-semibold text-brand-700" data-testid="per-time-count">
          今天已完成 {card.todayCount} 次・+{formatMoney(card.todayReward)}
        </p>
      )}

      {/* 另一半今天的狀態：不用切分頁就看得到 */}
      {mine && card.partner && (
        <p className="mt-1 pl-[52px] text-xs text-stone-500" data-testid="partner-state">
          {card.partner.nickname}：{card.partner.count > 0
            ? `${card.weekly ? "本週已完成" : "已完成"}${card.perTime ? ` ${card.partner.count} 次` : ""}`
            : card.weekly ? "本週還沒完成" : "還沒完成"}
        </p>
      )}
    </div>
  );
}
