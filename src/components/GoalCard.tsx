import Link from "next/link";
import { percentText } from "@/server/domain/fund";
import { formatMoney } from "@/lib/money";
import type { GoalView } from "@/server/services/goals";
import type { FundView } from "@/server/services/funds";
import { ProgressBar, TwoPartProgress } from "./ui";
import { ArtTile } from "./ArtIcon";

export function GoalRow({ goal, big }: { goal: GoalView; big?: boolean }) {
  const achieved = goal.status === "ACHIEVED";
  return (
    <Link href={`/goals/${goal.id}`} className="block px-4 py-3 active:bg-stone-50" data-testid="goal-row">
      <div className="flex items-center gap-3">
        <ArtTile name={goal.emoji} tone="brand" size={big ? 52 : 44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-stone-800">{goal.name}{achieved && <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">已完成</span>}{!goal.isActive && <span className="ml-1 text-xs text-stone-400">（停用）</span>}</p>
          <p className="truncate text-xs text-stone-500">
            {goal.fund ? `${formatMoney(goal.current)} / ${formatMoney(goal.targetAmount)}` : "未連結基金"}
            {goal.daysLeft !== null && !achieved && (goal.daysLeft >= 0 ? `・剩 ${goal.daysLeft} 天` : "・已過目標日期")}
          </p>
        </div>
        <span className="amount text-sm text-stone-800" data-testid="goal-percent">{goal.fund ? percentText(goal.current, goal.targetAmount) : achieved ? "100%" : "—"}</span>
      </div>
      {goal.fund ? (
        <TwoPartProgress real={goal.current} pending={goal.pending} target={goal.targetAmount} tone={achieved ? "green" : "brand"} className="mt-2" />
      ) : (
        <ProgressBar value={goal.progress} tone={achieved ? "green" : "brand"} className="mt-2" />
      )}
      {goal.pending > 0 && <p className="mt-1 text-[11px] text-amber-700">＋尚未入金獎金 {formatMoney(goal.pending)}（入金後才算進目前金額）</p>}
      {big && goal.fund && !achieved && <p className="mt-1 text-right text-xs text-stone-500">還差 {formatMoney(goal.remaining)}</p>}
    </Link>
  );
}

export function FundRow({ fund }: { fund: FundView }) {
  return (
    <Link href={`/funds/${fund.id}`} className={`block px-4 py-3 active:bg-stone-50 ${fund.isArchived ? "opacity-50" : ""}`} data-testid="fund-row">
      <div className="flex items-center gap-3">
        <ArtTile name={fund.emoji} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-stone-800">{fund.name}{fund.isArchived && "（封存）"}</p>
          <p className="truncate text-xs text-stone-500">
            {fund.targetAmount ? `目標 ${formatMoney(fund.targetAmount)}・還差 ${formatMoney(fund.remaining ?? 0)}` : "未設定目標金額"}
          </p>
        </div>
        <span className="amount text-stone-800">{formatMoney(fund.balance)}</span>
      </div>
      {fund.targetAmount ? <TwoPartProgress real={fund.balance} pending={fund.pending} target={fund.targetAmount} className="mt-2" /> : null}
      {fund.pending !== 0 && <p className="mt-1 text-[11px] text-amber-700">尚未入金獎金 {fund.pending < 0 ? "-" : "+"}{formatMoney(Math.abs(fund.pending))}</p>}
    </Link>
  );
}
