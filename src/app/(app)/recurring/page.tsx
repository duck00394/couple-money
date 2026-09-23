import Link from "next/link";
import { GenerateButton } from "@/components/RecurringActions";
import { Card, Empty, PageHeader, SectionTitle, cx } from "@/components/ui";
import { dateHeading } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listRecurring, type RecurringView } from "@/server/services/recurring";

function Row({ r, children }: { r: RecurringView; children?: React.ReactNode }) {
  return (
    <Card className="p-0" data-testid="recurring-row">
      <Link href={`/recurring/${r.id}`} className="flex items-start gap-3 p-4 active:bg-stone-50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 text-xl">{r.categoryIcon ?? "📅"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{r.name}</p>
          <p className="text-xs text-stone-500">{formatMoney(r.amount)}・{r.scheduleText}</p>
          <p className="text-xs text-stone-500">{r.accountName}・{r.payerName}付款・{r.splitText}</p>
          {!r.accountIsActive && <p className="text-xs text-red-600">付款帳戶已停用，請先修改</p>}
        </div>
        <span className="text-stone-400">›</span>
      </Link>
      {children && <div className="px-4 pb-4">{children}</div>}
    </Card>
  );
}

export default async function RecurringPage() {
  const { ctx } = await getAppContext();
  const items = await listRecurring(ctx);
  const due = items.filter((r) => r.status === "ACTIVE" && (r.state === "OVERDUE" || r.state === "TODAY"));
  const upcoming = items.filter((r) => r.status === "ACTIVE" && r.state === "UPCOMING" && r.nextDueDate);
  const ended = items.filter((r) => r.status === "ACTIVE" && r.state === "ENDED");
  const paused = items.filter((r) => r.status === "PAUSED");

  return (
    <>
      <PageHeader
        title="固定支出"
        back="/transactions"
        right={<Link href="/recurring/new" className="rounded-full bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white">＋ 新增</Link>}
      />
      <div className="px-4 pb-6">
        <p className="rounded-xl bg-white px-3.5 py-2.5 text-xs text-stone-500 shadow-sm">
          固定支出只是排程設定，不會自動扣錢。到了應付日，按「產生記帳」才會建立真正的一筆支出。
        </p>

        <SectionTitle>待處理 {due.length > 0 && <span data-testid="recurring-due-count">{due.length}</span>}</SectionTitle>
        {due.length === 0 ? (
          <Card><Empty>目前沒有待處理的固定支出</Empty></Card>
        ) : (
          <div className="space-y-3">
            {due.map((r) => (
              <Row key={r.id} r={r}>
                <p className={cx("mb-1 text-xs font-semibold", r.state === "OVERDUE" ? "text-red-600" : "text-brand-600")} data-testid="recurring-due-label">
                  {r.state === "OVERDUE" ? "逾期" : "今天"}・應付 {r.nextDueDate}（{dateHeading(r.nextDueDate!)}）
                </p>
                <GenerateButton id={r.id} dueDate={r.nextDueDate!} />
              </Row>
            ))}
          </div>
        )}

        {upcoming.length > 0 && (
          <>
            <SectionTitle>即將到期</SectionTitle>
            <div className="space-y-3">
              {upcoming.map((r) => (
                <Row key={r.id} r={r}>
                  <p className="text-xs text-stone-500">下一次應付日：{r.nextDueDate}</p>
                </Row>
              ))}
            </div>
          </>
        )}

        {(paused.length > 0 || ended.length > 0) && (
          <>
            <SectionTitle>已停用／已結束</SectionTitle>
            <div className="space-y-3">
              {[...paused, ...ended].map((r) => (
                <Row key={r.id} r={r}>
                  <p className="text-xs text-stone-500">{r.status === "PAUSED" ? "已停用，不會產生新的待處理" : "已結束（超過結束日期）"}</p>
                </Row>
              ))}
            </div>
          </>
        )}

        {items.length === 0 && (
          <Card className="mt-4 text-center text-sm text-stone-500">
            還沒有固定支出。房租、水電、訂閱這些每個月都要付的，設定一次就不會忘記。
          </Card>
        )}
      </div>
    </>
  );
}
