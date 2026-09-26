import Link from "next/link";
import { DebtCard } from "@/components/DebtCard";
import { TaskRow } from "@/components/TaskRow";
import { TxRow } from "@/components/TxRow";
import { Badge, Card, Empty, SectionTitle, TwoPartProgress } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listFunds } from "@/server/services/funds";
import { getBalances, listTransactions, monthSummary } from "@/server/services/ledger";
import { applyMissedPenalties, taskBoard, todayRewards } from "@/server/services/tasks";
import { rewardBalance } from "@/server/services/rewards";
import { pendingRecurring } from "@/server/services/recurring";
import { budgetSummary } from "@/server/services/budgets";
import { availableMoney } from "@/server/services/available";
import { pendingPreorders } from "@/server/services/preorders";
import { groupByDateKey, HOME_HISTORY_TAKE, sortTodayByEntry, splitToday } from "@/server/domain/feed";
import { dateHeading, dayRange, toDateKey } from "@/lib/dates";
import { APP } from "@/config/app";
import { ArtIcon, ArtImage, ArtTile } from "@/components/ArtIcon";

/**
 * 首頁 = 每日 Dashboard。
 *
 * 順序就是「每天早上打開 App 會想知道的事」：
 *   今天要做什麼 → 今天賺了多少 → 錢存到哪了 → 最近花了什麼 → 本月總覽
 */
