"use client";

/**
 * 試用模式的交易詳細／編輯頁。
 *
 * 支出與收入可以編輯（同一個 `<TransactionForm>`，帶 initial）；
 * 結算、期初餘額、轉帳這些在正式模式也不能直接編輯，這裡一樣只給唯讀摘要。
 */
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TransactionForm } from "@/components/TransactionForm";
import { Card, Empty, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { TX_TYPE_LABEL } from "@/server/domain/ledger";
import { txActions } from "@/demo/actions";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoTransactionPage() {
  const { id } = useParams<{ id: string }>();
  const { state, todayKey, runAll } = useDemo();
  const router = useRouter();
  const { save, remove } = txActions(runAll, () => router.push("/demo/transactions"));

  const tx = state.txs.find((t) => t.id === id);
  if (!tx) {
    return (
      <>
        <PageHeader title="找不到紀錄" back="/demo/transactions" />
        <div className="px-4">
          <Card quiet className="p-0">
            <Empty icon="transaction" action={<Link href="/demo/transactions" className="text-sm font-semibold text-brand-600">回到列表 →</Link>}>
              這筆紀錄已經不存在了
            </Empty>
          </Card>
        </div>
      </>
    );
  }

  const initial = select.txInitial(state, id);
  const nameOf = (uid: string | null) =>
    uid === null ? "共同" : state.users.find((u) => u.id === uid)?.nickname ?? "已離開的成員";

  // 支出／收入 → 可以編輯
  if (initial) {
    return (
      <>
        <PageHeader title="編輯紀錄" back="/demo/transactions" />
        <TransactionForm
          {...select.txFormOptions(state, todayKey)}
          initial={initial}
          saveAction={save}
          deleteAction={remove}
        />
      </>
    );
  }

  // 其餘型別：唯讀摘要
  return (
    <>
      <PageHeader title={TX_TYPE_LABEL[tx.type]} back="/demo/transactions" />
      <div className="space-y-3 px-4">
        <Card className="px-5 py-4">
          <p className="text-xs text-stone-500">{tx.occurredOn}</p>
          <p className="mt-1 text-[17px] font-semibold text-stone-800">{tx.title}</p>
          <p className="amount mt-2 text-[1.9rem] text-stone-800">{formatMoney(tx.amount)}</p>
          {tx.note && <p className="mt-2 text-sm text-stone-600">{tx.note}</p>}
        </Card>

        <Card className="divide-y divide-line p-0">
          {tx.payments.map((p, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-stone-600">
                {nameOf(p.userId)}・{state.accounts.find((a) => a.id === p.accountId)?.name ?? "已刪除的帳戶"}
              </span>
              {/* payment 為正 = 錢流出該帳戶，顯示時換成直覺的加減 */}
              <span className="amount text-stone-800">
                {p.amount > 0 ? "-" : "+"}{formatMoney(Math.abs(p.amount))}
              </span>
            </div>
          ))}
        </Card>

        <p className="rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          {tx.type === "SETTLEMENT"
            ? "結算在正式模式要到結算頁取消，這裡一樣不能直接改。"
            : "這個類型不是在記帳頁編輯的，試用模式維持跟正式模式一樣的限制。"}
        </p>
      </div>
    </>
  );
}
