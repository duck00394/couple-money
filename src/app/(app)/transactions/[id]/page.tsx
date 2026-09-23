import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelAdjustmentButton } from "@/components/AccountForms";
import { ReceiptBox } from "@/components/ReceiptBox";
import { DeleteTxButton } from "@/components/DeleteTxButton";
import { TransactionForm } from "@/components/TransactionForm";
import { TxDetail } from "@/components/TxDetail";
import { Card, Collapsible, PageHeader } from "@/components/ui";
import { prisma } from "@/server/db";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import type { SplitRule } from "@/server/domain/split";
import { getTransaction } from "@/server/services/ledger";
import { refundsOf } from "@/server/services/transfers";
import { listReceipts, MAX_RECEIPTS } from "@/server/services/receipts";
import { loadTxFormOptions } from "@/server/txFormData";

export default async function EditTransactionPage({ params }: PageProps<"/transactions/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  const tx = await getTransaction(ctx, id);
  if (!tx) notFound();
  const related = tx.relatedId
    ? await prisma.transaction.findFirst({ where: { id: tx.relatedId, bookId: ctx.book.id }, select: { id: true, title: true, amount: true } })
    : null;
  const [refunds, receipts] = await Promise.all([
    tx.type === "EXPENSE" ? refundsOf(ctx, tx.id) : Promise.resolve([]),
    listReceipts(ctx, tx.id),
  ]);
  const refunded = refunds.reduce((a, r) => a + r.amount, 0);
  const refundable = Math.max(0, tx.amount - refunded);

  if (tx.type !== "EXPENSE" && tx.type !== "INCOME") {
    const isReward = tx.type === "TRANSFER" && tx.sourceType === "REWARD_DEPOSIT";
    return (
      <>
        <PageHeader title="紀錄詳細" back="/transactions" />
        <div className="px-4">
          <TxDetail tx={tx} ctx={ctx} related={related} />
          <div className="mt-3">
            <ReceiptBox transactionId={tx.id} receipts={receipts} max={MAX_RECEIPTS} canWrite={ctx.canWrite} />
          </div>
          {tx.type === "TRANSFER" && !isReward && (
            <DeleteTxButton id={tx.id} label="作廢這筆轉帳" confirmText="作廢這筆轉帳？兩個帳戶的餘額會恢復原狀。" />
          )}
          {tx.type === "REFUND" && (
            <DeleteTxButton id={tx.id} label="作廢這筆退款" confirmText="作廢這筆退款？原始消費的可退款金額與欠款會恢復。" />
          )}
          {tx.type === "ADJUSTMENT" && ctx.canWrite && <CancelAdjustmentButton id={tx.id} />}
          {tx.type === "OPENING_BALANCE" && (
            <p className="mt-4 text-center text-xs text-stone-500">
              期初餘額不能作廢。金額打錯的話，請到 <Link href="/accounts" className="text-brand-600 underline">帳戶頁</Link> 用「調整餘額」補一筆。
            </p>
          )}
        </div>
      </>
    );
  }

  const options = await loadTxFormOptions(ctx, { keepCategoryId: tx.categoryId });
  const payAccountId = tx.payments[0]?.accountId ?? "";
  // 已停用的帳戶仍要能在編輯時顯示
  if (payAccountId && !options.accounts.some((a) => a.id === payAccountId)) {
    const a = tx.payments[0].account;
    options.accounts.push({ id: a.id, name: `${a.name}（已停用）`, type: a.type, ownerId: a.ownerId, icon: "🗃️" });
  }
  return (
    <>
      <PageHeader title="紀錄詳細" back="/transactions" />
      {tx.type === "EXPENSE" && (
        <div className="px-4">
          <Card className="space-y-2 text-sm" data-testid="refund-summary">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500">原始金額 {formatMoney(tx.amount)}・已退款 {formatMoney(refunded)}</p>
                <p className="font-semibold">可退款 {formatMoney(refundable)}</p>
              </div>
              {refundable > 0 && (
                <Link href={`/transactions/refund?from=${tx.id}`} className="rounded-full bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white">↩️ 退款</Link>
              )}
            </div>
            {refunds.length > 0 && (
              <ul className="space-y-1 border-t border-stone-100 pt-2">
                {refunds.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <Link href={`/transactions/${r.id}`} className="text-brand-600 underline">
                      {toDateKey(r.occurredAt).replaceAll("-", "/")} 退款{r.note ? `・${r.note}` : ""}
                    </Link>
                    <span className="text-emerald-600">+{formatMoney(r.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-stone-100 pt-1 font-semibold">
                  <span>實際淨支出</span>
                  <span>{formatMoney(tx.amount - refunded)}</span>
                </li>
              </ul>
            )}
          </Card>
        </div>
      )}
      <Collapsible title="🔍 查看詳細資料（金流、負擔、建立者）" className="mx-4 mt-3 mb-3">
        <TxDetail tx={tx} ctx={ctx} related={related} />
      </Collapsible>
      <div className="mb-3 px-4">
        <ReceiptBox transactionId={tx.id} receipts={receipts} max={MAX_RECEIPTS} canWrite={ctx.canWrite} />
      </div>
      <TransactionForm
        {...options}
        initial={{
          id: tx.id,
          version: tx.version,
          type: tx.type,
          amount: tx.amount,
          accountId: payAccountId,
          categoryId: tx.categoryId,
          title: tx.title ?? "",
          note: tx.note ?? "",
          occurredOn: toDateKey(tx.occurredAt),
          split: tx.splitRule as unknown as SplitRule | null,
          fundId: tx.fundEntry && !tx.fundEntry.deletedAt ? tx.fundEntry.fundId : null,
          fundAccountId: tx.fundEntry && !tx.fundEntry.deletedAt ? tx.fundEntry.accountId : null,
          tags: tx.tags.map((t) => t.tag.name),
        }}
      />
    </>
  );
}