export default async function DashboardPage() {
  const { ctx } = await getAppContext();
  await applyMissedPenalties(ctx);
  const now = new Date();
  const todayKey = toDateKey(now);
  const today = dayRange(todayKey);
  const month = todayKey.slice(0, 7);
  // 「今天是幾月幾號、星期幾」：生活帳本的第一行，不是後台的統計期間
  const todayLabel = new Intl.DateTimeFormat("zh-TW", {
    timeZone: APP.timeZone, month: "long", day: "numeric", weekday: "short",
  }).format(new Date());
  const [balances, summary, board, rewards, myReward, funds, dueRecurring, budgets, todays] = await Promise.all([
    getBalances(ctx),
    monthSummary(ctx),
    taskBoard(ctx),
    todayRewards(ctx),
    rewardBalance(ctx, ctx.me.userId),
    listFunds(ctx),
    pendingRecurring(ctx),
    budgetSummary(ctx, month),
    listTransactions(ctx, { from: today.start, to: today.end }),
  ]);
  const [available, preorders, historyRows] = await Promise.all([
    availableMoney(ctx),
    pendingPreorders(ctx),
    // 今天以前的最近幾筆（今天的已經全部拿到了，不會重複）
    listTransactions(ctx, { to: today.start, take: HOME_HISTORY_TAKE }),
  ]);
  const { shown: todayShown, hidden: todayHidden } = splitToday(sortTodayByEntry(todays));
  const historyGroups = groupByDateKey(historyRows, (tx) => toDateKey(tx.occurredAt));

  // 今日任務：我自己那一份（共同任務也算我的），已完成的排到後面
  const myToday = board.today.filter((c) => c.group !== "PARTNER");
  const undone = myToday.filter((c) => c.canCheckIn || !c.today || c.today.status === "REJECTED");
  const sorted = [...myToday].sort((a, b) => Number(undone.includes(b)) - Number(undone.includes(a)));
  const topFunds = funds.filter((f) => !f.isArchived).slice(0, 3);
  const fundTotal = funds.filter((f) => !f.isArchived).reduce((a, f) => a + f.balance, 0);

  return (
    <div className="px-4 pt-5">
      {/* ── 滿版場景：背景、招牌與角色都是可替換的 <img> 素材 ── */}
      <header className="-mx-4 -mt-5 mb-4">
        <div className="relative h-[148px] overflow-hidden border-b-2 border-stone-800">
          <ArtImage src="/assets/ramen-hero.png" alt="場景插畫" className="h-full w-full object-cover object-center" />
          <span className="absolute left-3 top-3 rounded-[10px] border-2 border-stone-800 bg-brand-500 px-2.5 py-1 text-[13px] font-semibold tracking-wide text-white shadow-md">
            {ctx.book.name}
          </span>
          <Link
            href="/more"
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
          <Link href="/transactions/new" className="press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-4 py-2.5 text-[15px] font-semibold tracking-wide text-white shadow-md">
            ＋ 記一筆
          </Link>
        </div>
      </header>

      {/* ── 1. 可以花的錢：帳戶裡真的能動的錢。
             刻意不叫「可自由使用」——那個詞在帳戶頁與基金頁已經有固定意思
             （帳戶餘額 − 已指定給基金），這裡還多扣了預購待結，數字不一樣。 ── */}
      <SectionTitle right={<Link href="/accounts" className="text-sm text-brand-600">看帳戶</Link>}>可以花的錢</SectionTitle>
      <Card className="px-5 py-4" data-testid="available-card">
        <p className="text-xs text-stone-500">扣掉基金與預購待結</p>
        <p className={`amount-lg mt-1 text-[2rem] ${available.free < 0 ? "text-red-600" : "text-stone-800"}`} data-testid="available-free">
          {formatMoney(available.free)}
        </p>
        <div className="mt-2.5 space-y-0.5 border-t border-line pt-2.5 text-xs text-stone-500">
          <div className="flex justify-between"><span>帳戶可用</span><span className="tnum">{formatMoney(available.accounts)}</span></div>
          {available.earmarked > 0 && (
            <div className="flex justify-between"><span>− 已指定給基金</span><span className="tnum">{formatMoney(available.earmarked)}</span></div>
          )}
          {available.preorder > 0 && (
            <div className="flex justify-between"><span>− 預購待結</span><span className="tnum">{formatMoney(available.preorder)}</span></div>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-stone-400">不含信用卡欠款，也沒有扣預算（預算只是提醒，不是已經花掉的錢）。</p>
      </Card>

      <div className="mt-3.5">
        <DebtCard ctx={ctx} debt={balances.debts[0]} />
      </div>

      {/* ── 2. 提醒：沒有就完全不佔位置 ── */}
      {(dueRecurring.length > 0 || budgets || preorders.count > 0) && (
        <Card quiet className="mt-3.5 divide-y divide-line p-0">
          {preorders.count > 0 && (
            <Link href="/preorders" className="flex items-center gap-3 px-4 py-3.5 text-sm active:bg-stone-50" data-testid="preorder-hint">
              <ArtTile name="package" size={36} />
              <span className="min-w-0 flex-1">
                <span className="block">{preorders.count} 筆預購待結款</span>
                <span className="block text-[11px] text-stone-400">共 {formatMoney(preorders.remaining)}・還沒付，不算這個月的支出</span>
              </span>
              <span className="text-stone-300">›</span>
            </Link>
          )}
          {dueRecurring.length > 0 && (
            <Link href="/recurring" className="flex items-center gap-3 px-4 py-3.5 text-sm active:bg-stone-50" data-testid="recurring-hint">
              <ArtTile name="calendar-clock" size={36} />
              <span className="flex-1">有 {dueRecurring.length} 筆固定支出待處理</span>
              <span className="text-stone-300">›</span>
            </Link>
          )}
          {budgets && (
            <Link href="/budgets" className="flex items-center gap-3 px-4 py-3.5 text-sm active:bg-stone-50" data-testid="budget-hint">
              <ArtTile name="target" size={36} />
              <span className="min-w-0 flex-1">本月預算 {budgets.count} 個</span>
              {budgets.over > 0 ? (
                <Badge tone="danger">{budgets.over} 個超支</Badge>
              ) : budgets.near > 0 ? (
                <Badge tone="warn">{budgets.near} 個快超過</Badge>
              ) : (
                <Badge tone="income">都還好</Badge>
              )}
              <span className="text-stone-300">›</span>
            </Link>
          )}
        </Card>
      )}

      {/* ── 3. 最近紀錄：今天記的全部看得到，今天以前只留最近幾筆。
             顯示仍然是既有的 <TxRow />，挑選與分組在 server/domain/feed.ts ── */}
      <SectionTitle right={<Link href="/transactions" className="text-sm text-brand-600">全部紀錄</Link>}>最近紀錄</SectionTitle>
      {todayShown.length === 0 && historyRows.length === 0 ? (
        <Card quiet className="p-0">
          <Empty icon="transaction" action={<Link href="/transactions/new" className="text-sm font-semibold text-brand-600">記第一筆 →</Link>}>
            還沒有任何紀錄
          </Empty>
        </Card>
      ) : (
        <div className="space-y-4" data-testid="home-feed">
          {todayShown.length > 0 && (
            <section data-testid="home-feed-today">
              <div className="mb-1.5 flex items-baseline justify-between px-1.5 text-xs">
                <span className="font-semibold text-stone-500">今天</span>
                <span className="tnum text-stone-400">{todays.length} 筆</span>
              </div>
              <Card quiet className="divide-y divide-line p-0">
                {todayShown.map((tx) => <TxRow key={tx.id} tx={tx} ctx={ctx} />)}
              </Card>
              {todayHidden.length > 0 && (
                <details className="group mt-2">
                  <summary className="paper-quiet flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold text-brand-600" data-testid="home-feed-more">
                    查看今天全部（還有 {todayHidden.length} 筆）
                    <span className="text-stone-400 transition group-open:rotate-90">›</span>
                  </summary>
                  <Card quiet className="mt-2 divide-y divide-line p-0">
                    {todayHidden.map((tx) => <TxRow key={tx.id} tx={tx} ctx={ctx} />)}
                  </Card>
                </details>
              )}
            </section>
          )}
          {historyGroups.map((g) => (
            <section key={g.key} data-testid="home-feed-group">
              <div className="mb-1.5 px-1.5 text-xs font-semibold text-stone-500">{dateHeading(g.key)}</div>
              <Card quiet className="divide-y divide-line p-0">
                {g.items.map((tx) => <TxRow key={tx.id} tx={tx} ctx={ctx} />)}
              </Card>
            </section>
          ))}
        </div>
      )}

      {/* ── 4. 今日任務：直接在這裡完成，不用進任務頁 ── */}
      <SectionTitle
        right={<Link href="/tasks" className="text-sm text-brand-600">全部任務</Link>}
      >
        今日任務{myToday.length > 0 && `（還剩 ${undone.length}/${myToday.length}）`}
      </SectionTitle>
      <Card className="divide-y divide-line p-0" data-testid="today-tasks">
        {myToday.length === 0 ? (
          <Empty icon="sprout" action={<Link href="/tasks/new" className="text-sm font-semibold text-brand-600">建立任務 →</Link>}>
            今天沒有排定的任務
          </Empty>
        ) : (
          sorted.slice(0, 6).map((c) => <TaskRow key={`${c.task.id}:${c.subjectKey}`} card={c} ctx={ctx} />)
        )}
      </Card>

      {/* ── 5. 今日獎勵 ── */}
      <SectionTitle right={<Link href="/tasks" className="text-sm text-brand-600">去提領</Link>}>今日獎勵</SectionTitle>
      <Card className="px-5 py-4" data-testid="today-reward-card">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-stone-500">今天賺到</p>
            <p className="amount mt-0.5 text-[1.9rem] text-brand-700" data-testid="today-rewards">
              +{formatMoney(rewards.byUser.get(ctx.me.userId) ?? 0)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-stone-500">我的獎勵餘額</p>
            <p className="amount mt-0.5 text-[17px] text-stone-800" data-testid="reward-balance">{formatMoney(myReward.balance)}</p>
          </div>
        </div>
        {ctx.partner && (
          <p className="mt-2 border-t border-line pt-2 text-xs text-stone-500">
            兩個人今天合計 +{formatMoney(rewards.total)}
          </p>
        )}
      </Card>

      {/* ── 6. 基金進度（摘要與入口，完整清單在基金頁） ── */}
      <SectionTitle right={<Link href="/funds" className="text-sm text-brand-600">全部基金</Link>}>
        基金・{formatMoney(fundTotal)}
      </SectionTitle>
      <Card quiet className="divide-y divide-line p-0" data-testid="home-funds">
        {topFunds.length === 0 ? (
          <Empty icon="piggy-bank" action={<Link href="/funds/new" className="text-sm font-semibold text-brand-600">新增基金 →</Link>}>
            還沒有基金
          </Empty>
        ) : (
          topFunds.map((f) => (
            <Link key={f.id} href={`/funds/${f.id}`} className="block px-4 py-3 active:bg-stone-50">
              <div className="flex items-center gap-3">
                <ArtTile name={f.emoji} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-stone-800">{f.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {f.targetAmount ? `目標 ${formatMoney(f.targetAmount)}・還差 ${formatMoney(f.remaining ?? 0)}` : "未設定目標金額"}
                  </p>
                </div>
                <span className="amount shrink-0 text-stone-800">{formatMoney(f.balance)}</span>
              </div>
              {f.targetAmount ? <TwoPartProgress real={f.balance} pending={f.pending} target={f.targetAmount} className="mt-2" /> : null}
            </Link>
          ))
        )}
      </Card>

      {/* ── 7. 本月總覽 ── */}
      <SectionTitle>本月</SectionTitle>
      <Link href="/stats" className="press block rounded-3xl bg-white px-5 py-6 shadow-xs ring-1 ring-line/70 active:bg-stone-50" aria-label="本月財務狀況">
        <div className="flex items-baseline justify-between">
          <p className="text-[13px] text-stone-500">我們{summary.label}花了</p>
          <span className="text-xs text-stone-400">看統計 ›</span>
        </div>
        <p className="amount-lg mt-1.5 text-[2.6rem] text-stone-800" data-testid="month-expense">
          {formatMoney(summary.expense)}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
          <div>
            <p className="text-xs text-stone-500">我負擔</p>
            <p className="amount mt-1 text-[17px]">{formatMoney(summary.myShare)}</p>
          </div>
          <div>
            <p className="text-xs text-stone-500">收入</p>
            <p className="amount mt-1 text-[17px] text-brand-700">{formatMoney(summary.income)}</p>
          </div>
        </div>
      </Link>

      <p className="mt-9 text-center text-xs leading-relaxed text-stone-400">
        <Link href="/goals" className="underline underline-offset-2">共同目標</Link>・
        <Link href="/activity" className="underline underline-offset-2">最近動態</Link>・
        <Link href="/settle" className="underline underline-offset-2">結算</Link>・
        <Link href="/more" className="underline underline-offset-2">更多</Link>
      </p>
    </div>
  );
}
