import { RefundForm } from "@/components/RefundForm";
import { TxKindTabs } from "@/components/TxKindTabs";
import { PageHeader } from "@/components/ui";
import { toDateKey, toTimeKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { assertCanWrite } from "@/server/services/books";
import { listAccounts } from "@/server/services/ledger";
import { accountOptionLabel } from "@/server/txFormData";
import { listRefundable } from "@/server/services/transfers";

export default async function RefundPage({ searchParams }: PageProps<"/transactions/refund">) {
  const sp = await searchParams;
  const from = typeof sp.from === "string" ? sp.from : null;
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  const [sources, accounts] = await Promise.all([listRefundable(ctx, { includeId: from }), listAccounts(ctx)]);
  const now = new Date();
  return (
    <>
      <PageHeader title="退款" back={from ? `/transactions/${from}` : "/transactions"} />
      <TxKindTabs active="refund" />
      <div className="pt-3">
        <RefundForm
          sources={sources.map((s) => ({
            id: s.id,
            title: s.title,
            date: toDateKey(s.occurredOn).replaceAll("-", "/"),
            amount: s.amount,
            refunded: s.refunded,
            refundable: s.refundable,
            accountId: s.accountId,
            accountName: s.accountName,
            fundName: s.fundName,
          }))}
          accounts={accounts.map((a) => ({ id: a.id, label: accountOptionLabel(ctx, a) }))}
          today={toDateKey(now)}
          now={toTimeKey(now)}
          defaultSourceId={from}
        />
      </div>
    </>
  );
}
