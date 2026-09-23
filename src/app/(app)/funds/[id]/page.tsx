import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteRequestPanel } from "@/components/DeleteRequest";
import { CancelFundEntryButton, CancelRewardDepositButton, FundEntryForm, FundForm, RewardDepositForm } from "@/components/FundForms";
import { Avatar, Card, Collapsible, Empty, LinkButton, PageHeader, SectionTitle, TwoPartProgress } from "@/components/ui";
import { dateHeading, dbDateToKey, toDateKey } from "@/lib/dates";
import { formatMoney, toInputString } from "@/lib/money";
import { FUND_TX_LABEL, percentText, type FundTxType } from "@/server/domain/fund";
import { getAppContext } from "@/server/context";
import { accountOptions } from "@/server/fundFormData";
import { pendingDeleteRequests } from "@/server/services/deleteRequests";
import { getFundDetail } from "@/server/services/funds";
import { listGoals } from "@/server/services/goals";

const ICON: Record<string, string> = { DEPOSIT: "⬇️", WITHDRAW: "⬆️", EXPENSE: "🧾", REWARD_DEPOSIT: "💰" };

export default async function FundDetailPage({ params }: PageProps<"/funds/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  const detail = await getFundDetail(ctx, id);
  if (!detail) notFound();
  const { fund, summary, entries, pending } = detail;
  const [options, goals, deleteRequests] = await Promise.all([
    accountOptions(ctx, summary.byAccount),
    listGoals(ctx, { includeInactive: true }),
    pendingDeleteRequests(ctx, { entityType: "FUND", entityId: fund.id }),
  ]);
  const optionName = (accId: string | null) => options.find((o) => o.id === accId)?.name ?? "（已停用的帳戶）";
  const nick = (uid: string | null) => (uid === null ? "共同" : uid === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === uid)?.nickname ?? "已離開");
  const linkedGoals = goals.filter((g) => g.fund?.id === fund.id);
  const today = toDateKey(new Date());

  return (
    <>
      <PageHeader title={`${fund.emoji} ${fund.name}`} back="/goals" />
      <div className="px-4">
        <Card>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-stone-500">實際基金金額</p>
              <p className="text-2xl font-bold" data-testid="fund-balance">{formatMoney(summary.balance)}</p>
              <p className="text-[11px] text-stone-400">帳戶裡真的有、已指定的錢</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-stone-500">尚未入金獎金</p>
              <p className={`text-2xl font-bold ${pending.net < 0 ? "text-red-600" : "text-amber-600"}`} data-testid="fund-pending">{pending.net < 0 ? "-" : "+"}{formatMoney(Math.abs(pending.net))}</p>
              <p className="text-[11px] text-stone-400">任務承諾，還不是現金</p>
            </div>
          </div>
          {fund.targetAmount ? (
            <>
              <TwoPartProgress real={summary.balance} pending={pending.net} target={fund.targetAmount} className="mt-3 h-3" />
              <div className="mt-1 flex justify-between text-xs text-stone-500">
                <span data-testid="fund-progress">實際 {percentText(summary.balance, fund.targetAmount)}{pending.net > 0 && `・含未入金 ${percentText(summary.balance + pending.net, fund.targetAmount)}`}</span>
                <span>目標 {formatMoney(fund.targetAmount)}・還差 {formatMoney(detail.remaining ?? 0)}</span>
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs text-stone-500">未設定目標金額</p>
          )}
          {fund.dueDate && <p className="mt-2 text-xs text-stone-500">到期日 {dbDateToKey(fund.dueDate).replaceAll("-", "/")}</p>}
          {fund.description && <p className="mt-2 text-sm text-stone-600">{fund.description}</p>}
        </Card>

        {deleteRequests[0] && (
          <div className="mt-3">
            <DeleteRequestPanel entityType="FUND" entityId={fund.id} label="基金" pending={deleteRequests[0]} meId={ctx.me.userId} partnerName={ctx.partner?.nickname ?? null} />
          </div>
        )}

        <SectionTitle>尚未入金的任務獎金</SectionTitle>
        <Card className="space-y-3" data-testid="pending-rewards">
          {pending.rewards === 0 && pending.penalties === 0 ? (
            <p className="text-center text-sm text-stone-500">目前沒有。完成任務的獎金會先記在這裡，入金後才變成實際基金金額。</p>
          ) : (
            <>
              <div className="space-y-1 text-sm">
                {ctx.members.map((m) => {
                  const rw = pending.rewardsByUser.get(m.userId) ?? 0;
                  const pn = pending.penaltiesByUser.get(m.userId) ?? 0;
                  if (!rw && !pn) return null;
                  return (
                    <div key={m.userId} className="flex justify-between">
                      <span className="text-stone-600">{m.userId === ctx.me.userId ? "我" : m.nickname}：獎金 {formatMoney(rw)}{pn > 0 && `・懲罰 -${formatMoney(pn)}`}</span>
                      <span className="font-semibold">{formatMoney(rw - pn)}</span>
                    </div>
                  );
                })}
                {(pending.rewardsByUser.get("COUPLE") || pending.penaltiesByUser.get("COUPLE")) ? (
                  <div className="flex justify-between">
                    <span className="text-stone-600">共同任務：獎金 {formatMoney(pending.rewardsByUser.get("COUPLE") ?? 0)}{(pending.penaltiesByUser.get("COUPLE") ?? 0) > 0 && `・懲罰 -${formatMoney(pending.penaltiesByUser.get("COUPLE") ?? 0)}`}</span>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-stone-100 pt-1 font-semibold">
                  <span>合計（獎金 {formatMoney(pending.rewards)} − 懲罰 {formatMoney(pending.penalties)}）</span>
                  <span>{formatMoney(pending.net)}</span>
                </div>
              </div>
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer">看明細（{detail.pendingRewards.length + detail.pendingPenalties.length} 筆）</summary>
                <ul className="mt-2 space-y-1">
                  {detail.pendingRewards.map((r) => (
                    <li key={r.id} className="flex justify-between"><span>🏆 {dateHeading(dbDateToKey(r.checkIn.date))} {nick(r.userId)}・{r.task.title}{r.kind === "MILESTONE" && "（里程碑）"}</span><span>+{formatMoney(r.amount)}</span></li>
                  ))}
                  {detail.pendingPenalties.map((p) => (
                    <li key={p.id} className="flex justify-between"><span>⚠️ {dateHeading(dbDateToKey(p.date))} {nick(p.userId)}・{p.task.title} 未完成</span><span>-{formatMoney(p.amount)}</span></li>
                  ))}
                </ul>
              </details>
              {ctx.canWrite && (pending.net > 0 ? (
                <RewardDepositForm fundId={fund.id} net={pending.net} today={today} targets={options.filter((o) => !o.isCard)} sources={options.filter((o) => !o.isCard)} />
              ) : (
                <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-500">懲罰比獎金多，之後獲得的獎金會先抵扣，淨額大於 0 才能入金。</p>
              ))}
            </>
          )}
        </Card>

        <SectionTitle>兩人投入（實際金額）</SectionTitle>
        <Card className="space-y-3">
          {ctx.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3" data-testid="fund-contribution">
              <Avatar name={m.nickname} color={m.avatarColor} size={32} />
              <span className="flex-1 text-sm font-medium">{m.userId === ctx.me.userId ? "我" : m.nickname}</span>
              <span className="font-semibold">{formatMoney(summary.contributions.get(m.userId) ?? 0)}</span>
            </div>
          ))}
          {(summary.contributions.get("JOINT") ?? 0) !== 0 && <p className="text-sm text-stone-600">💞 共同投入 {formatMoney(summary.contributions.get("JOINT") ?? 0)}</p>}
          <div className="grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center text-xs text-stone-500">
            <div>獎金入金<p className="text-base font-semibold text-stone-800">{formatMoney(summary.rewardDeposited)}</p></div>
            <div>基金支出<p className="text-base font-semibold text-stone-800">{formatMoney(summary.spent)}</p></div>
            <div>已取回<p className="text-base font-semibold text-stone-800">{formatMoney(summary.withdrawn)}</p></div>
          </div>
        </Card>

        {summary.byAccount.size > 0 && (
          <>
            <SectionTitle>實際金額放在哪裡</SectionTitle>
            <Card className="space-y-1.5 text-sm" data-testid="fund-storage">
              {[...summary.byAccount].filter(([, v]) => v !== 0).map(([accId, v]) => (
                <div key={accId} className="flex justify-between gap-3">
                  <span className="text-stone-600">{optionName(accId)}</span>
                  <span className="font-semibold">{formatMoney(v)}</span>
                </div>
              ))}
              <p className="pt-1 text-xs text-stone-400">基金只記「指定用途」，錢還在這些帳戶裡；帳戶頁可以看到每個帳戶還有多少可自由使用。</p>
            </Card>
          </>
        )}

        {ctx.canWrite && !fund.isArchived && (
          <>
            <Card className="mt-3">
              <FundEntryForm
                fundId={fund.id}
                balance={summary.balance}
                today={today}
                people={[
                  { id: ctx.me.userId, label: "我" },
                  ...(ctx.partner ? [{ id: ctx.partner.userId, label: ctx.partner.nickname }] : []),
                  { id: "JOINT", label: "共同" },
                ]}
                accounts={options}
              />
            </Card>
            <LinkButton href={`/transactions/new?fund=${fund.id}`} variant="secondary" className="mt-3 w-full">🧾 記一筆基金支出</LinkButton>
          </>
        )}

        {linkedGoals.length > 0 && (
          <>
            <SectionTitle>用這個基金的目標</SectionTitle>
            <Card className="divide-y divide-stone-100 p-0">
              {linkedGoals.map((g) => (
                <Link key={g.id} href={`/goals/${g.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50">
                  <span className="text-2xl">{g.emoji}</span>
                  <span className="flex-1 font-medium">{g.name}</span>
                  <span className="text-sm">{percentText(g.current, g.targetAmount)}</span>
                </Link>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>實際金額紀錄（每一筆的來源）</SectionTitle>
        <Card className="divide-y divide-stone-100 p-0">
          {entries.length === 0 && <Empty>還沒有紀錄</Empty>}
          {entries.map((e) => {
            const payer = e.transaction?.payments[0];
            const label =
              e.type === "EXPENSE" ? `${e.transaction?.title || e.transaction?.category?.name || "消費"}`
              : e.type === "REWARD_DEPOSIT" ? "任務獎金入金"
              : `${nick(e.userId)}${FUND_TX_LABEL[e.type as FundTxType]}`;
            const sub =
              e.type === "EXPENSE"
                ? `實際付款：${payer ? `${nick(payer.account.ownerId)}・${payer.account.name}` : ""}・動用「${optionName(e.accountId)}」的額度`
                : e.type === "REWARD_DEPOSIT"
                  ? `${e.transactionId ? "轉入" : "已在"}「${optionName(e.accountId)}」・${e.note ?? ""}`
                  : `${e.type === "DEPOSIT" ? "錢在" : "從"}「${optionName(e.accountId)}」${e.note ? `・${e.note}` : ""}`;
            return (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3" data-testid="fund-entry">
                <span className="text-xl">{ICON[e.type] ?? "•"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label}<span className="ml-1 text-xs font-normal text-stone-400">{dateHeading(toDateKey(e.occurredAt))}</span></p>
                  <p className="text-xs text-stone-500">{sub}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${e.amount > 0 ? "text-emerald-600" : "text-stone-800"}`}>{e.amount > 0 ? "+" : "-"}{formatMoney(Math.abs(e.amount))}</p>
                  {ctx.canWrite && (e.type === "DEPOSIT" || e.type === "WITHDRAW") && <CancelFundEntryButton id={e.id} label={`${label} ${formatMoney(Math.abs(e.amount))}`} />}
                  {ctx.canWrite && e.type === "REWARD_DEPOSIT" && <CancelRewardDepositButton id={e.id} label={formatMoney(Math.abs(e.amount))} />}
                  {e.type === "EXPENSE" && e.transactionId && <Link href={`/transactions/${e.transactionId}`} className="text-xs text-stone-400 underline">查看</Link>}
                </div>
              </div>
            );
          })}
        </Card>

        {ctx.canWrite && (
          <Collapsible title="⚙️ 基金設定（名稱、目標金額、封存、刪除）">
            <Card>
              <FundForm
                values={{
                  id: fund.id,
                  name: fund.name,
                  emoji: fund.emoji,
                  description: fund.description ?? "",
                  target: fund.targetAmount ? toInputString(fund.targetAmount) : "",
                  dueDate: fund.dueDate ? dbDateToKey(fund.dueDate) : "",
                  isArchived: fund.isArchived,
                  updatedAt: fund.updatedAt.toISOString(),
                }}
              />
              {!deleteRequests[0] && (
                <DeleteRequestPanel entityType="FUND" entityId={fund.id} label="基金" pending={null} meId={ctx.me.userId} partnerName={ctx.partner?.nickname ?? null} />
              )}
            </Card>
          </Collapsible>
        )}
      </div>
    </>
  );
}
