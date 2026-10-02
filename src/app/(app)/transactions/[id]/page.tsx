import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelAdjustmentButton } from "@/components/AccountForms";
import { ReceiptBox } from "@/components/ReceiptBox";
import { DeleteTxButton } from "@/components/DeleteTxButton";
import { TransactionForm } from "@/components/TransactionForm";
import { TxDetail } from "@/components/TxDetail";
import { Card, Collapsible, PageHeader } from "@/components/ui";
import { ArtIcon } from "@/components/ArtIcon";
import { prisma } from "@/server/db";
import { toDateKey } from "@/lib/dates";
import { moneyFmt } from "@/lib/money";
import { getAppContext } from "@/server/context";
import type { SplitRule } from "@/server/domain/split";
import { getTransaction } from "@/server/services/ledger";
import { refundsOf } from "@/server/services/transfers";
import { listReceipts, MAX_RECEIPTS } from "@/server/services/receipts";
import { entryOfTransaction } from "@/server/services/purchases";
import { loadTxFormOptions } from "@/server/txFormData";

export default async function EditTransactionPage({ params }: PageProps<"/transactions/[id]">) {
  const { id } = await params;
  const { ctx } = await getAppContext();
  const fmtMoney = moneyFmt(ctx.book.baseCurrency);
  const tx = await getTransaction(ctx, id);
  if (!tx) notFound();
  const related = tx.relatedId
    ? await prisma.transaction.findFirst({ where: { id: tx.relatedId, bookId: ctx.book.id }, select: { id: true, title: true, amount: true } })
    : null;
  const [refunds, receipts, purchase] = await Promise.all([
    tx.type === "EXPENSE" ? refundsOf(ctx, tx.id) : Promise.resolve([]),
    listReceipts(ctx, tx.id),
    // 購買紀錄完全不影響這頁的任何金額，只是多一張卡片
    tx.type === "EXPENSE" ? entryOfTransaction(ctx, tx.id) : Promise.resolve(null),
  ]);
  const refunded = refunds.reduce((a, r) => a + r.amount, 0);
  const refundable = Math.max(0, tx.amount - refunded);
  // 「任務獎勵提列」建立出來的收入：金額等於那一批獎勵的總和，不能單獨改，只能整筆作廢
  const withdrawnRewards = await prisma.taskReward.count({ where: { withdrawalId: tx.id } });

  if (withdrawnRewards > 0) {
    return (
      <>
        <PageHeader title="紀錄詳細" back="/transactions" />
        <div className="px-4">
          <TxDetail tx={tx} ctx={ctx} related={related} />
          <Card className="mt-3 space-y-1.5 text-sm" data-testid="reward-withdrawal-note">
            <p className="font-semibold text-stone-800">這是一筆任務獎勵提列</p>
            <p className="text-stone-600">
              金額是你當時「我的獎勵」餘額的總和，所以不能單獨改。作廢的話，這 {fmtMoney(tx.amount)} 會從帳戶退回去，
              那批獎勵也會回到<Link href="/tasks" className="text-brand-600 underline">「我的獎勵」</Link>，可以重新提列。
            </p>
          </Card>
          <div className="mt-3">
            <ReceiptBox transactionId={tx.id} receipts={receipts} max={MAX_RECEIPTS} canWrite={ctx.canWrite} />
          </div>
          <DeleteTxButton
            id={tx.id}
            label="作廢這筆提列"
            confirmText="作廢這筆提列？帳戶的錢會退回去，那批獎勵會回到「我的獎勵」，之後可以重新提列。"
          />
        </div>
      </>
    );
  }

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

  const options = await loadTxFormOptions(ctx, { keepCategoryId: tx.categoryId, keepPreorderId: tx.preorderId });
  /*
   * 編輯時那一行「約 NT$」要用**這筆交易當初鎖住的匯率**，不是帳本現在的匯率 ——
   * 送出之後那兩個欄位也不會被覆寫，所以預覽跟存下來的結果要是同一個數字。
   */
  if (tx.homeRateUnits && tx.homeRateMinor) {
    options.homeRate = { units: tx.homeRateUnits, minor: tx.homeRateMinor };
  }
  const payAccountId = tx.payments[0]?.accountId ?? "";
  // 已停用的帳戶仍要能在編輯時顯示
  if (payAccountId && !options.accounts.some((a) => a.id === payAccountId)) {
    const a = tx.payments[0].account;
    options.accounts.push({ id: a.id, name: `${a.name}（已停用）`, type: a.type, ownerId: a.ownerId, icon: "tag" });
  }
  return (
    <>
      <PageHeader title="紀錄詳細" back="/transactions" />
      {tx.type === "EXPENSE" && (
        <div className="px-4">
          <Card className="space-y-2 text-sm" data-testid="refund-summary">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-stone-500">原始金額 {fmtMoney(tx.amount)}・已退款 {fmtMoney(refunded)}</p>
                <p className="font-semibold">可退款 {fmtMoney(refundable)}</p>
              </div>
              {refundable > 0 && (
                <Link href={`/transactions/refund?from=${tx.id}`} className="flex items-center gap-1.5 rounded-full bg-brand-200 ring-1 ring-brand-400/60 px-3.5 py-2 text-sm font-semibold text-stone-800"><ArtIcon name="refund" size={15} />退款</Link>
              )}
            </div>
            {refunds.length > 0 && (
              <ul className="space-y-1 border-t border-line pt-2">
                {refunds.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <Link href={`/transactions/${r.id}`} className="text-brand-600 underline">
                      {toDateKey(r.occurredAt).replaceAll("-", "/")} 退款{r.note ? `・${r.note}` : ""}
                    </Link>
                    <span className="text-emerald-600">+{fmtMoney(r.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-line pt-1 font-semibold">
                  <span>實際淨支出</span>
                  <span>{fmtMoney(tx.amount - refunded)}</span>
                </li>
              </ul>
            )}
          </Card>
        </div>
      )}
      {tx.type === "EXPENSE" && (
        <div className="mt-3 px-4">
          {purchase ? (
            <Link href={`/purchases/entry/${purchase.id}`} className="press block" data-testid="purchase-link">
              <Card className="flex items-center gap-3 border-brand-500">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">
                  <ArtIcon name="shopping-bag" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">已在購買紀錄裡</p>
                  <p className="mt-0.5 truncate text-xs text-stone-500">{purchase.groupName} ・ {purchase.tagName}</p>
                </div>
                <span className="text-lg text-stone-400">›</span>
              </Card>
            </Link>
          ) : ctx.canWrite ? (
            <Link href={`/purchases/new?tx=${tx.id}`} className="press block" data-testid="add-purchase-link">
              <Card className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-kraft">
                  <ArtIcon name="shopping-bag" size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">加入購買紀錄</p>
                  <p className="mt-0.5 text-xs text-stone-500">沿用這筆的金額與日期，只要選作品、歸屬與角色</p>
                </div>
                <span className="text-lg text-stone-400">›</span>
              </Card>
            </Link>
          ) : null}
        </div>
      )}
      <Collapsible title="查看詳細資料（金流、負擔、建立者）" className="mx-4 mt-3 mb-3">
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
          preorderId: tx.preorderId,
          // V14：編輯外幣交易時，金額欄位要回到**原幣**（使用者當初輸入的 ¥2,500），
          // 不是換算後的台幣 —— 不然一打開編輯頁金額就看起來不一樣了。
          currency: tx.currency,
          foreignAmount: tx.foreignAmount,
        }}
      />
    </>
  );
}
