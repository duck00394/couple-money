import Link from "next/link";
import { FundRow, GoalRow } from "@/components/GoalCard";
import { MoneyConcepts } from "@/components/MoneyConcepts";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listFunds } from "@/server/services/funds";
import { listGoals } from "@/server/services/goals";

/**
 * 基金頁（底部導覽的第四格）。
 *
 * 「基金」是錢真的存在哪一個用途裡，所以這裡就是：現在存了多少、目標多少、還差多少。
 * 目標（要不要買、幾月幾號之前）是另一件事，放在下面並連到 /goals。
 */
export default async function FundsPage({ searchParams }: PageProps<"/funds">) {
  const { ctx } = await getAppContext();
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const [funds, goals] = await Promise.all([
    listFunds(ctx, { includeArchived: showAll }),
    listGoals(ctx),
  ]);
  const active = funds.filter((f) => !f.isArchived);
  const total = active.reduce((a, f) => a + f.balance, 0);
  const inProgress = goals.filter((g) => g.status === "ACTIVE");

  return (
    <>
      <PageHeader
        title="基金"
        right={
          ctx.canWrite ? (
            <Link href="/funds/new" className="rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-3 py-1.5 text-sm font-semibold text-stone-800" data-testid="new-fund">
              ＋ 新增基金
            </Link>
          ) : undefined
        }
      />
      <div className="px-4">
        <Card className="px-5 py-5">
          <p className="text-[13px] text-stone-500">目前存在基金裡的錢</p>
          <p className="amount-lg mt-1 text-[2.2rem] text-stone-800" data-testid="fund-total">{formatMoney(total)}</p>
          <p className="mt-1 text-xs text-stone-500">共 {active.length} 個基金・錢還在帳戶裡，只是指定了用途</p>
        </Card>

        <SectionTitle>基金進度</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {funds.length === 0 ? (
            <Empty icon="piggy-bank" action={<Link href="/funds/new" className="text-sm font-semibold text-brand-600">建立第一個基金 →</Link>}>
              基金是「這筆錢要拿來做什麼」，例如旅遊、租屋、生日
            </Empty>
          ) : (
            funds.map((f) => <FundRow key={f.id} fund={f} />)
          )}
        </Card>

        <SectionTitle right={<Link href="/goals" className="text-sm text-brand-600">全部目標</Link>}>共同目標</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {inProgress.length === 0 ? (
            <Empty icon="target" action={<Link href="/goals/new" className="text-sm font-semibold text-brand-600">設定一個 →</Link>}>
              還沒有進行中的目標
            </Empty>
          ) : (
            inProgress.slice(0, 3).map((g) => <GoalRow key={g.id} goal={g} />)
          )}
        </Card>

        <div className="mt-4"><MoneyConcepts /></div>
        <p className="mt-2 text-center text-sm">
          <Link href={showAll ? "/funds" : "/funds?all=1"} className="text-stone-500 underline">{showAll ? "隱藏封存的基金" : "顯示封存的基金"}</Link>
        </p>
      </div>
    </>
  );
}
