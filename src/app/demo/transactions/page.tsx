"use client";

/**
 * 試用模式的記帳明細。
 *
 * 比正式模式簡化的地方：沒有 FilterSheet、沒有批次選取、沒有關鍵字搜尋。
 * 那三個都是「資料多了才需要」的管理功能，試用只有 20 幾筆，放上去反而讓人找不到重點。
 * 列本身仍然是同一個 `<TxRow>`。
 */
import Link from "next/link";
import { TxRow } from "@/components/TxRow";
import { Card, Empty, PageHeader } from "@/components/ui";
import { dateHeading } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { INCOME_EXPENSE_TYPES } from "@/server/domain/ledger";
import { sum } from "@/lib/money";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoTransactionsPage() {
  const { state, todayKey } = useDemo();
  const ctx = select.demoCtx(state);
  const rows = select.sortedTxs(state);

  // 依日期分組（同一天放一起）
  const groups: Array<{ key: string; items: typeof rows }> = [];
  for (const tx of rows) {
    const last = groups.at(-1);
    if (last && last.key === tx.occurredOn) last.items.push(tx);
    else groups.push({ key: tx.occurredOn, items: [tx] });
  }

  const flows = rows.filter((t) => INCOME_EXPENSE_TYPES.includes(t.type));
  const expense = sum(flows.filter((t) => t.type === "EXPENSE").map((t) => t.amount))
    - sum(flows.filter((t) => t.type === "REFUND").map((t) => t.amount));
  const income = sum(flows.filter((t) => t.type === "INCOME").map((t) => t.amount));

  return (
    <>
      <PageHeader
        title="記帳明細"
        back="/demo"
        right={
          <Link href="/demo/transactions/new" className="text-sm font-semibold text-brand-600" data-testid="demo-new-tx-link">
            ＋ 記一筆
          </Link>
        }
      />
      <div className="px-4">
        <Card className="grid grid-cols-3 divide-x divide-line px-0 py-3 text-center" data-testid="demo-tx-totals">
          <div className="px-2">
            <p className="text-xs text-stone-500">筆數</p>
            <p className="tnum mt-1 text-[17px] font-semibold text-stone-800">{rows.length}</p>
          </div>
          <div className="px-2">
            <p className="text-xs text-stone-500">支出</p>
            <p className="amount mt-1 text-[17px] text-stone-800">{formatMoney(expense)}</p>
          </div>
          <div className="px-2">
            <p className="text-xs text-stone-500">收入</p>
            <p className="amount mt-1 text-[17px] text-brand-700">{formatMoney(income)}</p>
          </div>
        </Card>

        {rows.length === 0 ? (
          <Card quiet className="mt-3 p-0">
            <Empty
              icon="transaction"
              action={<Link href="/demo/transactions/new" className="text-sm font-semibold text-brand-600">記第一筆 →</Link>}
            >
              還沒有任何紀錄
            </Empty>
          </Card>
        ) : (
          <div className="mt-2 space-y-4" data-testid="demo-tx-list">
            {groups.map((g) => (
              <section key={g.key}>
                <div className="mb-1.5 flex items-baseline justify-between px-1.5 text-xs">
                  <span className="font-semibold text-stone-500">
                    {g.key === todayKey ? "今天" : dateHeading(g.key)}
                  </span>
                  <span className="tnum text-stone-400">{g.items.length} 筆</span>
                </div>
                <Card quiet className="divide-y divide-line p-0">
                  {g.items.map((tx) => (
                    <TxRow key={tx.id} tx={select.toTxRow(state, tx)} ctx={ctx} base="/demo" />
                  ))}
                </Card>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
