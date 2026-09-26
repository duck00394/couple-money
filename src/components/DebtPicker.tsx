"use client";

import { useActionState, useMemo, useState } from "react";
import { settleAction } from "@/app/actions/settle";
import { formatMoney, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { ArtTile } from "./ArtIcon";
import { showToast } from "./Toast";
import { Button, Card, cx, ErrorText, Field, Select } from "./ui";

export interface DebtPickerItem {
  id: string;
  dateKey: string;
  title: string;
  icon: string;
  amount: number;
  myShare: number;
  owed: number;
  settled: number;
  remaining: number;
}

type Acc = { id: string; name: string };

/**
 * 逐筆欠款 + 多選還款。
 *
 * 勾選只是在決定「這次還多少錢」——送出時仍然只呼叫一次既有的 `settle()`，
 * 建立一筆 SETTLEMENT，不會為每一筆各建一筆，也不會把結算綁定到某幾筆交易。
 * 實際沖銷順序永遠是「最早記錄的先沖銷」（FIFO），畫面上要把這件事講清楚。
 */
export function DebtPicker(props: {
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  items: DebtPickerItem[];
  fromAccounts: Acc[];
  toAccounts: Acc[];
  /** 目前欠款總額，用來對照（= maxSettleAmount） */
  total: number;
  unassignedCredit: number;
}) {
  const payable = useMemo(() => props.items.filter((i) => i.remaining > 0), [props.items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clientRequestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof settleAction>>, fd: FormData) => {
    const r = await settleAction(prev, fd);
    // 成功之後清空選取並換一個 requestId，連按兩下不會還兩次。
    // 還完欠款金額會變，父層會用新的 key 重建這個元件，所以成功訊息用 toast，
    // 不然畫面重建就看不到了。
    if (r?.ok) {
      showToast(r.ok);
      setSelected(new Set());
      setRequestId(crypto.randomUUID());
    }
    return r;
  }, undefined);

  const amount = payable.filter((i) => selected.has(i.id)).reduce((a, i) => a + i.remaining, 0);
  const allOn = payable.length > 0 && payable.every((i) => selected.has(i.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(payable.map((i) => i.id)));
  const canSubmit = amount > 0 && !pending && props.fromAccounts.length > 0 && props.toAccounts.length > 0;

  return (
    <ActionForm action={action} className="pb-submit-bar">
      <input type="hidden" name="clientRequestId" value={clientRequestId} />
      <input type="hidden" name="fromUserId" value={props.fromUserId} />
      <input type="hidden" name="toUserId" value={props.toUserId} />
      <input type="hidden" name="amount" value={toInputString(amount)} />

      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-stone-700">欠款項目</span>
        {payable.length > 0 && (
          <button type="button" onClick={toggleAll} className="text-sm text-brand-600" data-testid="debt-select-all">
            {allOn ? "取消全選" : "全選"}
          </button>
        )}
      </div>

      <Card className="divide-y divide-line p-0">
        {props.items.length === 0 && <p className="px-5 py-6 text-center text-sm text-stone-500">目前沒有欠款項目</p>}
        {props.items.map((i) => {
          const done = i.remaining === 0;
          const on = selected.has(i.id);
          return (
            <label
              key={i.id}
              data-testid="debt-item"
              data-paid={done ? "1" : "0"}
              data-title={i.title}
              data-remaining={i.remaining}
              className={cx("flex items-center gap-3 px-4 py-3", done ? "opacity-55" : "cursor-pointer active:bg-stone-50")}
            >
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 rounded-md border-stone-300 accent-brand-500"
                checked={on}
                disabled={done || pending}
                onChange={() => toggle(i.id)}
                aria-label={`選取 ${i.dateKey} ${i.title}`}
              />
              <ArtTile name={i.icon} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-stone-800">{i.title}</p>
                {/* 390px 一行塞不下四個欄位，拆兩行才不會被截掉 */}
                <p className="truncate text-xs text-stone-500">
                  {i.dateKey.replaceAll("-", "/")}・原始 {formatMoney(i.amount)}
                </p>
                <p className="truncate text-[11px] text-stone-400">
                  我應負擔 {formatMoney(i.myShare)}
                  {i.settled > 0 && `・已沖銷 ${formatMoney(i.settled)} / ${formatMoney(i.owed)}`}
                </p>
              </div>
              <span className={cx("tnum shrink-0 text-[15px]", done ? "text-stone-400" : "font-semibold text-brand-700")}>
                {done ? "已還清" : formatMoney(i.remaining)}
              </span>
            </label>
          );
        })}
      </Card>

      <p className="mt-2 rounded-xl bg-canvas/70 px-3 py-2 text-xs leading-relaxed text-stone-600">
        選取項目代表選擇還款金額；實際還款會依最早記錄的欠款優先沖銷。系統不會把這次結算綁定到你勾選的那幾筆紀錄。
      </p>
      {props.unassignedCredit > 0 && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          有 {formatMoney(props.unassignedCredit)} 的沖銷金額對應不到任何欠款項目（未分配），這裡保守不做分配。欠款總額仍以帳本的即時計算為準。
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label={`${props.fromName} 從`}>
          <Select name="fromAccountId" aria-label="付款帳戶">
            {props.fromAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={`${props.toName} 存入`}>
          <Select name="toAccountId" aria-label="收款帳戶">
            {props.toAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
      </div>
      <input type="hidden" name="note" value="" />

      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="mt-2 text-sm text-brand-700" role="status">{state.ok}</p>}

      <div className="sticky-submit-bar">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="text-stone-600" data-testid="debt-selected-count">已選 {selected.size} 筆</span>
          <span className="tnum font-semibold text-stone-800" data-testid="debt-selected-total">還款總額 {formatMoney(amount)}</span>
        </div>
        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {pending ? "處理中…" : amount > 0 ? `${props.fromName} 還 ${formatMoney(amount)} 給 ${props.toName}` : "請先勾選要還的項目"}
        </Button>
      </div>
    </ActionForm>
  );
}
