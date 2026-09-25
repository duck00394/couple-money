import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteRecurringButton, GenerateButton, ToggleRecurringButton } from "@/components/RecurringActions";
import { RecurringForm } from "@/components/RecurringForm";
import { Card, Collapsible, PageHeader } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listAccounts, listCategories } from "@/server/services/ledger";
import { getRecurring } from "@/server/services/recurring";
import { accountOptionLabel } from "@/server/txFormData";

export default async function RecurringDetailPage({ params }: PageProps<"/recurring/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  const r = await getRecurring(ctx, id);
  if (!r) notFound();
  const [accounts, categories] = await Promise.all([listAccounts(ctx), listCategories(ctx, { keepId: r.categoryId })]);
  const due = r.status === "ACTIVE" && (r.state === "OVERDUE" || r.state === "TODAY");

  return (
    <>
      <PageHeader title={r.name} back="/recurring" />
      <div className="space-y-4 px-4">
        <Card className="space-y-2 text-sm" data-testid="recurring-detail">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-stone-500">{r.scheduleText}</p>
              <p className="text-2xl font-bold">{formatMoney(r.amount)}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs ${r.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>
              {r.status === "ACTIVE" ? (r.state === "ENDED" ? "已結束" : "啟用中") : "已停用"}
            </span>
          </div>
          <p><span className="text-stone-500">付款：</span>{r.accountName}・{r.payerName}付款{r.accountIsActive ? "" : "（帳戶已停用）"}</p>
          <p><span className="text-stone-500">分帳：</span>{r.splitText}</p>
          {r.categoryName && <p><span className="text-stone-500">分類：</span>{r.categoryIcon} {r.categoryName}</p>}
          <p><span className="text-stone-500">期間：</span>{r.startDate} ～ {r.endDate ?? "無結束日"}</p>
          <p><span className="text-stone-500">下一次應付日：</span>{r.status === "PAUSED" ? "已停用" : r.nextDueDate ?? "已結束"}</p>
          {r.note && <p><span className="text-stone-500">備註：</span>{r.note}</p>}
          {due && (
            <div className="border-t border-line pt-2">
              <p className="text-xs font-semibold text-brand-600">{r.state === "OVERDUE" ? "逾期" : "今天"}・應付 {r.nextDueDate}</p>
              <GenerateButton id={r.id} dueDate={r.nextDueDate!} />
            </div>
          )}
        </Card>

        <Card className="p-0">
          <p className="border-b border-line px-4 py-3 text-sm font-semibold">已經產生的記帳（{r.transactions.length}）</p>
          {r.transactions.length === 0 ? (
            <p className="p-4 text-center text-sm text-stone-500">還沒有產生過記帳</p>
          ) : (
            <ul className="divide-y divide-line" data-testid="recurring-history">
              {r.transactions.map((t) => (
                <li key={t.id}>
                  <Link href={`/transactions/${t.id}`} className="flex items-center justify-between px-4 py-3 text-sm active:bg-stone-50">
                    <span>
                      {toDateKey(t.occurredAt).replaceAll("-", "/")}
                      <span className="ml-2 text-xs text-stone-500">{t.payments[0]?.account.name}</span>
                    </span>
                    <span className="font-semibold">{formatMoney(t.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="px-4 pb-3 text-xs text-stone-500">改設定不會動到已經產生的記帳，只影響之後產生的。</p>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <ToggleRecurringButton id={r.id} active={r.status === "ACTIVE"} />
          <DeleteRecurringButton id={r.id} generated={r.transactions.length} />
        </div>
      </div>

      <Collapsible title="修改設定" className="mx-4">
        <RecurringForm
          me={{ userId: ctx.me.userId, nickname: ctx.me.nickname }}
          partner={ctx.partner ? { userId: ctx.partner.userId, nickname: ctx.partner.nickname } : null}
          accounts={accounts.map((a) => ({ id: a.id, label: accountOptionLabel(ctx, a), ownerId: a.ownerId }))}
          categories={categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
          today={toDateKey(new Date())}
          initial={{
            id: r.id,
            name: r.name,
            note: r.note ?? "",
            amount: r.amount,
            categoryId: r.categoryId,
            accountId: r.accountId,
            split: r.split,
            frequency: r.frequency,
            dayOfWeek: r.dayOfWeek,
            dayOfMonth: r.dayOfMonth,
            month: r.month,
            startDate: r.startDate,
            endDate: r.endDate,
            updatedAt: r.updatedAt,
          }}
        />
      </Collapsible>
    </>
  );
}
