import Link from "next/link";
import { FundRow, GoalRow } from "@/components/GoalCard";
import { MoneyConcepts } from "@/components/MoneyConcepts";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listFunds } from "@/server/services/funds";
import { listGoals } from "@/server/services/goals";
import { pendingDeleteRequests } from "@/server/services/deleteRequests";
import { DeleteRequestPanel } from "@/components/DeleteRequest";
import { GoalBoard } from "@/components/GoalBoard";

export default async function GoalsPage({ searchParams }: PageProps<"/goals">) {
  const { ctx } = await getAppContext();
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const [goals, funds, requests, allGoals, allFunds] = await Promise.all([
    listGoals(ctx, { includeInactive: showAll }),
    listFunds(ctx, { includeArchived: showAll }),
    pendingDeleteRequests(ctx),
    listGoals(ctx, { includeInactive: true }),
    listFunds(ctx, { includeArchived: true }),
  ]);
  const toMe = requests.filter((r) => r.requestedById !== ctx.me.userId);
  const inProgress = goals.filter((g) => g.status === "ACTIVE");
  const done = goals.filter((g) => g.status === "ACHIEVED");
  const fundTotal = funds.filter((f) => !f.isArchived).reduce((a, f) => a + f.balance, 0);

  return (
    <>
      <PageHeader title="目標" right={<Link href="/goals/new" className="rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-3 py-1.5 text-sm font-semibold text-stone-800">＋ 目標</Link>} />
      <div className="px-4">
        {toMe.length > 0 && (
          <>
            <SectionTitle>等你確認的刪除</SectionTitle>
            <div className="space-y-2">
              {toMe.map((r) => {
                const name = r.entityType === "GOAL" ? allGoals.find((g) => g.id === r.entityId)?.name : allFunds.find((f) => f.id === r.entityId)?.name;
                return (
                  <div key={r.id}>
                    <p className="mb-1 px-1 text-sm font-medium">{r.entityType === "GOAL" ? "目標" : "基金"}：{name ?? "（已不存在）"}</p>
                    <DeleteRequestPanel entityType={r.entityType as "GOAL" | "FUND"} entityId={r.entityId} label={r.entityType === "GOAL" ? "目標" : "基金"} pending={r} meId={ctx.me.userId} partnerName={ctx.partner?.nickname ?? null} fromDetail={false} />
                  </div>
                );
              })}
            </div>
          </>
        )}
        <GoalBoard goals={inProgress} mascot="/assets/shisa.png" empty="還沒有進行中的目標" />

        <SectionTitle>目標明細</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {inProgress.length === 0 ? <Empty>還沒有進行中的目標，<Link href="/goals/new" className="font-semibold text-brand-600">建立一個</Link></Empty> : inProgress.map((g) => <GoalRow key={g.id} goal={g} />)}
        </Card>

        {done.length > 0 && (
          <>
            <SectionTitle>已完成</SectionTitle>
            <Card className="divide-y divide-line p-0">{done.map((g) => <GoalRow key={g.id} goal={g} />)}</Card>
          </>
        )}

        <SectionTitle right={<Link href="/funds/new" className="text-sm font-semibold text-brand-600">＋ 基金</Link>}>
          共同基金・{formatMoney(fundTotal)}
        </SectionTitle>
        <Card className="divide-y divide-line p-0">
          {funds.length === 0 ? <Empty>基金是「這筆錢要拿來做什麼」，例如旅遊、租屋、生日</Empty> : funds.map((f) => <FundRow key={f.id} fund={f} />)}
        </Card>

        <div className="mt-4"><MoneyConcepts /></div>
        <p className="mt-2 text-center text-sm">
          <Link href={showAll ? "/goals" : "/goals?all=1"} className="text-stone-500 underline">{showAll ? "隱藏停用與封存" : "顯示停用與封存"}</Link>
        </p>
      </div>
    </>
  );
}
