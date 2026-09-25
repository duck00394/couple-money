import Link from "next/link";
import { ArtIcon } from "@/components/ArtIcon";
import { notFound } from "next/navigation";
import { GoalForm, GoalStatusButtons } from "@/components/GoalForms";
import { DeleteRequestPanel } from "@/components/DeleteRequest";
import { Card, Collapsible, PageHeader, ProgressBar, SectionTitle, TwoPartProgress } from "@/components/ui";
import { formatMoney, toInputString } from "@/lib/money";
import { percentText } from "@/server/domain/fund";
import { getAppContext } from "@/server/context";
import { listFunds } from "@/server/services/funds";
import { getGoal } from "@/server/services/goals";
import { pendingDeleteRequests } from "@/server/services/deleteRequests";
import { ArtTile } from "@/components/ArtIcon";

export default async function GoalPage({ params }: PageProps<"/goals/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  const goal = await getGoal(ctx, id);
  if (!goal) notFound();
  const [funds, deleteRequests] = await Promise.all([listFunds(ctx, { includeArchived: true }), pendingDeleteRequests(ctx, { entityType: "GOAL", entityId: goal.id })]);
  const achieved = goal.status === "ACHIEVED";

  return (
    <>
      <PageHeader title="目標" back="/goals" />
      <div className="px-4">
        <Card className="text-center">
          <ArtTile name={goal.emoji} tone="brand" size={64} className="mx-auto" />
          <h2 className="mt-2 text-xl font-bold">{goal.name}</h2>
          {goal.description && <p className="mt-1 text-sm text-stone-500">{goal.description}</p>}
          {achieved && <p className="mt-2 inline-block rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">已完成</p>}
          <p className="mt-4 text-xs text-stone-500">目前金額（實際基金金額）</p>
          <p className="text-3xl font-bold" data-testid="goal-current">{formatMoney(goal.current)}</p>
          <p className="text-sm text-stone-500">目標 {formatMoney(goal.targetAmount)}・{goal.fund ? percentText(goal.current, goal.targetAmount) : "未連結基金"}</p>
          {goal.fund ? (
            <TwoPartProgress real={goal.current} pending={goal.pending} target={goal.targetAmount} tone={achieved ? "green" : "brand"} className="mt-3 h-3" />
          ) : (
            <ProgressBar value={goal.progress} tone={achieved ? "green" : "brand"} className="mt-3 h-3" />
          )}
          {goal.pending > 0 && (
            <p className="mt-2 text-xs text-amber-700" data-testid="goal-pending">
              ＋尚未入金獎金 {formatMoney(goal.pending)}，含未入金為 {percentText(goal.current + goal.pending, goal.targetAmount)}（入金後才算進目前金額）
            </p>
          )}
          <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-xs text-stone-500">剩餘金額</p><p className="font-semibold" data-testid="goal-remaining">{formatMoney(goal.remaining)}</p></div>
            <div><p className="text-xs text-stone-500">開始</p><p className="font-semibold">{goal.startDate.replaceAll("-", "/")}</p></div>
            <div><p className="text-xs text-stone-500">目標日期</p><p className="font-semibold">{goal.deadline ? goal.deadline.replaceAll("-", "/") : "未設定"}</p></div>
          </div>
          {goal.daysLeft !== null && !achieved && (
            <p className="mt-2 text-sm text-stone-600">{goal.daysLeft >= 0 ? `還有 ${goal.daysLeft} 天` : `已超過目標日期 ${-goal.daysLeft} 天`}</p>
          )}
        </Card>

        {goal.fund ? (
          <Link href={`/funds/${goal.fund.id}`} className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-xs ring-1 ring-line/70 active:bg-stone-50">
            <ArtIcon name={goal.fund.emoji} size={24} />
            <span className="flex-1"><span className="block text-xs text-stone-500">目前金額來自基金</span><span className="font-semibold">{goal.fund.name}</span></span>
            <span className="text-sm font-semibold text-brand-600">去投入 ›</span>
          </Link>
        ) : (
          <Card className="mt-3 text-sm text-stone-600">這個目標沒有連結基金，完成時請手動標記。</Card>
        )}

        {deleteRequests[0] && (
          <div className="mt-3">
            <DeleteRequestPanel entityType="GOAL" entityId={goal.id} label="目標" pending={deleteRequests[0]} meId={ctx.me.userId} partnerName={ctx.partner?.nickname ?? null} />
          </div>
        )}

        {ctx.canWrite && (
          <>
            <SectionTitle>狀態</SectionTitle>
            {goal.fund ? (
              <Card className="text-sm text-stone-500">
                這個目標連結了基金「{goal.fund.name}」，實際基金金額達到 {formatMoney(goal.targetAmount)} 就會自動完成，不需要手動標記。
              </Card>
            ) : (
              <GoalStatusButtons id={goal.id} achieved={achieved} />
            )}
            <Collapsible title="編輯或刪除目標">
            <Card>
              <GoalForm
                funds={funds.map((f) => ({ id: f.id, name: `${f.name}${f.isArchived ? "（封存）" : ""}` }))}
                values={{
                  id: goal.id,
                  name: goal.name,
                  description: goal.description ?? "",
                  emoji: goal.emoji,
                  target: toInputString(goal.targetAmount),
                  startDate: goal.startDate,
                  deadline: goal.deadline ?? "",
                  fundId: goal.fund?.id ?? "",
                  isActive: goal.isActive,
                  updatedAt: goal.updatedAt,
                }}
              />
            </Card>
            {!deleteRequests[0] && (
              <DeleteRequestPanel entityType="GOAL" entityId={goal.id} label="目標" pending={null} meId={ctx.me.userId} partnerName={ctx.partner?.nickname ?? null} />
            )}
            </Collapsible>
          </>
        )}
      </div>
    </>
  );
}
