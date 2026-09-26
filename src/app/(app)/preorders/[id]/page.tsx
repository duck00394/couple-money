import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtTile } from "@/components/ArtIcon";
import { CancelPreorderButton, DeletePreorderButton, PayPreorderForm, PreorderForm } from "@/components/PreorderForms";
import { Card, Collapsible, PageHeader, ProgressBar, SectionTitle } from "@/components/ui";
import { dateHeading, toDateKey } from "@/lib/dates";
import { formatMoney, toInputString } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { etaText, STATE_LABEL } from "@/server/domain/preorder";
import { getPreorder } from "@/server/services/preorders";
import { listAccounts, listCategories } from "@/server/services/ledger";

export default async function PreorderDetailPage({ params }: PageProps<"/preorders/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  const today = toDateKey(new Date());
  const [p, accounts, categories] = await Promise.all([getPreorder(ctx, id, { today }), listAccounts(ctx), listCategories(ctx)]);
  if (!p) notFound();

  const payable = accounts
    .filter((a) => a.isActive && (a.ownerId === null || a.ownerId === ctx.me.userId))
    .map((a) => ({ id: a.id, label: a.ownerId === null ? `共同・${a.name}` : a.name }));
  const who = p.ownerId === null ? "共同" : p.ownerId === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === p.ownerId)?.nickname ?? "";
  const progress = p.money.total > 0 ? p.money.paid / p.money.total : 0;

  return (
    <>
      <PageHeader title={p.name} back="/preorders" />
      <div className="px-4">
        <Card className="px-5 py-4">
          <div className="flex items-center gap-3">
            <ArtTile name={p.emoji} size={42} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-stone-800">{p.name}</p>
              <p className="truncate text-xs text-stone-500">
                {who}{p.seller ? `・${p.seller}` : ""}・{p.state === "ACTIVE" ? etaText(p.expectedOn, today) : STATE_LABEL[p.state]}
              </p>
            </div>
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-stone-500">應付總額</span>
              <span className="tnum text-[17px] text-stone-800">{formatMoney(p.money.total)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-stone-400">
              商品 {formatMoney(p.itemAmount)}{p.shipping > 0 ? `・運費 ${formatMoney(p.shipping)}` : ""}
            </p>
            <ProgressBar value={progress} className="mt-2.5" />
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-stone-500">已付</p>
                <p className="amount mt-0.5 text-[17px] text-stone-800" data-testid="preorder-paid">{formatMoney(p.money.paid)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-stone-500">待結</p>
                <p className="amount mt-0.5 text-[17px] text-brand-700" data-testid="preorder-remaining">{formatMoney(p.money.remaining)}</p>
              </div>
            </div>
            {p.money.overpaid > 0 && <p className="mt-2 text-xs text-amber-700">付款比應付總額多了 {formatMoney(p.money.overpaid)}，可以檢查看看是不是多記了一筆。</p>}
          </div>
          {p.note && <p className="mt-3 border-t border-line pt-3 text-sm text-stone-600">{p.note}</p>}
        </Card>

        {p.state === "CANCELLED" ? (
          <Card className="mt-3 text-sm text-stone-600">
            這張預購已經取消。已經付出去的錢仍然是已付 —— 如果實際有收到退款，請到下面的付款紀錄點進去走退款。
          </Card>
        ) : ctx.canWrite && payable.length > 0 ? (
          <>
            <SectionTitle>記錄付款</SectionTitle>
            <Card>
              <PayPreorderForm
                id={p.id}
                remaining={p.money.remaining}
                today={today}
                accounts={payable}
                categories={categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name }))}
                members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }))}
                meId={ctx.me.userId}
              />
            </Card>
          </>
        ) : null}

        <SectionTitle>付款紀錄</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {p.payments.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-stone-500">還沒有任何付款。待結的錢還在你的帳戶裡。</p>
          ) : (
            p.payments.map((t) => (
              <Link key={t.id} href={`/transactions/${t.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50" data-testid="preorder-payment">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-stone-800">{t.title || "預購付款"}</p>
                  <p className="truncate text-xs text-stone-500">
                    {dateHeading(t.occurredOn)}{t.refunded > 0 ? `・已退款 ${formatMoney(t.refunded)}` : ""}
                  </p>
                </div>
                <span className="tnum shrink-0 text-sm text-stone-800">−{formatMoney(t.amount)}</span>
              </Link>
            ))
          )}
        </Card>

        {ctx.canWrite && (
          <>
            <Collapsible title="編輯預購">
              <Card>
                <PreorderForm
                  values={{
                    id: p.id, name: p.name, seller: p.seller ?? "", emoji: p.emoji,
                    expectedOn: p.expectedOn ?? "", itemAmount: toInputString(p.itemAmount),
                    shipping: p.shipping ? toInputString(p.shipping) : "",
                    ownerId: p.ownerId ?? "JOINT", note: p.note ?? "",
                  }}
                  members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }))}
                />
              </Card>
            </Collapsible>
            <div className="mt-4 space-y-2">
              <CancelPreorderButton id={p.id} cancelled={p.state === "CANCELLED"} />
              <DeletePreorderButton id={p.id} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
