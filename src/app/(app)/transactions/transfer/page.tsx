import { TransferForm } from "@/components/TransferForm";
import { TxKindTabs } from "@/components/TxKindTabs";
import { PageHeader } from "@/components/ui";
import { toDateKey, toTimeKey } from "@/lib/dates";
import { prisma } from "@/server/db";
import { getAppContext } from "@/server/context";
import { assertCanWrite } from "@/server/services/books";
import { earmarkedByAccount } from "@/server/services/funds";
import { listAccounts } from "@/server/services/ledger";
import { accountOptionLabel } from "@/server/txFormData";

export default async function TransferPage() {
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  const [accounts, earmarked] = await Promise.all([listAccounts(ctx), earmarkedByAccount(prisma, ctx.book.id)]);
  const options = accounts.map((a) => {
    const e = earmarked.get(a.id) ?? 0;
    return {
      id: a.id,
      name: a.name,
      label: accountOptionLabel(ctx, a),
      isCard: a.type === "CREDIT_CARD",
      balance: a.balance,
      earmarked: e,
      free: a.balance - e,
    };
  });
  const now = new Date();
  return (
    <>
      <PageHeader title="帳戶間轉帳" back="/transactions" />
      <TxKindTabs active="transfer" />
      <div className="pt-3">
        <TransferForm accounts={options} today={toDateKey(now)} now={toTimeKey(now)} />
      </div>
    </>
  );
}
