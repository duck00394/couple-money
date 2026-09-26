import Link from "next/link";
import { BarRow, MiniTrend } from "@/components/StatsBars";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { EMPTY_FILTER, filterToQuery } from "@/server/domain/search";
import { clampMonth, monthKeyRange, monthLabel, recentMonths, shiftMonth } from "@/server/domain/stats";
import { statsOverview } from "@/server/services/stats";
import { ArtIcon } from "@/components/ArtIcon";

const MAX_BACK = 12;
const TREND_MONTHS = 6;

/** 統計與報表：純讀取，不會寫入任何資料。 */
export default async function StatsPage({ searchParams }: PageProps<"/stats">) {
  const { ctx } = await getAppContext();
  const sp = await searchParams;
  const today = toDateKey(new Date());
  const m = Array.isArray(sp.m) ? sp.m[0] : sp.m;
  const month = clampMonth(m, today, MAX_BACK);
  const months = recentMonths(`${month}-01`, TREND_MONTHS);
  const { stats, trend, debt, funds } = await statsOverview(ctx, month, months);

  const { from, to } = monthKeyRange(month);
  const label = (mk: string) => monthLabel(mk, today);
  const nowMonth = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const canPrev = prev >= shiftMonth(nowMonth, -(MAX_BACK - 1));
  const canNext = next <= nowMonth;
  const link = (mk: string) => `/stats?m=${mk}`;
  const drill = (extra: Partial<typeof EMPTY_FILTER> = {}) =>
    `/transactions?${filterToQuery({ ...EMPTY_FILTER, from, to, ...extra })}`;

  const net = stats.totals.netExpense;
  const ratio = (v: number) => (net > 0 ? v / net : 0);
  const partnerName = ctx.partner?.nickname ?? "另一半";
  const hasAnything = stats.totals.count > 0;

  return (
    <>
      <PageHeader title="統計" />
      <div className="px-4">
        <div className="flex items-center justify-between rounded-full bg-white px-1.5 py-1.5 shadow-sm">
          {canPrev ? (
            <Link href={link(prev)} className="rounded-full px-3 py-1.5 text-sm text-brand-600 active:bg-stone-100" aria-label={`看 ${label(prev)}`}>‹ {label(prev)}</Link>
          ) : (
            <span className="px-3 py-1.5 text-sm text-stone-300">‹</span>
          )}
          <span className="text-sm font-semibold text-stone-800" data-testid="stats-month">{label(month)}</span>
          {canNext ? (
            <Link href={link(next)} className="rounded-full px-3 py-1.5 text-sm text-brand-600 active:bg-stone-100" aria-label={`看 ${label(next)}`}>{label(next)} ›</Link>
          ) : (
            <span className="px-3 py-1.5 text-sm text-stone-300">›</span>
          )}
        </div>

        {!hasAnything ? (
          <Card className="mt-3 p-0">
            <Empty icon="sprout" action={<Link href="/transactions/new" className="text-sm font-semibold text-brand-600">去記一筆 →</Link>}>
              {label(month)}還沒有任何紀錄
            </Empty>
          </Card>
        ) : (
          <>
            <Card className="mt-3 p-0">
              <Link href={drill()} className="block px-5 py-4 active:bg-stone-50">
                <p className="text-sm text-stone-500">淨支出</p>
                <p className="amount-lg mt-1 text-[2.4rem] text-stone-800" data-testid="stats-net-expense">{formatMoney(net)}</p>
                <p className="mt-1 text-[11px] text-stone-400">
                  {stats.totals.refund > 0
                    ? `支出 ${formatMoney(stats.totals.expense)} − 退款 ${formatMoney(stats.totals.refund)}`
                    : `共 ${stats.totals.count} 筆`}
                </p>
              </Link>
              <Link href={drill({ kind: "INCOME" })} className="flex items-baseline justify-between border-t border-line px-5 py-3.5 active:bg-stone-50">
                <span className="text-sm text-stone-500">收入<span className="ml-2 text-[11px] text-stone-400">不含轉帳與結算</span></span>
                <span className="amount text-xl text-brand-600" data-testid="stats-income">{formatMoney(stats.totals.income)}</span>
              </Link>
            </Card>

            <SectionTitle>誰掏錢（實際付出去的）</SectionTitle>
            <Card quiet className="divide-y divide-line p-0">
              <BarRow label="我" amount={stats.paid.me} ratio={ratio(stats.paid.me)} tone="me" testId="paid-me" />
              <BarRow label={partnerName} amount={stats.paid.partner} ratio={ratio(stats.paid.partner)} tone="partner" testId="paid-partner" />
              <BarRow label="共同帳戶" amount={stats.paid.joint} ratio={ratio(stats.paid.joint)} tone="joint" testId="paid-joint" />
              <p className="px-4 py-2.5 text-[11px] text-stone-400">三項加總 = 淨支出；退款收回的錢會從付款的那個帳戶扣回去。</p>
            </Card>

            <SectionTitle>誰負擔（分帳後實際要承擔的）</SectionTitle>
            <Card quiet className="divide-y divide-line p-0">
              <BarRow label="我" amount={stats.borne.me} ratio={ratio(stats.borne.me)} tone="me" testId="borne-me" />
              <BarRow label={partnerName} amount={stats.borne.partner} ratio={ratio(stats.borne.partner)} tone="partner" testId="borne-partner" />
              <p className="px-4 py-2.5 text-[11px] text-stone-400">
                共同帳戶付的錢，負擔還是會分給兩個人（只是不產生誰欠誰），所以這裡沒有「共同」這一項。
              </p>
            </Card>

            {stats.categories.length > 0 && (
              <>
                <SectionTitle right={<Link href={drill()} className="text-sm text-brand-600">看明細</Link>}>分類佔比</SectionTitle>
                <Card quiet className="divide-y divide-line p-0">
                  {stats.categories.map((c) => (
                    <BarRow
                      key={c.categoryId ?? "none"}
                      label={c.name}
                      icon={c.icon}
                      amount={c.amount}
                      ratio={ratio(c.amount)}
                      note={`${c.share}%`}
                      href={c.categoryId ? drill({ categoryId: c.categoryId }) : drill()}
                    />
                  ))}
                </Card>
              </>
            )}
          </>
        )}

        <SectionTitle>最近 {TREND_MONTHS} 個月</SectionTitle>
        <Card className="p-0">
          <MiniTrend points={trend} labelOf={label} />
          <p className="px-4 pb-3 text-[11px] text-stone-400">
            <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-600 align-middle" />淨支出
            <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-full bg-brand-200 ring-1 ring-inset ring-brand-400 align-middle" />收入
          </p>
        </Card>

        {stats.totals.transferCount > 0 && (
          <>
            <SectionTitle>轉帳</SectionTitle>
            <Card>
              <p className="text-sm" data-testid="stats-transfer">
                {stats.totals.transferCount} 筆・{formatMoney(stats.totals.transferAmount)}
              </p>
              <p className="mt-1 text-[11px] text-stone-400">帳戶間搬錢（含任務獎金入金），不算收入也不算支出。</p>
            </Card>
          </>
        )}

        <SectionTitle right={<Link href="/settle" className="text-sm text-brand-600">結算</Link>}>目前欠款</SectionTitle>
        <Card>
          <p className="text-sm" data-testid="stats-debt">
            {debt
              ? `${debt.from === ctx.me.userId ? `我要還 ${partnerName}` : `${partnerName} 要還我`} ${formatMoney(debt.amount)}`
              : "目前互不相欠"}
          </p>
          <p className="mt-1 text-[11px] text-stone-400">這是「目前」的狀態，不是{label(month)}的數字。</p>
        </Card>

        {funds.length > 0 && (
          <>
            <SectionTitle right={<Link href="/goals" className="text-sm text-brand-600">全部</Link>}>目前基金</SectionTitle>
            <Card quiet className="divide-y divide-line p-0">
              {funds.map((f) => (
                <div key={f.id} className="flex items-baseline justify-between gap-2 px-4 py-3 text-sm" data-testid="stats-fund">
                  <span className="flex min-w-0 flex-1 items-center gap-2 truncate"><ArtIcon name={f.emoji} size={15} className="text-stone-400" />{f.name}</span>
                  <span className="shrink-0 text-right">
                    <span className="tnum font-semibold">{formatMoney(f.real)}</span>
                    {f.pending !== 0 && <span className="ml-1 text-[11px] text-stone-400">尚未入金 {formatMoney(f.pending)}</span>}
                  </span>
                </div>
              ))}
              <p className="px-4 py-2.5 text-[11px] text-stone-400">尚未入金的任務獎金不是真實現金，所以分開顯示。</p>
            </Card>
          </>
        )}

        <p className="mt-6 text-center text-xs text-stone-400">統計只是讀取記帳資料，不會改動任何紀錄。</p>
      </div>
    </>
  );
}
