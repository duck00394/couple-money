"use client";

/**
 * 試用模式的統計頁。
 *
 * 展示重點是「共同 / 我 / 另一半」各自負擔多少 —— 那是這個 App 跟一般記帳 App
 * 最不一樣的地方，比一堆圖表更值得讓朋友看到。
 */
import { ArtTile } from "@/components/ArtIcon";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { toIconKey } from "@/lib/icons";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoStatsPage() {
  const { state, todayKey } = useDemo();
  const summary = select.monthSummary(state, todayKey);
  const cats = select.categoryStats(state, todayKey);
  const burden = select.burdenByUser(state, todayKey);
  const bal = select.balances(state);
  const ctx = select.demoCtx(state);

  const burdenTotal = burden.reduce((a, b) => a + b.amount, 0);

  return (
    <>
      <PageHeader title="統計" back="/demo" />
      <div className="px-4">
        <SectionTitle>{summary.label}</SectionTitle>
        <Card className="grid grid-cols-3 divide-x divide-line px-0 py-3 text-center" data-testid="demo-stats-summary">
          <div className="px-2">
            <p className="text-xs text-stone-500">支出</p>
            <p className="amount mt-1 text-[17px] text-stone-800">{formatMoney(summary.expense)}</p>
          </div>
          <div className="px-2">
            <p className="text-xs text-stone-500">收入</p>
            <p className="amount mt-1 text-[17px] text-brand-700">{formatMoney(summary.income)}</p>
          </div>
          <div className="px-2">
            <p className="text-xs text-stone-500">結餘</p>
            <p className="amount mt-1 text-[17px] text-stone-800">{formatMoney(summary.income - summary.expense)}</p>
          </div>
        </Card>

        {/* ── 誰負擔了多少：這個 App 的重點 ── */}
        <SectionTitle>這個月誰負擔了多少</SectionTitle>
        <Card className="px-5 py-4" data-testid="demo-burden">
          {burdenTotal === 0 ? (
            <p className="py-2 text-center text-sm text-stone-500">這個月還沒有支出</p>
          ) : (
            <div className="space-y-3">
              {burden.map((b) => {
                const share = burdenTotal > 0 ? b.amount / burdenTotal : 0;
                return (
                  <div key={b.userId}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-stone-700">
                        {b.nickname}
                        {b.userId === ctx.me.userId && <span className="ml-1 text-xs text-stone-400">（我）</span>}
                      </span>
                      <span className="amount text-stone-800">{formatMoney(b.amount)}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-200">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${share * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="border-t border-line pt-2.5 text-xs leading-relaxed text-stone-500">
                「負擔」看的是分帳（誰該出這筆錢），跟「誰實際付款」是兩件事 ——
                這就是下面欠款的來源。
              </p>
            </div>
          )}
        </Card>

        {/* ── 欠款 ── */}
        <SectionTitle>目前的欠款</SectionTitle>
        <Card className="px-5 py-4" data-testid="demo-stats-debt">
          {bal.debts.length === 0 ? (
            <p className="py-2 text-center text-sm text-stone-500">目前互不相欠</p>
          ) : (
            bal.debts.map((d, i) => (
              <p key={i} className="text-sm text-stone-700">
                <b>{state.users.find((u) => u.id === d.from)?.nickname}</b> 要還{" "}
                <b>{state.users.find((u) => u.id === d.to)?.nickname}</b>
                <span className="amount ml-2 text-[17px] text-brand-700">{formatMoney(d.amount)}</span>
              </p>
            ))
          )}
          <p className="mt-2.5 border-t border-line pt-2.5 text-xs text-stone-500">
            每個人的淨額加總恆為 0（零和）—— 這是由同一份 <code className="text-[11px]">netPositions</code> 保證的。
          </p>
        </Card>

        {/* ── 分類排行 ── */}
        <SectionTitle>這個月花在哪</SectionTitle>
        {cats.length === 0 ? (
          <Card quiet className="p-0">
            <Empty icon="stats">這個月還沒有支出</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-line p-0" data-testid="demo-category-stats">
            {cats.map((c) => (
              <div key={c.categoryId} className="flex items-center gap-3 px-4 py-3">
                <ArtTile name={toIconKey(c.icon)} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[15px] font-medium text-stone-800">{c.name}</span>
                    <span className="amount shrink-0 text-[15px] text-stone-800">{formatMoney(c.amount)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                      <span className="block h-full rounded-full bg-brand-500" style={{ width: `${c.share * 100}%` }} />
                    </span>
                    <span className="tnum shrink-0 text-[11px] text-stone-400">{Math.round(c.share * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
