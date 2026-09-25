import Link from "next/link";
import { ArtIcon, ArtImage } from "./ArtIcon";
import type { BookContext } from "@/server/services/books";
import type { TaskCard } from "@/server/services/tasks";

const TILT = ["-rotate-[2.2deg]", "rotate-[1.8deg]", "rotate-[1.2deg]", "-rotate-[1.4deg]"];

/**
 * 勞動佈告欄：木板 + 手撕紙條。
 * 每張紙條用 CSS Grid 排，並給不同的傾斜角度，做出釘上去的手感。
 */
export function TaskBoard({
  title,
  cards,
  ctx,
  mascot,
  empty,
}: {
  title: string;
  cards: TaskCard[];
  ctx: BookContext;
  mascot?: string;
  empty: string;
}) {
  const who = (c: TaskCard) =>
    c.task.scope === "SHARED"
      ? "共同"
      : c.subjectUserId === ctx.me.userId
        ? "我"
        : ctx.members.find((m) => m.userId === c.subjectUserId)?.nickname ?? "";

  return (
    <div className="corkboard relative mt-4 px-2.5 pb-4 pt-7" data-testid="task-board">
      <span className="absolute left-1/2 top-[-11px] z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-stone-800 bg-kraft px-3 py-0.5 text-xs font-semibold tracking-wide shadow-md">
        {title}
      </span>

      {cards.length === 0 ? (
        <p className="note mx-auto max-w-[70%] px-3 py-4 text-center text-xs text-stone-600">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {cards.map((c, i) => {
            const done = c.today?.status === "APPROVED";
            const pending = c.today?.status === "PENDING";
            return (
              <Link
                key={`${c.task.id}:${c.subjectKey}`}
                href={`/tasks/${c.task.id}`}
                className={`note note-pin relative px-2 py-2.5 text-center ${TILT[i % 4]}`}
                data-testid="task-note"
              >
                <ArtIcon name={c.task.emoji} size={20} className="mx-auto mb-1" />
                <p className="truncate text-[13px] font-semibold leading-tight text-stone-800">{c.task.title}</p>
                <p className="mt-0.5 truncate text-[9.5px] text-stone-500">
                  {who(c)}
                  {c.stats.current > 0 && `・連續 ${c.stats.current} 天`}
                </p>
                {c.task.rewardAmount > 0 && (
                  <p className="tnum mt-0.5 text-[10px] text-brand-600">+${Math.round(c.task.rewardAmount / 100)}</p>
                )}
                {done && <span className="stamp mt-1.5 text-[10px]">完</span>}
                {pending && <span className="stamp mt-1.5 text-[10px]">待確認</span>}
              </Link>
            );
          })}
        </div>
      )}

      {mascot && <ArtImage src={mascot} alt="角色插畫" className="absolute -bottom-4 right-1 h-14 w-14" />}
    </div>
  );
}
