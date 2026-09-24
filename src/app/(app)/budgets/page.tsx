import Link from "next/link";
import { BudgetGroupCard, NewBudgetForm, type BudgetGroupItem } from "@/components/BudgetForms";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { clampMonth, monthLabel, shiftMonth } from "@/server/domain/stats";
import { budgetOverview } from "@/server/services/budgets";

const MAX_BACK = 12;

/**
 * 每月分類預算：共同預算與個人預算。
 *
 * 「已支出」全部來自 /stats 同一套統計口徑：
 *   - 共同：分類總支出
 *   - 個人：分帳後的實際負擔（不是誰付的錢）
 */
export default async function BudgetsPage({ searchParams }: PageProps<"/budgets">) {
  const { ctx } = await getAppContext();
  const sp = await searchParams;
  const today = toDateKey(new Date());
  const m = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const month = clampMonth(m, today, MAX_BACK);
  const { groups, summary, available, availablePersonal, members } = await budgetOverview(ctx, month);

  const label = (mk: string) => monthLabel(mk, today);
  const nowMonth = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const canPrev = prev >= shiftMonth(nowMonth, -(MAX_BACK - 1));
  const canNext = next <= nowMonth;

  return (
    <>
      <PageHeader title="預算" back="/more" />
      <div className="px-4">
        <div className="flex items-center justify-between rounded-full bg-white px-1.5 py-1.5 shadow-sm">
          {canPrev ? (
            <Link href={`/budgets?m=${prev}`} className="rounded-full px-3 py-1.5 text-sm text-brand-600 active:bg-stone-100" aria-label={`看 ${label(prev)}`}>‹ {label(prev)}</Link>
          ) : (
            <span className="px-3 py-1.5 text-sm text-stone-300">‹</span>
          )}
          <span className="text-sm font-semibold text-stone-800" data-testid="budget-month">{label(month)}</span>
          {canNext ? (
            <Link href={`/budgets?m=${next}`} className="rounded-full px-3 py-1.5 text-sm text-brand-600 active:bg-stone-100" aria-label={`看 ${label(next)}`}>{label(next)} ›</Link>
          ) : (
            <span className="px-3 py-1.5 text-sm text-stone-300">›</span>
          )}
        </div>

        {summary.count > 0 && (
          <div className="mt-4 px-1" data-testid="budget-summary">
            <p className="text-xs text-stone-500">{label(month)}預算合計</p>
            <p className="amount-lg mt-1 text-[2rem] text-stone-800">
              {formatMoney(summary.totalSpent)}
              <span className="text-base font-semibold text-stone-400"> / {formatMoney(summary.totalAmount)}</span>
            </p>
            <p className="mt-1 text-xs text-stone-500">
              共 {summary.count} 筆・
              <span className="text-emerald-700">{summary.ok} 個還好</span>
              {summary.near > 0 && <>・<span className="text-orange-600">{summary.near} 個快超過</span></>}
              {summary.over > 0 && <>・<span className="font-semibold text-red-600">{summary.over} 個超支</span></>}
            </p>
          </div>
        )}

        <SectionTitle right={<Link href={`/stats?m=${month}`} className="text-sm text-brand-600">看統計</Link>}>分類預算</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {groups.length === 0 ? (
            <Empty icon="target">
              {label(month)}還沒有預算。設一個試試看，超過也只是提醒，不會擋你記帳。
            </Empty>
          ) : (
            groups.map((g) => <BudgetGroupCard key={g.categoryId} group={g as BudgetGroupItem} canWrite={ctx.canWrite} />)
          )}
        </Card>

        {ctx.canWrite ? (
          <div className="mt-5">
            <NewBudgetForm month={month} options={available} personalOptions={availablePersonal} members={members} />
          </div>
        ) : (
          <p className="mt-5 text-center text-xs text-stone-400">你沒有這個帳本的編輯權限，只能查看預算。</p>
        )}

        <p className="mt-7 px-1 text-center text-xs leading-relaxed text-stone-400">
          共同預算的「已支出」與統計頁用同一套算法：支出減退款，轉帳、結算、餘額調整與投入基金都不算。<br />
          個人預算的「已使用」是分帳後的實際負擔，兩個人加起來剛好等於該分類的總支出。<br />
          預算只是提醒，不會影響任何金額、餘額或誰欠誰。
        </p>
      </div>
    </>
  );
}
