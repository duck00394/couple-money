"use client";

import { useDemo } from "@/demo/store";
import { useMoney } from "./CurrencyContext";
import type { TaskCardView } from "@/demo/select";
import { ArtTile } from "./ArtIcon";
import { cx } from "./ui";

/**
 * 試用模式的任務列。
 *
 * 為什麼不直接重用正式的 `<TaskRow>`：它吃的是 Prisma 的 `Task`（frequency、
 * daysOfWeek、scope、isActive⋯⋯），而且打卡按鈕 `<QuickCheckIn>` 綁在 server action 上。
 * 在試用模式重用它就得假造一整個 Prisma row，還得想辦法擋住那個 action —— 那正是規格
 * 點 9 警告的「UI 擋住但還是打到正式 API」。所以這裡寫一個只會 dispatch 到記憶體
 * store 的版本，視覺元件（ArtTile、字級、顏色）仍然沿用同一套。
 */
export function DemoTaskRow({ card, nickname }: { card: TaskCardView; nickname: string }) {
  const fmtMoney = useMoney();
  const { run, todayKey } = useDemo();
  const done = card.doneToday;

  return (
    <div className="flex items-center gap-3 px-4 py-3" data-testid="demo-task-row">
      <ArtTile name={card.icon} tone={done ? "brand" : "neutral"} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-snug text-stone-800">{card.name}</p>
        <p className="truncate text-xs leading-snug text-stone-500">
          {nickname}・{card.scheduleText}
          {card.rewardAmount > 0 && `・${fmtMoney(card.rewardAmount)}`}
        </p>
        {card.earned > 0 && (
          <p className="mt-0.5 truncate text-[11px] text-brand-600">累積賺到 {fmtMoney(card.earned)}</p>
        )}
      </div>

      {!card.dueToday ? (
        <span className="shrink-0 text-xs text-stone-400">今天沒排</span>
      ) : done ? (
        <button
          type="button"
          onClick={() => run({ kind: "task.undoCheckIn", taskId: card.id, userId: card.subjectId, dateKey: todayKey })}
          className="shrink-0 text-xs font-semibold text-stone-400 underline-offset-2 hover:underline"
          data-testid="demo-undo-checkin"
        >
          已完成 ・ 取消
        </button>
      ) : (
        <button
          type="button"
          onClick={() => run({ kind: "task.checkIn", taskId: card.id, userId: card.subjectId, dateKey: todayKey })}
          className={cx(
            "press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500",
            "px-3.5 py-2 text-sm font-semibold text-white shadow-md",
          )}
          data-testid="demo-checkin"
        >
          打卡
        </button>
      )}
    </div>
  );
}
