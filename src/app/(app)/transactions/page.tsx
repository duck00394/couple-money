import Link from "next/link";
import { BatchCheckbox, BatchProvider } from "@/components/BatchBar";
import { FilterSheet } from "@/components/FilterSheet";
import { TxRow } from "@/components/TxRow";
import { Card, Empty, PageHeader } from "@/components/ui";
import { dateHeading, toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { activeFilterKeys, filterToQuery, parseFilter, SEARCH_KIND_LABEL, type TransactionFilter } from "@/server/domain/search";
import { searchOptions, searchTransactions, type SearchItem } from "@/server/services/search";
import { pendingRecurring } from "@/server/services/recurring";
import { ArtIcon } from "@/components/ArtIcon";

const PAGE = 50;

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const { ctx } = await getAppContext();
  const sp = await searchParams;
  const filter = parseFilter(sp);
  const limit = Math.min(1000, Math.max(PAGE, Number(sp.limit) || PAGE));
  const [{ items, totals }, options, duePending] = await Promise.all([
    searchTransactions(ctx, filter, { take: limit }),
    searchOptions(ctx),
    pendingRecurring(ctx),
  ]);
  const active = activeFilterKeys(filter);
  const filtering = active.length > 0;

  const groups = new Map<string, SearchItem[]>();
  for (const tx of items) {
    const key = toDateKey(tx.occurredAt);
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }

  const nameOf = (list: Array<{ id: string; name: string }>, id: string | null) => list.find((x) => x.id === id)?.name ?? "（已不存在）";
  const chipLabel: Record<keyof TransactionFilter, (f: TransactionFilter) => string> = {
    q: (f) => `「${f.q}」`,
    from: (f) => `從 ${f.from}`,
    to: (f) => `到 ${f.to}`,
    kind: (f) => SEARCH_KIND_LABEL[f.kind!],
    categoryId: (f) => nameOf(options.categories, f.categoryId),
    person: (f) => nameOf(options.people, f.person),
    accountId: (f) => nameOf(options.accounts, f.accountId),
    fundId: (f) => nameOf(options.funds, f.fundId),
    tag: (f) => `#${f.tag}`,
    min: (f) => `≥ ${formatMoney(f.min!)}`,
    max: (f) => `≤ ${formatMoney(f.max!)}`,
  };
  const query = filterToQuery(filter);

  return (
    <>
      <PageHeader
        title="記帳"
        right={<Link href="/transactions/new?from=/transactions" className="press rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-3.5 py-2 text-sm font-semibold text-stone-800 shadow-sm active:bg-brand-300">＋ 記一筆</Link>}
      />
      <div className="px-4">
        {/* key：條件改變時重建，讓表單預設值跟著目前條件 */}
        <FilterSheet key={query} filter={filter} activeCount={active.length} options={options} />

        {filtering ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="filter-chips">
            {active.map((k) => {
              const rest = filterToQuery(filter, [k]);
              return (
                <Link key={k} href={`/transactions${rest ? `?${rest}` : ""}`} className="rounded-full bg-brand-100 px-2.5 py-1 text-xs text-brand-700" aria-label={`移除條件 ${chipLabel[k](filter)}`}>
                  {chipLabel[k](filter)}
                  <ArtIcon name="close" size={12} className="ml-1 inline-block align-[-1px]" />
                </Link>
              );
            })}
            <Link href="/transactions" className="px-1 text-xs text-stone-500 underline">清除全部</Link>
          </div>
        ) : (
          /* 捷徑：4 欄 icon 磚，佔的高度只有原本的一半，記帳列表才會更早出現 */
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {[
              { href: "/transactions/transfer", icon: "transfer", label: "轉帳" },
              { href: "/transactions/refund", icon: "refund", label: "退款" },
              { href: "/recurring", icon: "calendar-clock", label: "固定支出", badge: duePending.length },
              { href: "/settle", icon: "settle", label: "結算" },
              { href: "/stats", icon: "stats", label: "統計" },
              { href: "/accounts", icon: "credit-card", label: "帳戶" },
            ].map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="press relative flex flex-col items-center gap-1 rounded-2xl bg-white px-1 py-2.5 shadow-xs ring-1 ring-line/70 active:bg-stone-50"
              >
                <ArtIcon name={s.icon} size={19} className="text-stone-500" />
                <span className="text-[11px] leading-none text-stone-600">{s.label}</span>
                {!!s.badge && (
                  <span className="absolute right-1 top-1 rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-1.5 text-[10px] font-semibold leading-4 text-stone-800">{s.badge}</span>
                )}
              </Link>
            ))}
            <a
              href="/api/export/transactions"
              download
              className="press flex flex-col items-center gap-1 rounded-2xl bg-white px-1 py-2.5 shadow-xs ring-1 ring-line/70 active:bg-stone-50"
              data-testid="export-all"
            >
              <ArtIcon name="download" size={19} className="text-stone-500" />
              <span className="whitespace-nowrap text-[11px] leading-none text-stone-600">匯出 CSV</span>
            </a>
          </div>
        )}

        {filtering && (
          <Card className="mt-3 grid grid-cols-3 gap-2 px-3 py-3.5 text-center" data-testid="search-totals">
            <div><p className="text-[11px] text-stone-500">共</p><p className="amount">{totals.count} 筆</p></div>
            <div><p className="text-[11px] text-stone-500">實際淨支出</p><p className="amount" data-testid="search-net-expense">{formatMoney(totals.netExpense)}</p></div>
            <div><p className="text-[11px] text-stone-500">收入</p><p className="amount text-emerald-600">{formatMoney(totals.income)}</p></div>
            {(totals.refund > 0 || totals.transferCount > 0) && (
              <p className="col-span-3 text-[11px] text-stone-500">
                {totals.refund > 0 && `支出 ${formatMoney(totals.expense)} − 退款 ${formatMoney(totals.refund)}`}
                {totals.refund > 0 && totals.transferCount > 0 && "・"}
                {totals.transferCount > 0 && `轉帳 ${totals.transferCount} 筆 ${formatMoney(totals.transferAmount)}（不算收支）`}
              </p>
            )}
          </Card>
        )}

        {filtering && (
          <a
            href={`/api/export/transactions${query ? `?${query}` : ""}`}
            download
            className="press mt-2 flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-center text-sm font-semibold text-brand-600 shadow-xs ring-1 ring-line/70 active:bg-stone-50"
            data-testid="export-filtered"
          >
            <ArtIcon name="download" size={16} />
            把這 {totals.count} 筆匯出成 CSV
          </a>
        )}

        <BatchProvider categories={ctx.canWrite ? options.categories.map((c) => ({ id: c.id, name: c.name, icon: "", kind: c.kind })) : []}>
        <div className="mt-4">
          {items.length === 0 && (
            <Card className="p-0"><Empty icon={filtering ? "search" : "transaction"}>{filtering ? "找不到符合條件的紀錄" : "還沒有任何紀錄"}</Empty></Card>
          )}
          {[...groups].map(([key, list], i, all) => {
            const spent = list.filter((t) => t.type === "EXPENSE").reduce((a, t) => a + t.amount, 0) - list.filter((t) => t.type === "REFUND").reduce((a, t) => a + t.amount, 0);
            // 還沒載完時，最後一天可能只載到一半，小計會少算 → 那一天不顯示小計
            const partial = i === all.length - 1 && totals.count > items.length;
            return (
              <section key={key} className="mb-4">
                <div className="mb-1.5 flex items-baseline justify-between px-1.5 text-xs">
                  <span className="font-semibold text-stone-500">{dateHeading(key)}</span>
                  {spent !== 0 && !partial && <span className="tnum text-stone-400">支出 {formatMoney(spent)}</span>}
                </div>
                <Card className="divide-y divide-line p-0">
                  {list.map((tx) => (
                    <div key={tx.id} className="flex items-center">
                      {ctx.canWrite && <BatchCheckbox id={tx.id} label={tx.title ?? "這筆紀錄"} />}
                      <div className="min-w-0 flex-1">
                        <TxRow tx={tx} ctx={ctx} />
                      </div>
                    </div>
                  ))}
                </Card>
              </section>
            );
          })}
          {items.length >= limit && totals.count > items.length && (
            <Link href={`/transactions?${query ? `${query}&` : ""}limit=${limit + PAGE}`} className="press mb-4 block rounded-2xl bg-white py-3.5 text-center text-sm font-semibold text-brand-600 shadow-sm" scroll={false}>
              載入更多（還有 {totals.count - items.length} 筆）
            </Link>
          )}
        </div>
        </BatchProvider>
      </div>
    </>
  );
}
