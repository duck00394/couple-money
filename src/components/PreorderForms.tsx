"use client";

import { useActionState, useState } from "react";
import { cancelPreorderAction, deletePreorderAction, payPreorderAction, savePreorderAction } from "@/app/actions/preorders";
import { formatMoney, parseAmount, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { IconPicker } from "./EmojiPicker";
import { Button, cx, DateInput, ErrorText, Field, Input, Select, inputClass } from "./ui";

const PREORDER_ICONS = ["package", "gamepad", "shirt", "smartphone", "book", "gift", "cake", "sofa", "laptop", "plane", "shopping-bag", "tag"] as const;

export interface PreorderFormValues {
  id?: string;
  name: string;
  seller: string;
  emoji: string;
  expectedOn: string;
  itemAmount: string;
  shipping: string;
  ownerId: string;
  note: string;
}

/** 建立／編輯預購。金額只填「應付的」，已付多少由付款紀錄自己算。 */
export function PreorderForm({ values, members }: { values: PreorderFormValues; members: Array<{ userId: string; nickname: string }> }) {
  const [state, action, pending] = useActionState(savePreorderAction, undefined);
  const [item, setItem] = useState(values.itemAmount);
  const [ship, setShip] = useState(values.shipping);
  const total = (parseAmount(item) ?? 0) + (parseAmount(ship) ?? 0);

  return (
    <ActionForm action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <Field label="圖示"><IconPicker options={PREORDER_ICONS} defaultValue={values.emoji} /></Field>
      <Field label="品名"><Input name="name" required maxLength={40} defaultValue={values.name} placeholder="例如：Switch 2 主機" /></Field>
      <Field label="賣家（選填）"><Input name="seller" maxLength={40} defaultValue={values.seller} placeholder="例如：博客來" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="商品金額"><Input name="itemAmount" inputMode="decimal" required value={item} onChange={(e) => setItem(e.target.value)} placeholder="13000" /></Field>
        <Field label="運費（選填）"><Input name="shipping" inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value)} placeholder="150" /></Field>
      </div>
      {total > 0 && <p className="-mt-1 text-xs text-stone-500">應付總額 <span className="tnum font-semibold text-stone-700">{formatMoney(total)}</span></p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="預計到貨（選填）"><DateInput name="expectedOn"  defaultValue={values.expectedOn} /></Field>
        <Field label="誰的">
          <Select name="ownerId" defaultValue={values.ownerId}>
            <option value="JOINT">共同</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.nickname}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="備註（選填）">
        <textarea name="note" maxLength={200} rows={2} defaultValue={values.note} className={cx(inputClass, "h-auto py-2.5")} />
      </Field>
      <p className="rounded-xl bg-canvas/70 px-3 py-2 text-xs leading-relaxed text-stone-600">
        還沒付的錢不會扣帳戶、也不會算進這個月的支出。等你真的付款時再按「記錄付款」，那時候才會變成一筆消費。
      </p>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-brand-700">{state.ok}</p>}
      <Button className="w-full" disabled={pending}>{pending ? "儲存中…" : values.id ? "儲存" : "建立預購"}</Button>
    </ActionForm>
  );
}

/** 記錄一次付款。金額自己填（訂金、尾款、分幾次都可以）。 */
export function PayPreorderForm({ id, remaining, today, accounts, categories, members, meId }: {
  id: string;
  remaining: number;
  today: string;
  accounts: Array<{ id: string; label: string }>;
  categories: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; nickname: string }>;
  meId: string;
}) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [who, setWho] = useState<"ME" | "EQUAL">("ME");
  const [occurredOn, setOccurredOn] = useState(today);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // 記錄成功後清掉金額並換一個 requestId，連按兩下不會記成兩筆
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof payPreorderAction>>, fd: FormData) => {
    const r = await payPreorderAction(prev, fd);
    if (r?.ok) { setAmount(""); setRequestId(crypto.randomUUID()); }
    return r;
  }, undefined);
  const value = parseAmount(amount) ?? 0;

  const payload = JSON.stringify({
    amount: value,
    accountId,
    categoryId: categoryId || null,
    title: "預購付款",
    note: "",
    occurredOn,
    split:
      who === "EQUAL" && members.length > 1
        ? { method: "EQUAL", participants: members.map((m) => ({ userId: m.userId })) }
        : { method: "FULL", participants: [{ userId: meId }] },
  });

  return (
    <ActionForm action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="payload" value={payload} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="這次付多少">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={toInputString(remaining)} aria-label="付款金額" />
        </Field>
        <Field label="日期"><DateInput value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} aria-label="付款日期" /></Field>
      </div>
      {remaining > 0 && (
        <button type="button" className="text-xs text-brand-600 underline underline-offset-2" onClick={() => setAmount(toInputString(remaining))}>
          帶入待結全額 {formatMoney(remaining)}
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="從哪個帳戶付">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="付款帳戶">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
        {/* 選填，但選了統計才不會全部落在「未分類」 */}
        <Field label="分類（選填）">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="付款分類">
            <option value="">不分類</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
      {members.length > 1 && (
        <Field label="怎麼分">
          <div className="grid grid-cols-2 rounded-2xl bg-stone-200/60 p-1">
            {([["ME", "我自己付"], ["EQUAL", "兩人平分"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setWho(k)}
                className={cx("h-10 rounded-xl text-sm font-semibold transition", who === k ? "bg-white text-stone-800 shadow-sm" : "text-stone-500")}>
                {label}
              </button>
            ))}
          </div>
        </Field>
      )}
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-brand-700" role="status">{state.ok}</p>}
      <Button className="w-full" disabled={pending || value <= 0 || !accountId}>{pending ? "記錄中…" : "記錄這次付款"}</Button>
    </ActionForm>
  );
}

export function CancelPreorderButton({ id, cancelled }: { id: string; cancelled: boolean }) {
  const [state, action, pending] = useActionState(cancelPreorderAction, undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!cancelled && !confirm("取消這張預購？已經付出去的錢不會被動到，如果實際有退款請到那筆付款走退款。")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="cancel" value={String(!cancelled)} />
      <Button variant="secondary" className="w-full" disabled={pending}>{cancelled ? "恢復這張預購" : "取消這張預購"}</Button>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}

export function DeletePreorderButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deletePreorderAction, undefined);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("刪除這張預購？付款紀錄會保留在記帳明細裡，只是不再屬於這張單。")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <Button variant="danger" className="w-full" disabled={pending}>刪除預購</Button>
      <ErrorText>{state?.error}</ErrorText>
    </form>
  );
}
