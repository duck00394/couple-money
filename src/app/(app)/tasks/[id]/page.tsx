import { notFound } from "next/navigation";
import { CheckInPanel, ReviewButtons, WaivePenaltyButton } from "@/components/CheckInWidgets";
import { TaskForm } from "@/components/TaskForm";
import { Card, Collapsible, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { addDays, dateHeading, dbDateToKey, toDateKey, weekStart } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { isScheduled, maskLabel } from "@/server/domain/streak";
import { applyMissedPenalties, getTaskDetail } from "@/server/services/tasks";
import { loadTaskFormProps } from "@/server/taskFormData";

export default async function TaskDetailPage({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  await applyMissedPenalties(ctx);
  const today = toDateKey(new Date());
  const d = await getTaskDetail(ctx, id, today);
  if (!d) notFound();
  const { task, stats } = d;
  const props = await loadTaskFormProps(ctx);
  const name = (uid: string | null) => (uid === null ? "共同" : uid === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === uid)?.nickname ?? "");
  const who = task.scope === "SHARED" ? "共同任務" : `${name(task.assigneeId)}的任務`;
  const mine = task.scope === "SHARED" || task.assigneeId === ctx.me.userId;
  const start = dbDateToKey(task.startDate);

  // 最近 5 週日曆（週一開始）
  const first = addDays(weekStart(today), -28);
  const days = Array.from({ length: 35 }, (_, i) => addDays(first, i));

  type Row = { key: string; date: string; icon: string; text: string; amount: string; waive: string | null; waived: boolean };
  const history: Row[] = [
    ...d.rewards.map((r): Row => ({ key: r.id, date: dbDateToKey(r.checkIn.date), icon: r.kind === "MILESTONE" ? "🏅" : "🏆", text: `${name(r.userId)}${r.kind === "MILESTONE" ? " 里程碑獎金" : " 完成獎金"}・${r.depositEntryId ? "已入金" : "尚未入金"}`, amount: `+${formatMoney(r.amount)}`, waive: null, waived: false })),
    ...d.penalties.map((p): Row => ({ key: p.id, date: dbDateToKey(p.date), icon: "⚠️", text: `${name(p.userId)} 未完成${p.text ? `・${p.text}` : ""}`, amount: p.amount ? `-${formatMoney(p.amount)}` : "", waive: !p.waivedAt && !p.depositEntryId && ctx.canWrite && (p.userId !== ctx.me.userId || !ctx.partner) ? p.id : null, waived: !!p.waivedAt })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  return (
    <>
      <PageHeader title={`${task.emoji} ${task.title}`} back="/tasks" />
      <div className="px-4">
        <p className="mb-3 px-1 text-sm text-stone-500">
          {who}・{maskLabel(task.daysOfWeek)}
          {task.rewardAmount > 0 && `・完成獎金 +${formatMoney(task.rewardAmount)}（記入 ${task.fund?.emoji ?? ""}${task.fund?.name ?? ""} 尚未入金）`}
          {task.requiresApproval && "・需對方確認"}
          {task.requiresPhoto && "・需照片"}
          {!task.isActive && "・已停用"}
        </p>
        {task.description && <p className="mb-3 px-1 text-sm text-stone-600">{task.description}</p>}

        {d.scheduledToday && mine && ctx.canWrite && (
          <Card className="mb-3">
            <p className="mb-3 font-semibold">今天</p>
            {d.todayCheckIn && d.todayCheckIn.userId !== ctx.me.userId && (d.todayCheckIn.status === "APPROVED" || d.todayCheckIn.status === "PENDING") ? (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700" data-testid="checkin-status">
                {name(d.todayCheckIn.userId)} 今天已經完成了{d.todayCheckIn.status === "PENDING" && "（待確認）"}
              </p>
            ) : (
              <CheckInPanel
                taskId={task.id}
                requiresPhoto={task.requiresPhoto}
                existing={d.todayCheckIn ? { id: d.todayCheckIn.id, status: d.todayCheckIn.status, note: d.todayCheckIn.note, photoId: d.todayCheckIn.photoId } : null}
                canCancel
              />
            )}
          </Card>
        )}

        {(() => {
          // 給另一半看的：今天對方的打卡內容，以及等我確認的打卡（含照片、備註）
          const others = d.checkIns.filter(
            (c) => c.userId !== ctx.me.userId && (c.status === "PENDING" || (dbDateToKey(c.date) === today && c.status !== "CANCELLED")),
          );
          if (others.length === 0 || (mine && task.scope === "SHARED" && others.every((c) => c.status !== "PENDING"))) return null;
          const label: Record<string, string> = { PENDING: "⏳ 等你確認", APPROVED: "✓ 已完成", REJECTED: "已退回" };
          return (
            <Card className="mb-3 space-y-3" data-testid="partner-checkins">
              <p className="font-semibold">{name(others[0].userId)}的打卡</p>
              {others.map((c) => (
                <div key={c.id} className="space-y-2 border-t border-stone-100 pt-3 first:border-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{dateHeading(dbDateToKey(c.date))}・{label[c.status] ?? c.status}</span>
                    {c.status === "PENDING" && ctx.canWrite && <ReviewButtons id={c.id} />}
                  </div>
                  {c.note && <p className="text-sm text-stone-600">備註：{c.note}</p>}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.photoId && <img src={`/api/files/${c.photoId}`} alt={`${name(c.userId)}的打卡照片`} className="max-h-72 w-full rounded-xl object-cover" />}
                </div>
              ))}
            </Card>
          );
        })()}

        <Card>
          <div className="grid grid-cols-4 text-center">
            <div><p className="text-2xl font-bold text-orange-600" data-testid="streak-current">🔥{stats.current}</p><p className="text-[11px] text-stone-500">目前連續</p></div>
            <div><p className="text-2xl font-bold">{stats.longest}</p><p className="text-[11px] text-stone-500">最長連續</p></div>
            <div><p className="text-2xl font-bold">{stats.weekDone}<span className="text-sm text-stone-400">/{stats.weekScheduled}</span></p><p className="text-[11px] text-stone-500">本週</p></div>
            <div><p className="text-2xl font-bold">{stats.monthDone}<span className="text-sm text-stone-400">/{stats.monthScheduled}</span></p><p className="text-[11px] text-stone-500">本月</p></div>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] text-stone-400">
            {["一", "二", "三", "四", "五", "六", "日"].map((x) => <span key={x}>{x}</span>)}
            {days.map((day) => {
              const ci = d.byDate.get(day);
              const scheduled = isScheduled(day, task.daysOfWeek, start);
              const penalized = d.penaltyDates.has(day);
              const cls =
                ci?.status === "APPROVED" ? "bg-emerald-500 text-white"
                : ci?.status === "PENDING" ? "bg-amber-300 text-white"
                : penalized ? "bg-red-100 text-red-600"
                : scheduled && day < today && day >= start ? "bg-stone-200 text-stone-500"
                : scheduled && day >= start ? "bg-white text-stone-500 ring-1 ring-stone-200"
                : "text-stone-300";
              return <span key={day} className={`flex aspect-square items-center justify-center rounded-md text-xs ${cls} ${day === today ? "font-bold ring-2 ring-brand-500" : ""}`}>{Number(day.slice(8))}</span>;
            })}
          </div>
          <p className="mt-2 text-[11px] text-stone-400">綠＝完成・黃＝待確認・紅＝懲罰・灰＝未完成</p>
        </Card>

        <SectionTitle>里程碑</SectionTitle>
        <Card className="divide-y divide-stone-100 p-0">
          {task.milestones.length === 0 && <Empty>沒有設定里程碑</Empty>}
          {task.milestones.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3 text-sm" data-testid="milestone">
              <span className={`text-2xl ${m.claims.length ? "" : "opacity-40 grayscale"}`}>{m.badgeEmoji}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">連續 {m.days} 天・{m.badgeName}</p>
                <p className="truncate text-xs text-stone-500">{[m.bonusAmount > 0 && `+${formatMoney(m.bonusAmount)}`, m.rewardText].filter(Boolean).join("・") || "徽章"}</p>
              </div>
              <span className="text-xs text-stone-500">{m.claims.length ? `達成 ${m.claims.length} 次` : `還差 ${Math.max(0, m.days - stats.current)} 天`}</span>
            </div>
          ))}
        </Card>

        <SectionTitle right={<span className="text-sm text-stone-500">累計 +{formatMoney(d.totalReward)}{d.totalPenalty > 0 && ` / -${formatMoney(d.totalPenalty)}`}</span>}>獎金與懲罰紀錄</SectionTitle>
        <Card className="divide-y divide-stone-100 p-0">
          {d.rewards.length === 0 && d.penalties.length === 0 && <Empty>還沒有紀錄</Empty>}
          {history.map((row) => (
              <div key={row.key} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${row.waived ? "opacity-50" : ""}`}>
                <span>{row.icon}</span>
                <span className="min-w-0 flex-1 truncate">{row.text}{row.waived && "（已免除）"}<span className="ml-1 text-xs text-stone-400">{dateHeading(row.date)}</span></span>
                <span className="font-semibold">{row.amount}</span>
                {row.waive && <WaivePenaltyButton id={row.waive} />}
              </div>
            ))}
        </Card>

      </div>
      {ctx.canWrite && (
        <Collapsible title="✏️ 編輯任務（週期、獎金、懲罰、里程碑）" className="mx-4">
        <TaskForm
          {...props}
          isCreator={task.createdById === ctx.me.userId}
          creatorName={name(task.createdById)}
          values={{
            id: task.id,
            title: task.title,
            description: task.description ?? "",
            emoji: task.emoji,
            scope: task.scope,
            assigneeId: task.assigneeId,
            frequency: task.frequency,
            daysOfWeek: task.daysOfWeek,
            requiresApproval: task.requiresApproval,
            requiresPhoto: task.requiresPhoto,
            rewardAmount: task.rewardAmount,
            fundId: task.fundId,
            penaltyAmount: task.penaltyAmount,
            penaltyText: task.penaltyText ?? "",
            isActive: task.isActive,
            milestones: task.milestones.map((m) => ({ days: m.days, bonusAmount: m.bonusAmount, badgeEmoji: m.badgeEmoji, badgeName: m.badgeName, rewardText: m.rewardText ?? "" })),
            updatedAt: task.updatedAt.toISOString(),
          }}
        />
        </Collapsible>
      )}
    </>
  );
}
