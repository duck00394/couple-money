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
  const expenseCategories = categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name }));
  const who2 = (id: string) => (id === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === id)?.nickname ?? "已離開的成員");
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
            {/* 明細品項：這張單裡有什麼 */}
            {p.items.length > 0 && (
              <div className="mt-2 space-y-1 rounded-xl bg-canvas/70 px-3 py-2 text-xs" data-testid="preorder-item-list">
                {p.items.map((it) => (
                  <div key={it.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-stone-600">
                      {it.name}
                      {it.qty > 1 && <span className="text-stone-400"> ×{it.qty}</span>}
                      <span className="ml-1 text-stone-400">{it.ownerId === null ? "共同" : who2(it.ownerId)}</span>
                    </span>
                    <span className="tnum shrink-0 text-stone-700">{formatMoney(it.total)}</span>
                  </div>
                ))}
              </div>
            )}
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

            {/* 每個人還需付多少：應負擔由「誰的」決定，已負擔是每筆付款的分帳結果加總 */}
            {p.shares.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm" data-testid="preorder-shares">
                <p className="text-xs text-stone-500">每個人還需付</p>
                <p className="text-[11px] text-stone-400">
                  {p.splitRule ? "依這張單設定的「誰付多少」" : p.ownerId === null ? "共同：兩人平分" : `全部算 ${who2(p.ownerId)} 的`}
                </p>
                {p.shares.map((sh) => (
                  <div key={sh.userId} className="flex items-baseline justify-between" data-share={sh.userId}>
                    <span className="text-stone-700">{who2(sh.userId)}</span>
                    <span className="tnum text-stone-700">
                      <span className="font-semibold text-stone-900">{formatMoney(sh.remaining)}</span>
                      <span className="ml-1 text-[11px] text-stone-400">（應負擔 {formatMoney(sh.due)}・已負擔 {formatMoney(sh.borne)}）</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                categories={expenseCategories}
                defaultCategoryId={p.categoryId}
                members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }))}
                dues={p.shares.map((sh) => ({ userId: sh.userId, due: sh.due }))}
                meId={ctx.me.userId}
              />
              <Link href={`/transactions/new?preorder=${p.id}`} className="mt-3 block text-center text-xs text-brand-600 underline underline-offset-2">
                要選分類、標籤或從基金扣？用完整的記帳頁 →
              </Link>
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
                    items: p.items.map((it) => ({
                      name: it.name,
                      unitAmount: toInputString(it.unitAmount),
                      qty: String(it.qty),
                      ownerId: it.ownerId ?? "JOINT",
                    })),
                    splitRule: p.splitRule,
                    categoryId: p.categoryId ?? "",
                  }}
                  members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }))}
                  categories={expenseCategories}
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
