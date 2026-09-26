import Link from "next/link";
import { ArtTile } from "@/components/ArtIcon";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { etaText, STATE_LABEL } from "@/server/domain/preorder";
import { listPreorders } from "@/server/services/preorders";
import { toDateKey } from "@/lib/dates";

/**
 * 預購清單。
 * 快到貨又還沒付完的排最前面，已結清與已取消沉到最後（排序在 domain/preorder.ts）。
 */
export default async function PreordersPage() {
  const { ctx } = await getAppContext();
  const today = toDateKey(new Date());
  const list = await listPreorders(ctx, { today });
  const open = list.filter((p) => p.state === "ACTIVE");
  const totalRemaining = open.reduce((a, p) => a + p.money.remaining, 0);
  const who = (id: string | null) => (id === null ? "共同" : id === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === id)?.nickname ?? "");

  return (
    <>
      <PageHeader
        title="預購"
        back="/more"
        right={ctx.canWrite ? (
          <Link href="/preorders/new" className="rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-3 py-1.5 text-sm font-semibold text-stone-800" data-testid="new-preorder">
            ＋ 新增預購
          </Link>
        ) : undefined}
      />
      <div className="px-4">
        <Card className="px-5 py-5">
          <p className="text-[13px] text-stone-500">還沒付的錢</p>
          <p className="amount-lg mt-1 text-[2.2rem] text-stone-800" data-testid="preorder-remaining">{formatMoney(totalRemaining)}</p>
          <p className="mt-1 text-xs text-stone-500">{open.length} 張進行中・這筆錢還在你的帳戶裡，不算這個月的支出</p>
        </Card>

        <SectionTitle>所有預購</SectionTitle>
        {list.length === 0 ? (
          <Card className="p-0">
            <Empty icon="package" action={<Link href="/preorders/new" className="text-sm font-semibold text-brand-600">建立第一張 →</Link>}>
              預購是「已經訂了、還沒完全付完」的東西
            </Empty>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {list.map((p) => {
              const dim = p.state !== "ACTIVE";
              return (
                <Link key={p.id} href={`/preorders/${p.id}`} className={`paper block px-4 py-3.5 active:bg-stone-50 ${dim ? "opacity-60" : ""}`} data-testid="preorder-row">
                  <div className="flex items-center gap-3">
                    <ArtTile name={p.emoji} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-stone-800">{p.name}</p>
                      <p className="truncate text-xs text-stone-500">
                        {who(p.ownerId)}{p.seller ? `・${p.seller}` : ""}・{p.state === "ACTIVE" ? etaText(p.expectedOn, today) : STATE_LABEL[p.state]}
                      </p>
                    </div>
                    <span className="tnum shrink-0 text-right text-[15px] text-stone-800">{formatMoney(p.money.total)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-line pt-2 text-xs">
                    <span className="text-stone-500">已付 <span className="tnum text-stone-700">{formatMoney(p.money.paid)}</span></span>
                    {p.money.remaining > 0 ? (
                      <span className="tnum font-semibold text-brand-700">待結 {formatMoney(p.money.remaining)}</span>
                    ) : (
                      <span className="text-stone-400">{STATE_LABEL[p.state]}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
