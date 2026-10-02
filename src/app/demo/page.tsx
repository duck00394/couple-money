"use client";

/**
 * 試用模式的首頁。
 *
 * 版面順序刻意跟正式首頁一致（今日任務 → 今日獎勵 → 最近紀錄 → 欠款 → 本月總覽），
 * 而且 `TxRow` / `DebtCard` / `Card` / `SectionTitle` / `Empty` 全部是**跟正式模式同一個元件**。
 * 不同的只有資料從哪來：這裡是 `useDemo()` 的記憶體 state，正式是 service + Prisma。
 */
import Link from "next/link";
import { DebtCard } from "@/components/DebtCard";
import { DemoTaskRow } from "@/components/DemoTaskRow";
import { TxRow } from "@/components/TxRow";
import { ArtIcon, ArtImage } from "@/components/ArtIcon";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { dateHeading } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";
import { APP } from "@/config/app";

export default function DemoHomePage() {
  const { state, todayKey } = useDemo();
  const ctx = select.demoCtx(state);
  const bal = select.balances(state);
  const feed = select.feed(state, todayKey);
  const summary = select.monthSummary(state, todayKey);
  const rewards = select.rewards(state, todayKey);
  const funds = select.funds(state).filter((f) => !f.isArchived);
  const available = select.availableMoney(state);
  const preorders = select.pendingPreorders(state);

  const todayLabel = new Intl.DateTimeFormat("zh-TW", {
    timeZone: APP.timeZone,
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());

  // 今日任務：我自己那一份（共同任務也算我的），已完成的排到後面
  const myCards = select.taskCards(state, todayKey).filter((c) => c.subjectId === ctx.me.userId);
  const dueToday = myCards.filter((c) => c.dueToday);
  const sorted = [...dueToday].sort((a, b) => Number(a.doneToday) - Number(b.doneToday));
  const undone = dueToday.filter((c) => !c.doneToday);

  const nameOf = (id: string) => state.users.find((u) => u.id === id)?.nickname ?? "";

  return (
    <div className="px-4 pt-5">
      <header className="-mx-4 -mt-5 mb-4">
        <div className="relative h-[148px] overflow-hidden border-b-2 border-stone-800">
          <ArtImage src="/assets/ramen-hero.png" alt="場景插畫" className="h-full w-full object-cover object-center" />
          <span className="absolute left-3 top-3 rounded-[10px] border-2 border-stone-800 bg-brand-500 px-2.5 py-1 text-[13px] font-semibold tracking-wide text-white shadow-md">
            {ctx.book.name}
          </span>
          <Link
            href="/demo/more"
            aria-label="更多"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border-2 border-stone-800 bg-white shadow-md"
          >
            <ArtIcon name="menu" size={18} />
          </Link>
          <span className="absolute bottom-2 right-3 flex items-end">
            <ArtImage src="/assets/chiikawa.png" alt="角色 A" className="art-round h-14 w-14" />
            <ArtImage src="/assets/shisa.png" alt="角色 B" className="art-round -ml-3 h-14 w-14" />
          </span>
        </div>
        <div className="mt-3 flex items-end justify-between gap-3 px-4">
          <div className="min-w-0">
            <h1 className="hand truncate text-[26px] font-bold leading-none text-stone-800">今天</h1>
            <p className="mt-1 truncate text-xs text-stone-500">嗨，{ctx.me.nickname}・{todayLabel}</p>
          </div>
          <Link
            href="/demo/transactions/new"
            className="press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-4 py-2.5 text-[15px] font-semibold tracking-wide text-white shadow-md"
            data-testid="demo-add-tx"
          >
            ＋ 記一筆
          </Link>
        </div>
      </header>

      {/* ── 1. 今日任務：直接在這裡打卡 ── */}
      <SectionTitle right={<Link href="/demo/tasks" className="text-sm text-brand-600">全部任務</Link>}>
        今日任務{dueToday.length > 0 && `（還剩 ${undone.length}/${dueToday.length}）`}
      </SectionTitle>
      <Card className="divide-y divide-line p-0" data-testid="demo-today-tasks">
        {dueToday.length === 0 ? (
          <Empty icon="sprout">今天沒有排定的任務</Empty>
        ) : (
          sorted.map((c) => <DemoTaskRow key={`${c.id}:${c.subjectId}`} card={c} nickname={nameOf(c.subjectId)} />)
        )}
      </Card>

      {/* ── 2. 今日獎勵 ── */}
      {(rewards.mine.today > 0 || rewards.mine.total > 0) && (
        <>
          <SectionTitle>今日獎勵</SectionTitle>
          <Card className="px-5 py-4" data-testid="demo-reward-card">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-stone-500">今天賺到</p>
                <p className="amount mt-0.5 text-[1.9rem] text-brand-700" data-testid="demo-today-reward">
                  +{formatMoney(rewards.mine.today)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-stone-500">我的獎勵累積</p>
                <p className="amount mt-0.5 text-[17px] text-stone-800">{formatMoney(rewards.mine.total)}</p>
              </div>
            </div>
            <p className="mt-2 border-t border-line pt-2 text-xs text-stone-500">
              兩個人今天合計 +{formatMoney(rewards.todayTotal)}
            </p>
          </Card>
        </>
      )}

      {/* ── 3. 最近紀錄 ── */}
      <SectionTitle right={<Link href="/demo/transactions" className="text-sm text-brand-600">全部紀錄</Link>}>
        最近紀錄
      </SectionTitle>
      {feed.today.length === 0 && feed.groups.length === 0 ? (
        <Card quiet className="p-0">
          <Empty
            icon="transaction"
            action={<Link href="/demo/transactions/new" className="text-sm font-semibold text-brand-600">記第一筆 →</Link>}
          >
            還沒有任何紀錄
          </Empty>
        </Card>
      ) : (
        <div className="space-y-4" data-testid="demo-home-feed">
          {feed.today.length > 0 && (
            <section>
              <div className="mb-1.5 flex items-baseline justify-between px-1.5 text-xs">
                <span className="font-semibold text-stone-500">今天</span>
                <span className="tnum text-stone-400">{feed.todayCount} 筆</span>
              </div>
              <Card quiet className="divide-y divide-line p-0">
                {feed.today.map((tx) => <TxRow key={tx.id} tx={tx} ctx={ctx} base="/demo" />)}
              </Card>
            </section>
          )}
          {feed.groups.map((g) => (
            <section key={g.key}>
              <div className="mb-1.5 px-1.5 text-xs font-semibold text-stone-500">{dateHeading(g.key)}</div>
              <Card quiet className="divide-y divide-line p-0">
                {g.items.map((tx) => <TxRow key={tx.id} tx={tx} ctx={ctx} base="/demo" />)}
              </Card>
            </section>
          ))}
        </div>
      )}

      {/* ── 4. 欠款 ── */}
      <div className="mt-3.5">
        <DebtCard ctx={ctx} debt={bal.debts[0]} base="/demo" />
      </div>

      {/* ── 5. 待收的預購 ── */}
      {preorders.length > 0 && (
        <Link
          href="/demo/preorders"
          className="press mt-3 flex items-center gap-3 rounded-2xl border-[1.5px] border-stone-800 bg-white px-4 py-3 shadow-md"
        >
          <span className="text-xl">{preorders[0].emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-stone-800">
              還有 {preorders.length} 筆預購在路上
            </span>
            <span className="block truncate text-xs text-stone-500">
              最近的是「{preorders[0].name}」・預計 {preorders[0].expectedOn}
            </span>
          </span>
          <span className="shrink-0 text-stone-400">›</span>
        </Link>
      )}

      {/* ── 6. 錢存到哪了 ── */}
      <SectionTitle right={<Link href="/demo/funds" className="text-sm text-brand-600">全部基金</Link>}>
        錢存到哪了
      </SectionTitle>
      <Card className="px-5 py-4" data-testid="demo-available">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-stone-500">可以自由用的錢</p>
            <p className="amount mt-0.5 text-[1.9rem] text-stone-800">{formatMoney(available.free)}</p>
          </div>
          <div className="text-right text-xs text-stone-500">
            <p>帳上共 {formatMoney(available.total)}</p>
            <p className="mt-0.5">已存進基金 {formatMoney(available.earmarked)}</p>
          </div>
        </div>
        {funds.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            {funds.map((f) => (
              <div key={f.id} className="flex items-center gap-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-stone-700">{f.name}</span>
                <span className="tnum shrink-0 text-xs text-stone-500">
                  {formatMoney(f.balance)} / {formatMoney(f.targetAmount)}
                </span>
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-stone-200">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${f.progress * 100}%` }} />
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── 7. 本月總覽 ── */}
      <SectionTitle right={<Link href="/demo/stats" className="text-sm text-brand-600">看統計</Link>}>
        {summary.label}
      </SectionTitle>
      <Card className="grid grid-cols-3 divide-x divide-line px-0 py-3 text-center" data-testid="demo-month-summary">
        <div className="px-2">
          <p className="text-xs text-stone-500">支出</p>
          <p className="amount mt-1 text-[17px] text-stone-800">{formatMoney(summary.expense)}</p>
        </div>
        <div className="px-2">
          <p className="text-xs text-stone-500">收入</p>
          <p className="amount mt-1 text-[17px] text-brand-700">{formatMoney(summary.income)}</p>
        </div>
        <div className="px-2">
          <p className="text-xs text-stone-500">我負擔</p>
          <p className="amount mt-1 text-[17px] text-stone-800">{formatMoney(summary.myShare)}</p>
        </div>
      </Card>
    </div>
  );
}
