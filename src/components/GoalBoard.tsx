import Link from "next/link";
import { ArtIcon, ArtImage } from "./ArtIcon";
import { formatMoney } from "@/lib/money";

const TILT = ["-rotate-[2deg]", "rotate-[1.6deg]", "rotate-[1.1deg]", "-rotate-[1.5deg]"];

export interface BoardGoal {
  id: string;
  name: string;
  emoji: string;
  current: number;
  targetAmount: number;
  progress: number;
  status: string;
}

/** 目標佈告欄：跟任務用同一套木板 + 手撕紙條。 */
export function GoalBoard({ goals, mascot, empty }: { goals: BoardGoal[]; mascot?: string; empty: string }) {
  return (
    <div className="corkboard relative mt-4 px-2.5 pb-4 pt-7" data-testid="goal-board">
      <span className="absolute left-1/2 top-[-11px] z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-stone-800 bg-kraft px-3 py-0.5 text-[11.5px] font-extrabold shadow-md">
        願望佈告欄
      </span>
      {goals.length === 0 ? (
        <p className="note mx-auto max-w-[70%] px-3 py-4 text-center text-xs text-stone-600">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {goals.map((g, i) => (
            <Link key={g.id} href={`/goals/${g.id}`} className={`note note-pin relative px-2 py-2.5 text-center ${TILT[i % 4]}`} data-testid="goal-note">
              <ArtIcon name={g.emoji} size={20} className="mx-auto mb-1" />
              <p className="truncate text-[13px] font-extrabold leading-tight text-stone-800">{g.name}</p>
              <p className="tnum mt-0.5 truncate text-[9.5px] text-stone-500">
                {formatMoney(g.current)} / {formatMoney(g.targetAmount)}
              </p>
              <span className="stamp mt-1.5 text-[10px]">
                {g.status === "ACHIEVED" ? "達成" : `${Math.round(g.progress * 100)}%`}
              </span>
            </Link>
          ))}
        </div>
      )}
      {mascot && <ArtImage src={mascot} alt="角色插畫" className="absolute -bottom-4 right-1 h-14 w-14" />}
    </div>
  );
}
