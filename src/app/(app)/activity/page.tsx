import Link from "next/link";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { addDays, toDateKey, toTimeKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { groupLabel } from "@/server/domain/notification";
import { listActivity, RECENT_DAYS, RECENT_LIMIT, type ActivityItem } from "@/server/services/notifications";

/**
 * 最近動態：把 AuditLog 裡「對方做的事」整理出來。
 * 沒有已讀狀態（不想為了紅點新增資料表），所以也刻意不做未讀數字。
 */
export default async function ActivityPage() {
  const { ctx } = await getAppContext();
  const items = await listActivity(ctx);
  const today = toDateKey(new Date());
  const yesterday = addDays(today, -1);

  const groups = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const label = groupLabel(item.dateKey, today, yesterday);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }

  return (
    <>
      <PageHeader title="最近動態" back="/more" />
      <div className="px-4">
        <p className="px-1 pb-1 text-xs leading-relaxed text-stone-500">
          {ctx.partner ? `${ctx.partner.nickname} 最近` : "另一半最近"}做了什麼。只看得到最近 {RECENT_DAYS} 天、最多 {RECENT_LIMIT} 筆；自己做的事不會出現在這裡。
        </p>

        {items.length === 0 ? (
          <Card className="mt-3 p-0">
            <Empty icon="bell">最近沒有新的動態</Empty>
          </Card>
        ) : (
          [...groups].map(([label, list]) => (
            <section key={label}>
              <SectionTitle>{label}</SectionTitle>
              <Card className="divide-y divide-line p-0">
                {list.map((item) => {
                  const body = (
                    <>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-base">{item.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-stone-800">{item.text}</p>
                        {item.detail && <p className="truncate text-xs text-stone-500">{item.detail}</p>}
                      </div>
                      <span className="shrink-0 text-[11px] text-stone-400">{toTimeKey(item.at)}</span>
                    </>
                  );
                  return item.href ? (
                    <Link key={item.id} href={item.href} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50" data-testid="activity-row">
                      {body}
                    </Link>
                  ) : (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3" data-testid="activity-row">
                      {body}
                    </div>
                  );
                })}
              </Card>
            </section>
          ))
        )}

        <p className="mt-6 px-1 text-center text-xs text-stone-400">
          動態是由操作紀錄整理出來的，只是呈現，不會影響任何金額或統計。
        </p>
      </div>
    </>
  );
}
