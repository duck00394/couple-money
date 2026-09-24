import Link from "next/link";
import { DebtCard } from "@/components/DebtCard";
import { GoalRow } from "@/components/GoalCard";
import { TaskRow } from "@/components/TaskRow";
import { TxRow } from "@/components/TxRow";
import { Badge, Card, Empty, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listGoals } from "@/server/services/goals";
import { getBalances, listTransactions, monthSummary } from "@/server/services/ledger";
import { applyMissedPenalties, taskBoard, todayRewards } from "@/server/services/tasks";
import { pendingRecurring } from "@/server/services/recurring";
import { budgetSummary } from "@/server/services/budgets";
import { toDateKey } from "@/lib/dates";
import { APP } from "@/config/app";
import { ArtIcon, ArtImage, ArtTile } from "@/components/ArtIcon";

/** 首頁只放最常看的：本月錢的狀況、必要提醒、最近紀錄、今天的任務與主要目標。 */
export default async function DashboardPage() {
  const { ctx } = await getAppContext();
  await applyMissedPenalties(ctx);
  const month = toDateKey(new Date()).slice(0, 7);
  // 「今天是幾月幾號、星期幾」：生活帳本的第一行，不是後台的統計期間
  const todayLabel = new Intl.DateTimeFormat("zh-TW", {
    timeZone: APP.timeZone, month: "long", day: "numeric", weekday: "short",
  }).format(new Date());
  const [balances, summary, board, rewards, goals, dueRecurring, budgets, recent] = await Promise.all([
    getBalances(ctx),
    monthSummary(ctx),
    taskBoard(ctx),
    todayRewards(ctx),
    listGoals(ctx),
    pendingRecurring(ctx),
    budgetSummary(ctx, month),
    listTransactions(ctx, { take: 3 }),
  ]);
  // 主要目標：進行中且目標日期最近的；沒有日期就取進度最高的
  const mainGoal = goals
    .filter((g) => g.status === "ACTIVE")
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || b.progress - a.progress)[0];
  const todo = board.today.filter((c) => c.group !== "PARTNER" && (!c.today || c.today.status === "REJECTED"));
  const myTodayTotal = board.today.filter((c) => c.group !== "PARTNER").length;

  return (
    <div className="px-4 pt-5">
      {/* ── 滿版場景：背景、招牌與角色都是可替換的 <img> 素材 ── */}
      <header className="-mx-4 -mt-5 mb-4">
        <div className="relative h-[148px] overflow-hidden border-b-2 border-stone-800">
          <ArtImage src="/assets/ramen-hero.png" alt="場景插畫" className="h-full w-full object-cover" />
          <span className="absolute left-3 top-3 rounded-[10px] border-2 border-stone-800 bg-brand-500 px-2.5 py-1 text-xs font-extrabold text-white shadow-md">
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
            <h1 className="hand truncate text-[26px] font-bold leading-none text-stone-800">Couple Money</h1>
            <p className="mt-1 truncate text-xs text-stone-500">嗨，{ctx.me.nickname}・{todayLabel}</p>
          </div>
          <Link href="/transactions/new" className="press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-4 py-2 text-sm font-extrabold text-white shadow-md">
            ＋ 記一筆
          </Link>
        </div>
      </header>

      {/* ── 本月財務：首頁最重要的一塊，數字要一眼看到 ── */}
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
            <p className="amount mt-1 text-[17px] text-emerald-700">{formatMoney(summary.income)}</p>
          </div>
        </div>
      </Link>

      <div className="mt-3.5">
        <DebtCard ctx={ctx} debt={balances.debts[0]} />
      </div>

      {/* ── 必要提醒：沒有就完全不佔位置 ── */}
      {(dueRecurring.length > 0 || budgets) && (
        <Card className="mt-3.5 divide-y divide-line p-0">
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

      {/* ── 最近紀錄 ── */}
      <SectionTitle right={<Link href="/transactions" className="text-sm text-brand-600">全部紀錄</Link>}>最近紀錄</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {recent.length === 0 ? (
          <Empty icon="transaction" action={<Link href="/transactions/new" className="text-sm font-semibold text-brand-600">記第一筆 →</Link>}>
            還沒有任何紀錄
          </Empty>
        ) : (
          recent.map((tx) => <TxRow key={tx.id} tx={tx} ctx={ctx} />)
        )}
      </Card>

      {/* ── 今天的任務 ── */}
      <SectionTitle
        right={
          <Link href="/tasks" className="text-sm text-brand-600">
            {myTodayTotal > 0 ? `還剩 ${todo.length}/${myTodayTotal}` : "全部任務"}
          </Link>
        }
      >
        今日待完成
      </SectionTitle>
      <Card className="divide-y divide-line p-0">
        <Link href="/tasks" className="flex items-center gap-3 px-4 py-3 text-sm active:bg-stone-50">
          <ArtTile name="piggy-bank" size={36} />
          <span className="min-w-0 flex-1">
            <span className="block">今日任務獎金</span>
            <span className="block text-[11px] text-stone-400">尚未入金・我 +{formatMoney(rewards.byUser.get(ctx.me.userId) ?? 0)}</span>
          </span>
          <span className="amount shrink-0 text-brand-700" data-testid="today-rewards">
            +{formatMoney(rewards.total)}
          </span>
        </Link>
        {myTodayTotal === 0 ? (
          <Empty icon="sprout" action={<Link href="/tasks/new" className="text-sm font-semibold text-brand-600">建立任務 →</Link>}>
            今天沒有任務
          </Empty>
        ) : todo.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-emerald-700">今天的任務都完成了</p>
        ) : (
          todo.slice(0, 3).map((c) => <TaskRow key={`${c.task.id}:${c.subjectKey}`} card={c} ctx={ctx} />)
        )}
      </Card>

      {/* ── 主要目標 ── */}
      <SectionTitle right={<Link href="/goals" className="text-sm text-brand-600">全部目標</Link>}>主要目標</SectionTitle>
      <Card className="p-0">
        {mainGoal ? (
          <GoalRow goal={mainGoal} big />
        ) : (
          <Empty icon="sprout" action={<Link href="/goals/new" className="text-sm font-semibold text-brand-600">設定一個 →</Link>}>
            還沒有共同目標
          </Empty>
        )}
      </Card>

      <p className="mt-9 text-center text-xs leading-relaxed text-stone-400">
        <Link href="/activity" className="underline underline-offset-2">最近動態</Link>・
        <Link href="/settle" className="underline underline-offset-2">結算</Link>・
        <Link href="/accounts" className="underline underline-offset-2">帳戶</Link>・
        <Link href="/more" className="underline underline-offset-2">更多</Link>
      </p>
    </div>
  );
}
