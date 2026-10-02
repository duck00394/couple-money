import Link from "next/link";
import { ReviewButtons, WaivePenaltyButton } from "@/components/CheckInWidgets";
import { TaskRow } from "@/components/TaskRow";
import { Card, Collapsible, Empty, PageHeader, ProgressBar, SectionTitle } from "@/components/ui";
import { dateHeading, dbDateToKey } from "@/lib/dates";
import { moneyFmt } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { applyMissedPenalties, listBadges, pendingReviews, recentPenalties, taskBoard, todayRewards } from "@/server/services/tasks";
import { rewardBalance } from "@/server/services/rewards";
import { isDoneToday, isPendingToday } from "@/server/domain/task-status";
import { listAccounts } from "@/server/services/ledger";
import { RewardBox } from "@/components/RewardBox";
import { ArtIcon } from "@/components/ArtIcon";
import { TaskBoard } from "@/components/TaskBoard";
import { randomUUID } from "node:crypto";

export default async function TasksPage() {
  const { ctx } = await getAppContext();
  const fmtMoney = moneyFmt(ctx.book.baseCurrency);
  await applyMissedPenalties(ctx);
  const [board, reviews, penalties, badges, rewards, myReward, accounts] = await Promise.all([
    taskBoard(ctx), pendingReviews(ctx), recentPenalties(ctx, 5), listBadges(ctx), todayRewards(ctx),
    rewardBalance(ctx, ctx.me.userId), listAccounts(ctx),
  ]);
  // 提列只能收到自己的或共同帳戶（信用卡不是收款帳戶）
  const payable = accounts
    .filter((a) => a.isActive && a.type !== "CREDIT_CARD" && (a.ownerId === null || a.ownerId === ctx.me.userId))
    .map((a) => ({ id: a.id, label: a.ownerId === null ? `共同・${a.name}` : a.name }));
  const name = (id: string | null) => (id === null ? "共同" : id === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === id)?.nickname ?? "");
  const groups = [
    { key: "MINE", title: "我的任務" },
    { key: "PARTNER", title: `${ctx.partner?.nickname ?? "另一半"}的任務` },
    { key: "SHARED", title: "共同任務" },
  ] as const;
  // 還沒完成的排前面：打開任務頁第一眼就是「接下來要做什麼」
  // 兩個清單互斥：完成的只在佈告欄，待做的只在「今天」。規則在 domain/task-status.ts
  const doable = (c: (typeof board.today)[number]) => c.canCheckIn || !c.today || c.today.status === "REJECTED";
  const todayRows = board.today.filter(isPendingToday).sort((a, b) => Number(doable(b)) - Number(doable(a)));
  // 佈告欄＝成果牆：今天已完成（或待確認）的那些
  const todayDone = board.today.filter(isDoneToday);
  const streaks = board.cards.filter((c) => c.task.isActive && c.stats.current > 0).sort((a, b) => b.stats.current - a.stats.current).slice(0, 3);
  const pct = (r: { rate: number | null }) => (r.rate === null ? "—" : `${Math.round(r.rate * 100)}%`);
  // 全部都是 0 的區塊不佔位置：第一次用的人一打開就看得到自己的任務，而不是六個 $0
  const showStats = board.weekMine.scheduled > 0 || rewards.total > 0 || board.weekPartner.scheduled > 0;
  const showReward = myReward.balance > 0 || myReward.earned > 0 || myReward.settled > 0;

  return (
    <>
      <PageHeader title="任務" right={<Link href="/tasks/new" className="rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-3 py-1.5 text-sm font-semibold text-stone-800">＋ 新任務</Link>} />
      <div className="px-4">
        {showStats && (
        <div className="grid grid-cols-2 gap-2">
          <Card className="px-3 py-3">
            <p className="text-xs text-stone-500">本週完成率（我）</p>
            <p className="text-xl font-bold" data-testid="week-rate">{pct(board.weekMine)}</p>
            <ProgressBar value={board.weekMine.rate ?? 0} className="mt-1" tone="green" />
            <p className="mt-1 text-[11px] text-stone-400">{board.weekMine.scheduled === 0 ? "本週沒有排定的任務" : `${board.weekMine.done}/${board.weekMine.scheduled} 次`}</p>
          </Card>
          <Card className="px-3 py-3">
            <p className="text-xs text-stone-500">今日獲得獎金（尚未入金）</p>
            <p className="text-xl font-bold text-brand-700" data-testid="today-rewards">+{fmtMoney(rewards.total)}</p>
            {ctx.partner && <p className="mt-1 text-[11px] text-stone-400">{ctx.partner.nickname} 本週 {pct(board.weekPartner)}</p>}
          </Card>
        </div>
        )}

        {/* 一毛獎勵都還沒有的時候，整張提領卡沒有意義，只留一行說明 */}
        {showReward ? (
        <div className="mt-3">
          <RewardBox
            balance={myReward.balance}
            earned={myReward.earned}
            settled={myReward.settled}
            accounts={payable}
            requestId={`reward-withdraw:${randomUUID()}`}
            canWrite={ctx.canWrite && payable.length > 0}
          />
        </div>
        ) : (
          <p className="mt-3 px-1 text-xs leading-relaxed text-stone-500">完成任務就會累積獎勵，累積後可以提列成真正的收入。</p>
        )}

        {reviews.length > 0 && (
          <>
            <SectionTitle>等你確認</SectionTitle>
            <Card className="divide-y divide-line p-0">
              {reviews.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <Link href={`/tasks/${r.taskId}`} className="flex min-w-0 flex-1 items-center gap-3">
                    {r.photoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${r.photoId}`} alt="打卡照片縮圖" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <ArtIcon name={r.task.emoji} size={22} />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name(r.userId)}：{r.task.title}</p>
                      <p className="truncate text-xs text-stone-500">{dateHeading(dbDateToKey(r.date))}{r.note ? `・${r.note}` : "・點開看詳細"}</p>
                    </div>
                  </Link>
                  <ReviewButtons id={r.id} label={`${name(r.userId)} 的 ${r.task.title}`} />
                </div>
              ))}
            </Card>
          </>
        )}

        {/* 佈告欄只放「今天的成果」，操作一律在下面的「今天」，不要同一批任務出現兩次。
            今天還沒有完成任何事情時整塊不顯示——空木板佔掉半個畫面沒有意義。 */}
        {todayDone.length > 0 && (
          <TaskBoard
            title="今天完成的"
            cards={todayDone}
            ctx={ctx}
            mascot="/assets/chiikawa.png"
            empty="今天還沒有完成的任務，完成之後會貼在這裡"
          />
        )}

        <SectionTitle right={<Link href="/tasks/new" className="text-sm text-brand-600">＋ 新任務</Link>}>今天</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {todayRows.length === 0
            ? <Empty icon="sprout" action={<Link href="/tasks/new" className="text-sm font-semibold text-brand-600">建立任務 →</Link>}>今天沒有排定的任務</Empty>
            : todayRows.map((c) => <TaskRow key={`${c.task.id}:${c.subjectKey}`} card={c} ctx={ctx} />)}
        </Card>

        {streaks.length > 0 && (
          <>
            <SectionTitle>連續打卡</SectionTitle>
            <Card className="grid grid-cols-3 gap-2 text-center">
              {streaks.map((c) => (
                <Link key={c.task.id} href={`/tasks/${c.task.id}`} className="rounded-xl bg-orange-50 px-2 py-3">
                  <ArtIcon name={c.task.emoji} size={24} className="mx-auto" />
                  <p className="truncate text-xs text-stone-600">{c.task.title}</p>
                  <p className="font-bold text-orange-600">{c.stats.current} 天</p>
                </Link>
              ))}
            </Card>
          </>
        )}

        {/* 全部任務是「管理」用的，每天不會用到，所以預設收起來，不佔掉今天的版面 */}
        {groups.map((g) => {
          const list = board.cards.filter((c) => c.group === g.key);
          if (list.length === 0) return null; // 空的分組不佔位置
          return (
            <Collapsible key={g.key} title={`${g.title}（${list.length}）`}>
              <Card className="divide-y divide-line p-0">
                {list.length === 0 ? <Empty>沒有任務</Empty> : list.map((c) => <TaskRow key={`${c.task.id}:${c.subjectKey}`} card={c} ctx={ctx} showSchedule />)}
              </Card>
            </Collapsible>
          );
        })}

        {badges.length > 0 && (
          <>
            <SectionTitle>徽章</SectionTitle>
            <Card className="flex flex-wrap gap-2">
              {badges.slice(0, 12).map((b) => (
                <span key={b.id} className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-800" title={b.earnedAt.toISOString()}>
                  {b.title}・{b.subjectKey === "COUPLE" ? "共同" : name(b.subjectKey)}
                </span>
              ))}
            </Card>
          </>
        )}

        {penalties.length > 0 && (
          <>
            <SectionTitle>最近的懲罰</SectionTitle>
            <Card className="divide-y divide-line p-0">
              {penalties.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid="penalty-row">
                  <ArtIcon name="undo" size={20} className="text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name(p.userId)}：{p.task.title} 未完成</p>
                    <p className="truncate text-xs text-stone-500">{dateHeading(dbDateToKey(p.date))}{p.amount > 0 ? `・扣 ${fmtMoney(p.amount)}` : ""}{p.text ? `・${p.text}` : ""}</p>
                  </div>
                  {ctx.canWrite && (p.userId !== ctx.me.userId || !ctx.partner) && <WaivePenaltyButton id={p.id} />}
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
