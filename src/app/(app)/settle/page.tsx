import { DebtCard } from "@/components/DebtCard";
import { DebtPicker } from "@/components/DebtPicker";
import { CancelSettlementButton, SettleForm } from "@/components/SettleForm";
import { Card, Collapsible, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { dateHeading, toDateKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { ACCOUNT_TYPE_ICON, getBalances, listAccounts, listSettlements } from "@/server/services/ledger";
import { myDebtItems } from "@/server/services/debts";
import { ArtIcon } from "@/components/ArtIcon";

export default async function SettlePage() {
  const { ctx } = await getAppContext();
  const [balances, accounts, history, debtItems] = await Promise.all([
    getBalances(ctx),
    listAccounts(ctx),
    listSettlements(ctx),
    myDebtItems(ctx),
  ]);
  const debt = balances.debts[0];
  const name = (id: string) => (id === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === id)?.nickname ?? "已離開的成員");
  const accountsOf = (uid: string) =>
    accounts.filter((a) => a.ownerId === uid).map((a) => ({ id: a.id, name: a.name, icon: ACCOUNT_TYPE_ICON[a.type] }));
  // 逐筆勾選只在「我欠對方」時才有意義；對方欠我時不混進同一個選擇器
  const iOwe = !!debt && debt.from === ctx.me.userId;

  return (
    <>
      <PageHeader title="結算" />
      <div className="px-4">
        <DebtCard ctx={ctx} debt={debt} compact />

        {iOwe && ctx.canWrite && (
          <div className="mt-3" data-testid="debt-picker">
            <DebtPicker
              key={`${debt.from}-${debt.to}-${debt.amount}`}
              fromUserId={debt.from}
              toUserId={debt.to}
              fromName={name(debt.from)}
              toName={name(debt.to)}
              items={debtItems.items}
              total={debtItems.total}
              unassignedCredit={debtItems.unassignedCredit}
              fromAccounts={accountsOf(debt.from)}
              toAccounts={accountsOf(debt.to)}
            />
          </div>
        )}

        {/* 對方欠我、或想自己輸入金額時，仍然可以用原本的結算表單 */}
        {debt && ctx.canWrite && (
          <Collapsible title={iOwe ? "自己輸入金額結算" : `記錄 ${name(debt.from)} 還給 ${name(debt.to)}`} open={!iOwe}>
            <Card>
              <SettleForm key={`${debt.from}-${debt.to}-${debt.amount}`}
                fromUserId={debt.from}
                toUserId={debt.to}
                fromName={name(debt.from)}
                toName={name(debt.to)}
                max={debt.amount}
                fromAccounts={accountsOf(debt.from)}
                toAccounts={accountsOf(debt.to)}
              />
            </Card>
          </Collapsible>
        )}

        <p className="mt-3 px-1 text-xs leading-relaxed text-stone-500">
          欠款由所有紀錄即時計算。從「共同帳戶」付的錢不會產生個人欠款；修改或刪除舊紀錄後，欠款會自動重算。
        </p>

        <SectionTitle>結算紀錄</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {history.length === 0 && <p className="p-4 text-center text-sm text-stone-500">還沒有結算紀錄</p>}
          {history.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <ArtIcon name="settle" size={20} className="text-stone-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name(s.fromUserId)} 還給 {name(s.toUserId)}</p>
                <p className="truncate text-xs text-stone-500">{dateHeading(toDateKey(s.createdAt))}{s.note ? ` · ${s.note}` : ""}</p>
              </div>
              <span className="font-semibold">{formatMoney(s.amount)}</span>
              {ctx.canWrite && <CancelSettlementButton id={s.id} label={`${name(s.fromUserId)} 還給 ${name(s.toUserId)} ${formatMoney(s.amount)}`} />}
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
