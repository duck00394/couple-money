import Link from "next/link";
import { ArtIcon } from "@/components/ArtIcon";
import { Avatar, Card, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listGroups } from "@/server/services/purchases";

/**
 * 購買紀錄首頁。
 *
 * 作品是**唯一的第一層入口**：這一頁只回答「買了哪些作品、各買幾件、各花多少」，
 * 不展開任何角色。歸屬只用一行小字帶過，要篩要進作品裡面。
 */
export default async function PurchasesPage() {
  const { ctx } = await getAppContext();
  const groups = await listGroups(ctx);
  const all = groups.reduce((a, g) => ({ count: a.count + g.totals.count, amount: a.amount + g.totals.amount }), { count: 0, amount: 0 });
  const nameOf = (id: string | null) => (id === null ? "共同" : ctx.members.find((m) => m.userId === id)?.nickname ?? "?");
  const colorOf = (id: string | null) => (id === null ? "#f3e3be" : ctx.members.find((m) => m.userId === id)?.avatarColor ?? "#eee");

  return (
    <>
      <PageHeader
        title="購買紀錄"
        back="/more"
        right={<Link href="/purchases/manage" className="text-[13px] font-semibold text-brand-600">管理分類</Link>}
      />
      <div className="px-4">
        {groups.length === 0 ? (
          <>
            <Empty icon="shopping-bag">
              還沒有任何購買紀錄
              <span className="mt-2 block text-xs leading-relaxed text-stone-500">
                用來記錄「我們到底買了什麼、花了多少」。<br />
                跟記帳分開：加在這裡不會影響餘額、欠款與統計。
              </span>
            </Empty>
            <div className="space-y-2.5">
              <LinkButton href="/purchases/new" className="w-full">＋ 新增購買紀錄</LinkButton>
              <LinkButton href="/purchases/manage" variant="soft" className="w-full">先建立作品分類</LinkButton>
            </div>
          </>
        ) : (
          <>
            <Card className="flex items-baseline gap-3">
              <div className="flex-1">
                <p className="text-xs font-semibold text-stone-500">我們總共買了</p>
                <p className="amount-lg mt-1 text-[30px]">{formatMoney(all.amount)}</p>
              </div>
              <div className="text-right">
                <p className="tnum text-base font-bold">{all.count} 件</p>
                <p className="mt-0.5 text-[11px] text-stone-500">{groups.length} 個分類</p>
              </div>
            </Card>

            <SectionTitle>作品／分類</SectionTitle>
            <div className="space-y-2.5">
              {groups.map((g) => (
                <Link key={g.id} href={`/purchases/${g.id}`} className="press block" data-testid="purchase-group-card">
                  <Card className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">
                      <ArtIcon name={g.icon} size={22} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px] font-bold">{g.name}</p>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                        {g.byOwner.map((o) => (
                          <span key={o.ownerId ?? "joint"} className="inline-flex items-center gap-1">
                            <Avatar name={nameOf(o.ownerId)} color={colorOf(o.ownerId)} size={16} />
                            {o.count}
                          </span>
                        ))}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="amount text-[17px]">{formatMoney(g.totals.amount)}</p>
                      <p className="mt-0.5 text-[11px] text-stone-500">{g.totals.count} 件</p>
                    </div>
                    <span className="text-lg text-stone-400">›</span>
                  </Card>
                </Link>
              ))}
            </div>

            {ctx.canWrite && (
              <div className="mt-4 space-y-2.5">
                <LinkButton href="/purchases/new" className="w-full">＋ 新增購買紀錄</LinkButton>
              </div>
            )}
          </>
        )}
        <p className="mt-6 text-center text-xs leading-relaxed text-stone-400">
          購買紀錄只是購買歷史，不影響帳戶餘額、欠款、分帳、基金、預算與統計。
        </p>
      </div>
    </>
  );
}
