import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { FREQUENCY_HINT, maskLabel } from "@/server/domain/streak";
import type { BookContext } from "@/server/services/books";
import type { TaskCard } from "@/server/services/tasks";
import { QuickCheckIn } from "./CheckInWidgets";
import { ArtIcon, ArtTile } from "./ArtIcon";

/** 週期的白話說明，畫面上不出現 DAILY／WEEKLY／PER_TIME 這種程式用語。 */
function freqText(card: TaskCard) {
  const f = card.task.frequency as keyof typeof FREQUENCY_HINT;
  if (f === "CUSTOM") return maskLabel(card.task.daysOfWeek);
  if (f === "WEEKLY") return "每週一次";
  if (f === "PER_TIME") return "做一次賺一次";
  return "每天一次";
}

/** 這一列屬於誰（短詞，不佔位）。 */
function whoText(card: TaskCard, ctx: BookContext) {
  const { task } = card;
  if (task.scope === "SHARED") return "共同";
  // EACH 只寫「誰」就好：兩人各自完成這件事，第三行的「對方：…」已經講清楚了
  if (task.scope === "EACH") return card.subjectKey === ctx.me.userId ? "我" : ctx.partner?.nickname ?? "另一半";
  return task.assigneeId === ctx.me.userId ? "我" : ctx.partner?.nickname ?? "";
}

/**
 * 任務列的資訊層級（三層，不要每一行都粗）：
 *   第一層  任務名稱 —— 唯一的粗體，視覺主角
 *   第二層  誰做・週期 ＋ 靠右的金額 —— 常規字重，不截斷
 *   第三層  今天／本週的進度與對方狀態 —— 更小更淡
 *
 * 「打卡」是實心按鈕（可操作），「已完成」是安靜的文字狀態（不再長得像按鈕）。
 */
export function TaskRow({ card, ctx, showSchedule }: { card: TaskCard; ctx: BookContext; showSchedule?: boolean }) {
  const { task, today, stats } = card;
  const done = card.weekly ? card.doneThisWeek : !!today && (today.status === "APPROVED" || today.status === "PENDING");
  const pending = !card.weekly && today?.status === "PENDING";
  const doable = card.canCheckIn && (card.perTime || card.weekly || !today || today.status === "REJECTED");
  const mine = card.group !== "PARTNER";

  // 第三層：今天／本週實際做了什麼
  const progress =
    card.perTime && card.todayCount > 0 ? `今天 ${card.todayCount} 次・共 ${formatMoney(card.todayReward)}`
    : card.weekly && card.doneThisWeek ? "本週已完成"
    : showSchedule && !card.perTime && stats.current > 0 ? `連續 ${stats.current} ${card.weekly ? "週" : "天"}`
    : "";
  const partner = mine && card.partner
    ? `${card.partner.nickname}：${card.partner.count > 0 ? (card.weekly ? "本週已完成" : card.perTime ? `${card.partner.count} 次` : "已完成") : "還沒完成"}`
    : "";

  return (
    <div className={`px-4 py-3 ${task.isActive ? "" : "opacity-50"}`} data-testid="task-row">
      <div className="flex items-center gap-3">
        <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <ArtTile name={task.emoji} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-stone-800">
              {task.title}{!task.isActive && "（停用）"}
            </p>
            <p className="mt-0.5 truncate text-xs leading-snug text-stone-500" data-testid="task-frequency">
              {whoText(card, ctx)}・{freqText(card)}
            </p>
          </div>
          {task.rewardAmount > 0 && (
            <span className="tnum shrink-0 text-[15px] text-brand-700">+{formatMoney(task.rewardAmount)}</span>
          )}
        </Link>

        {doable ? (
          task.requiresPhoto ? (
            <Link
              href={`/tasks/${task.id}`}
              className="press shrink-0 whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-2 text-[13px] font-semibold text-white shadow-xs"
              aria-label={`打卡 ${task.title}`}
            >
              {card.perTime && card.todayCount > 0 ? "再一次" : "打卡"}
            </Link>
          ) : (
            <QuickCheckIn taskId={task.id} title={task.title} label={card.perTime && card.todayCount > 0 ? "再一次" : "打卡"} />
          )
        ) : done && card.scheduledToday ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-stone-400" data-testid="task-status">
            <ArtIcon name={pending ? "hourglass" : "check"} size={13} />
            {pending ? "待確認" : "已完成"}
          </span>
        ) : today?.status === "REJECTED" ? (
          <span className="shrink-0 text-xs text-red-600" data-testid="task-status">被退回</span>
        ) : card.scheduledToday ? (
          <span className="shrink-0 text-xs text-stone-400">未完成</span>
        ) : (
          <span className="tnum shrink-0 text-xs text-stone-400">{stats.weekDone}/{stats.weekScheduled}</span>
        )}
      </div>

      {(progress || partner) && (
        <p className="mt-1 pl-[46px] text-[11px] leading-snug text-stone-400">
          {progress}
          {progress && partner && "　"}
          {partner}
        </p>
      )}
    </div>
  );
}
