import { TransactionForm } from "@/components/TransactionForm";
import { TxKindTabs } from "@/components/TxKindTabs";
import { PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { assertCanWrite } from "@/server/services/books";
import { loadTxFormOptions } from "@/server/txFormData";

export default async function NewTransactionPage({ searchParams }: PageProps<"/transactions/new">) {
  const sp = await searchParams;
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  const options = await loadTxFormOptions(ctx);
  const fundId = typeof sp.fund === "string" ? sp.fund : null;
  // 從哪裡來就回哪裡去（只接受站內路徑），記完帳才看得到自己剛記的那一筆
  const rawFrom = typeof sp.from === "string" ? sp.from : "";
  const from = rawFrom.startsWith("/") && !rawFrom.startsWith("//") ? rawFrom : null;
  // 從基金頁來記「基金支出」：付款帳戶預設為這個基金額度最多的帳戶（優先共同帳戶或自己的帳戶）
  const storage = fundId
    ? options.allocations
        .filter((x) => x.fundId === fundId)
        .map((x) => ({ ...x, account: options.accounts.find((a) => a.id === x.accountId) }))
        .filter((x) => x.account && (x.account.ownerId === null || x.account.ownerId === ctx.me.userId))
        .sort((x, y) => y.amount - x.amount)[0] ?? null
    : null;
  return (
    <>
      <PageHeader title="記一筆" back={fundId ? `/funds/${fundId}` : from ?? "/"} />
      <TxKindTabs active="new" />
      <TransactionForm
        {...options}
        returnTo={fundId ? `/funds/${fundId}` : from ?? "/"}
        defaultFundId={fundId}
        defaultAccountId={storage?.accountId && options.accounts.some((a) => a.id === storage.accountId) ? storage.accountId : null}
      />
    </>
  );
}
