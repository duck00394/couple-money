import { AdjustBalanceForm, NewAccountForm, ToggleAccountButton } from "@/components/AccountForms";
import { ArtTile } from "@/components/ArtIcon";
import { MoneyConcepts } from "@/components/MoneyConcepts";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { ACCOUNT_TYPE_ICON, ACCOUNT_TYPE_LABEL, listAccounts } from "@/server/services/ledger";
import { earmarkedByAccount } from "@/server/services/funds";
import { prisma } from "@/server/db";

export default async function AccountsPage() {
  const { ctx } = await getAppContext();
  const [accounts, earmarked] = await Promise.all([listAccounts(ctx, { includeInactive: true }), earmarkedByAccount(prisma, ctx.book.id)]);
  const groups = [
    { title: "我的帳戶", items: accounts.filter((a) => a.ownerId === ctx.me.userId), editable: true },
    { title: "共同帳戶", items: accounts.filter((a) => a.ownerId === null), editable: true },
    ...(ctx.partner ? [{ title: `${ctx.partner.nickname} 的帳戶`, items: accounts.filter((a) => a.ownerId === ctx.partner!.userId), editable: false }] : []),
  ];

  return (
    <>
      <PageHeader title="帳戶" back="/more" />
      <div className="px-4">
        {ctx.canWrite && <div className="mb-4"><NewAccountForm /></div>}
        <MoneyConcepts />
        {groups.map((g) => {
          // 停用的帳戶裡的錢仍然是真的（也會算進轉帳與基金上限），所以小計要一起算
          const total = g.items.reduce((s, a) => s + a.balance, 0);
          return (
            <section key={g.title}>
              <SectionTitle right={<span className="tnum text-sm font-medium text-stone-500">{formatMoney(total)}</span>}>{g.title}</SectionTitle>
              <Card quiet className="divide-y divide-line p-0">
                {g.items.length === 0 && <p className="p-4 text-center text-sm text-stone-500">沒有帳戶</p>}
                {g.items.map((a) => {
                  const isCard = a.type === "CREDIT_CARD";
                  const fundPart = earmarked.get(a.id) ?? 0;
                  return (
                    <div key={a.id} data-testid="account-row" className={`flex items-center gap-3 px-4 py-3 ${a.isActive ? "" : "opacity-50"}`}>
                      <ArtTile name={ACCOUNT_TYPE_ICON[a.type]} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium text-stone-800">{a.name}</p>
                        {/* 這裡有表單（停用／啟用），所以用 div 不是 p（p 裡不能放表單） */}
                        <div className="flex items-center gap-1 text-xs text-stone-500">
                          <span>{ACCOUNT_TYPE_LABEL[a.type]}{a.isActive ? "" : "・已停用"}</span>
                          {g.editable && ctx.canWrite && <><span>·</span><ToggleAccountButton id={a.id} name={a.name} isActive={a.isActive} /></>}
                        </div>
                        {g.editable && ctx.canWrite && <AdjustBalanceForm id={a.id} name={a.name} balance={a.balance} isCard={isCard} />}
                        {fundPart !== 0 && !isCard && (
                          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]" data-testid="account-earmark">
                            <span className="text-brand-700">已指定給基金 {formatMoney(fundPart)}</span>
                            <span className={a.balance - fundPart < 0 ? "font-semibold text-red-600" : "text-emerald-700"}>可自由使用 {formatMoney(a.balance - fundPart)}</span>
                          </div>
                        )}
                        {fundPart !== 0 && a.balance - fundPart < 0 && (
                          <p className="text-[11px] text-red-600">帳戶裡的錢已經少於指定給基金的金額，請從基金取回或補錢進來</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {isCard ? (
                          <>
                            <p className="text-xs text-stone-500">{a.balance <= 0 ? "未繳" : "溢繳"}</p>
                            <p className={`amount ${a.balance < 0 ? "text-orange-600" : "text-stone-800"}`}>{formatMoney(Math.abs(a.balance))}</p>
                          </>
                        ) : (
                          <>
                            {fundPart !== 0 && <p className="text-[11px] text-stone-500">實際餘額</p>}
                            <p className={`amount ${a.balance < 0 ? "text-orange-600" : "text-stone-800"}`}>{formatMoney(a.balance)}</p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card>
            </section>
          );
        })}
        <p className="mt-3 px-1 text-xs text-stone-500">
          餘額由紀錄即時計算：支出會扣款、收入與結算收款會入帳。投入基金只是「指定用途」，不會改變帳戶餘額。
        </p>
      </div>
    </>
  );
}
