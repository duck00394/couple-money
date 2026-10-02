"use client";

/**
 * 試用模式的「action」。
 *
 * 簽名刻意跟 server action 一模一樣：`(prev, FormData) => ActionState`。
 * 讀的也是同一份契約 —— `<TransactionForm>` 把整筆交易塞在 hidden input `payload`
 * 的那包 JSON 裡，這裡就解同一包。所以那 830 行的表單可以原封不動共用，
 * 不需要為試用模式複製一份。
 *
 * **這裡沒有 fetch、沒有 server action、沒有任何 I/O。** 全部是同步的記憶體操作。
 */
import type { ActionState } from "@/server/actions";
import type { SplitRule } from "@/server/domain/split";
import type { DemoOp } from "./types";

/** `<TransactionForm>` 送出的 payload 形狀（跟 actions/transactions.ts 讀的是同一包）。 */
interface TxPayload {
  type: "EXPENSE" | "INCOME" | "REFUND";
  amount: number;
  accountId: string;
  categoryId: string | null;
  title: string;
  note: string;
  tags?: string[];
  occurredOn: string;
  split: SplitRule;
  currency?: string | null;
  foreignAmount?: number | null;
  fundId?: string | null;
  preorderId?: string | null;
  purchase?: { groupId: string; categoryId: string; tagId: string; ownerId: string } | null;
  id?: string;
}

/** 一次套用多個操作（全有或全無）—— 見 store.tsx 的 `runAll`。 */
type RunAll = (ops: DemoOp[]) => ActionState;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/**
 * 記帳的儲存／刪除。
 *
 * `onDone` 給呼叫端做換頁（正式模式是 action 裡的 redirect，試用模式用 router.push）。
 * 成功時才呼叫，失敗要留在原頁把錯誤顯示出來。
 */
export function txActions(runAll: RunAll, onDone: () => void) {
  const save = (_prev: ActionState, fd: FormData): ActionState => {
    let p: TxPayload;
    try {
      p = JSON.parse(str(fd, "payload")) as TxPayload;
    } catch {
      return { error: "表單資料有問題，請重新填一次" };
    }

    const input = {
      type: p.type,
      title: p.title,
      amount: p.amount,
      occurredOn: p.occurredOn,
      categoryId: p.categoryId,
      note: p.note,
      payers: [{ accountId: p.accountId, amount: p.amount }],
      rule: p.split,
      // V14：外幣時 engine 會忽略 amount，自己用原幣 × 匯率重算
      currency: p.currency ?? null,
      foreignAmount: p.foreignAmount ?? null,
      fundId: p.fundId ?? null,
      tags: p.tags ?? [],
    };

    const ops: DemoOp[] = [
      p.id ? { kind: "tx.update", id: p.id, input } : { kind: "tx.add", input },
    ];

    // 記帳時順手勾了「加進購買紀錄」：跟正式模式一樣，兩筆是同一個動作，全有或全無
    if (!p.id && p.purchase) {
      ops.push({
        kind: "purchase.add",
        input: {
          groupId: p.purchase.groupId,
          categoryId: p.purchase.categoryId,
          tagId: p.purchase.tagId,
          // 表單用 "JOINT" 當共同的哨兵值，跟 domain/purchase.ts 的 toOwnerId 同一個約定
          ownerId: p.purchase.ownerId === "JOINT" ? null : p.purchase.ownerId,
          title: p.title,
          amount: p.amount,
          occurredOn: p.occurredOn,
          note: p.note,
          transactionId: null,
        },
      });
    }

    const r = runAll(ops);
    if (r?.error) return r;
    onDone();
    return { ok: "已儲存" };
  };

  const remove = (_prev: ActionState, fd: FormData): ActionState => {
    const id = str(fd, "id");
    if (!id) return { error: "找不到要刪除的紀錄" };
    const r = runAll([{ kind: "tx.delete", id }]);
    if (r?.error) return r;
    onDone();
    return { ok: "已刪除" };
  };

  return { save, remove };
}
