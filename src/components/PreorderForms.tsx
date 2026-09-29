"use client";

import { useActionState, useState } from "react";
import { cancelPreorderAction, deletePreorderAction, payPreorderAction, savePreorderAction } from "@/app/actions/preorders";
import { formatMoney, parseAmount, toInputString } from "@/lib/money";
import { ActionForm } from "./ActionForm";
import { IconPicker } from "./EmojiPicker";
import { Button, cx, DateInput, ErrorText, Field, Input, Select, inputClass } from "./ui";
import { ArtIcon } from "./ArtIcon";
import { computeSplit, type SplitRule } from "@/server/domain/split";
import { duesFromItems, duesOf } from "@/server/domain/preorder";

const PREORDER_ICONS = ["package", "gamepad", "shirt", "smartphone", "book", "gift", "cake", "sofa", "laptop", "plane", "shopping-bag", "tag"] as const;

export interface PreorderItemValue {
  name: string;
  unitAmount: string;
  qty: string;
  /** "JOINT" = 共同 */
  ownerId: string;
}

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
  categoryId: string;
  items: PreorderItemValue[];
  /** 既有的「誰付多少」；null = 依「誰的」 */
  splitRule: SplitRule | null;
}

type SplitMode = "OWNER" | "EQUAL" | "RATIO" | "AMOUNT";

const blankItem = (): PreorderItemValue => ({ name: "", unitAmount: "", qty: "1", ownerId: "JOINT" });

/** 建立／編輯預購。金額只填「應付的」，已付多少由付款紀錄自己算。 */
export function PreorderForm({ values, members, categories, alreadyPaid = 0 }: {
  values: PreorderFormValues;
  members: Array<{ userId: string; nickname: string }>;
  categories: Array<{ id: string; name: string }>;
  /** 這張單目前已經付了多少（編輯時才有）。用來提醒「改小之後會變成超付」，不阻擋。 */
  alreadyPaid?: number;
}) {
  const [state, action, pending] = useActionState(savePreorderAction, undefined);
  const [item, setItem] = useState(values.itemAmount);
  const [ship, setShip] = useState(values.shipping);
  const [items, setItems] = useState<PreorderItemValue[]>(values.items);
  const [owner, setOwner] = useState(values.ownerId);

  // ── 明細品項：有品項時，商品金額就是它們的加總 ──
  const lineTotal = (it: PreorderItemValue) => (parseAmount(it.unitAmount) ?? 0) * (Number(it.qty) || 0);
  const itemsSum = items.reduce((a, it) => a + lineTotal(it), 0);
  const hasItems = items.length > 0;
  const goods = hasItems ? itemsSum : parseAmount(item) ?? 0;
  const total = goods + (parseAmount(ship) ?? 0);
  const setItemAt = (i: number, patch: Partial<PreorderItemValue>) =>
    setItems((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // ── 誰付多少 ──
  const initialMode: SplitMode =
    values.splitRule?.method === "EQUAL" ? "EQUAL"
    : values.splitRule?.method === "RATIO" ? "RATIO"
    : values.splitRule?.method === "AMOUNT" || values.splitRule?.method === "FULL" ? "AMOUNT"
    : "OWNER";
  const [mode, setMode] = useState<SplitMode>(initialMode);
  const firstId = members[0]?.userId ?? "";
  const valueOf = (uid: string) => values.splitRule?.participants.find((p) => p.userId === uid)?.value;
  const [ratio, setRatio] = useState(() => String(valueOf(firstId) ?? 50));
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => {
      const v = values.splitRule?.method === "AMOUNT" ? valueOf(m.userId) : undefined;
      return [m.userId, v === undefined ? "" : toInputString(v)];
    })),
  );

  /** 送出時真正存下去的分帳規則。 */
  const splitRule: SplitRule | null = (() => {
    if (members.length < 2 || mode === "OWNER" || total <= 0) return null;
    if (mode === "EQUAL") return { method: "EQUAL", participants: members.map((m) => ({ userId: m.userId })) };
    if (mode === "RATIO") {
      const r = Math.min(100, Math.max(0, Number(ratio) || 0));
      return {
        method: "RATIO",
        participants: [
          { userId: members[0].userId, value: r },
          { userId: members[1].userId, value: Math.round((100 - r) * 100) / 100 },
        ],
      };
    }
    return { method: "AMOUNT", participants: members.map((m) => ({ userId: m.userId, value: parseAmount(amounts[m.userId] ?? "") ?? 0 })) };
  })();

  /** 送出後會存進資料庫的明細品項（畫面預覽與真正儲存的是同一份資料）。 */
  const itemLines = items
    .filter((it) => (parseAmount(it.unitAmount) ?? 0) > 0)
    .map((it) => ({
      name: it.name.trim(),
      unitAmount: parseAmount(it.unitAmount) ?? 0,
      qty: Number(it.qty) || 1,
      ownerId: it.ownerId === "JOINT" ? null : it.ownerId,
    }));

  /**
   * 畫面上「每個人應負擔多少」的即時預覽。
   * 直接叫 domain 的 duesOf()，跟存進資料庫之後後端算出來的是同一個函式，
   * 所以「依『誰的』」在表單上看到的跟詳細頁看到的一定一樣。
   */
  const dues = (() => {
    if (total <= 0) return null;
    try {
      // 使用者自己設的規則（平分／比例／金額）算不出來時要擋住送出，
      // 不可以偷偷退回別的分法 —— duesOf() 為了畫面不爆掉會自動退回，這裡不能用它。
      if (splitRule) {
        const lines = computeSplit(total, splitRule);
        return lines.reduce((acc, l) => acc + l.amount, 0) === total ? lines : null;
      }
      // 「依『誰的』」走 domain，跟存進資料庫之後後端算的是同一個函式
      const m = duesOf(total, null, owner === "JOINT" ? null : owner, members.map((x) => x.userId), itemLines);
      return [...m.entries()].map(([userId, amount]) => ({ userId, amount }));
    } catch {
      return null;
    }
  })();
  const splitError = total > 0 && !dues ? "「誰付多少」目前算不出來：比例要剛好 100%、金額要剛好等於應付總額。" : null;

  /**
   * 一鍵把明細品項的「誰的」換算成金額。
   * 用的是跟「依『誰的』」同一個 domain 函式，所以按下去之後數字不會跳動——
   * 只是把同一份分法固定成金額，之後可以自己微調。
   */
  const fillFromItems = () => {
    const per = duesFromItems(itemLines, members.map((m) => m.userId), { shipping: parseAmount(ship) ?? 0 });
    setAmounts(Object.fromEntries(members.map((m) => [m.userId, toInputString(per.get(m.userId) ?? 0)])));
    setMode("AMOUNT");
  };

  const extra = JSON.stringify({
    items: items
      .filter((it) => it.name.trim() && (parseAmount(it.unitAmount) ?? 0) > 0)
      .map((it) => ({
        name: it.name.trim(),
        unitAmount: parseAmount(it.unitAmount) ?? 0,
        qty: Number(it.qty) || 1,
        ownerId: it.ownerId === "JOINT" ? null : it.ownerId,
      })),
    splitRule,
  });

  return (
    <ActionForm action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <input type="hidden" name="extra" value={extra} />
      <Field label="圖示"><IconPicker options={PREORDER_ICONS} defaultValue={values.emoji} /></Field>
      <Field label="品名"><Input name="name" required maxLength={40} defaultValue={values.name} placeholder="例如：Switch 2 主機" /></Field>
      <Field label="賣家（選填）"><Input name="seller" maxLength={40} defaultValue={values.seller} placeholder="例如：博客來" /></Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="商品金額" hint={hasItems ? "由明細品項自動加總" : undefined}>
          <Input
            name="itemAmount"
            inputMode="decimal"
            required={!hasItems}
            readOnly={hasItems}
            value={hasItems ? toInputString(itemsSum) : item}
            onChange={(e) => setItem(e.target.value)}
            placeholder="13000"
            /* read-only 是 pseudo-class，優先權比 inputClass 的 bg-white 高，才蓋得掉 */
            className="read-only:bg-stone-100 read-only:text-stone-500"
          />
        </Field>
        <Field label="運費（選填）"><Input name="shipping" inputMode="decimal" value={ship} onChange={(e) => setShip(e.target.value)} placeholder="150" /></Field>
      </div>
      {total > 0 && <p className="-mt-1 text-xs text-stone-500">應付總額 <span className="tnum font-semibold text-stone-700">{formatMoney(total)}</span></p>}
      {/* 改小到低於已付金額是合理的（降價、少買一件），所以不阻擋，但一定要講清楚會變成超付 */}
      {total > 0 && alreadyPaid > total && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800" role="alert" data-testid="preorder-overpaid-warning">
          修改後已付款金額（{formatMoney(alreadyPaid)}）會高於預購總額 {formatMoney(total)}，
          多出 {formatMoney(alreadyPaid - total)}。若實際會收到退款，請另外到付款紀錄建立退款紀錄。
        </p>
      )}

      {/* ── 明細品項：一張單裡有什麼。有品項時商品金額改成它們的加總 ── */}
      <div className="rounded-2xl bg-stone-100/70 p-3.5" data-testid="preorder-items">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-stone-500">明細品項（選填）</p>
          <button type="button" onClick={() => setItems((p) => [...p, blankItem()])} className="text-sm font-semibold text-brand-600" data-testid="add-item">
            ＋ 新增品項
          </button>
        </div>
        {!hasItems ? (
          <p className="text-xs leading-relaxed text-stone-500">
            一張單裡有好幾樣東西時可以列出來。加了品項之後，商品金額就改由品項自動加總。
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="rounded-xl bg-white p-2.5 shadow-xs" data-testid="preorder-item-row">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`品項 ${i + 1} 名稱`}
                    value={it.name}
                    maxLength={40}
                    onChange={(e) => setItemAt(i, { name: e.target.value })}
                    placeholder="例如：主機"
                    className="h-10 flex-1"
                  />
                  <button
                    type="button"
                    aria-label={`刪除品項 ${i + 1}`}
                    onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                    className="shrink-0 rounded-lg px-2 py-2 text-stone-400 active:bg-stone-100"
                  >
                    <ArtIcon name="trash" size={16} />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_4.5rem_1fr] gap-2">
                  <Input
                    aria-label={`品項 ${i + 1} 單價`}
                    inputMode="decimal"
                    value={it.unitAmount}
                    onChange={(e) => setItemAt(i, { unitAmount: e.target.value })}
                    placeholder="單價"
                    className="h-10"
                  />
                  <Input
                    aria-label={`品項 ${i + 1} 數量`}
                    inputMode="numeric"
                    value={it.qty}
                    onChange={(e) => setItemAt(i, { qty: e.target.value.replace(/[^\d]/g, "") })}
                    placeholder="1"
                    className="h-10 text-center"
                  />
                  {members.length > 1 ? (
                    <Select aria-label={`品項 ${i + 1} 誰的`} value={it.ownerId} onChange={(e) => setItemAt(i, { ownerId: e.target.value })} className="h-10">
                      <option value="JOINT">共同</option>
                      {members.map((m) => <option key={m.userId} value={m.userId}>{m.nickname}</option>)}
                    </Select>
                  ) : <div />}
                </div>
                <p className="mt-1.5 text-right text-xs text-stone-500">
                  小計 <span className="tnum font-semibold text-stone-700">{formatMoney(lineTotal(it))}</span>
                </p>
              </div>
            ))}
            <p className="text-right text-xs text-stone-500">
              品項合計 <span className="tnum font-semibold text-stone-700">{formatMoney(itemsSum)}</span>
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="預計到貨（選填）"><DateInput name="expectedOn"  defaultValue={values.expectedOn} /></Field>
        <Field label="誰的">
          <Select name="ownerId" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="JOINT">共同</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.nickname}</option>)}
          </Select>
        </Field>
      </div>

      {/* 每次付款都會自動帶這個分類，統計才不會整包落在「未分類」 */}
      <Field label="分類（選填）" hint="記錄付款時會自動帶入，之後還是可以改">
        <Select name="categoryId" defaultValue={values.categoryId} aria-label="預購分類">
          <option value="">不分類</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>

      {/* ── 誰付多少：沿用記帳那一套分帳規則，不是寫死一人一半 ── */}
      {members.length > 1 && (
        <div className="rounded-2xl bg-stone-100/70 p-3.5" data-testid="preorder-split">
          <p className="mb-2 text-xs font-semibold text-stone-500">誰付多少</p>
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-stone-200/60 p-1">
            {([["OWNER", "依「誰的」"], ["EQUAL", "平分"], ["RATIO", "比例"], ["AMOUNT", "金額"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={cx("h-10 rounded-xl text-[13px] font-semibold transition", mode === k ? "bg-white text-stone-800 shadow-sm" : "text-stone-500")}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "RATIO" && (
            <div className="mt-3">
              <Field label={`${members[0].nickname} 負擔的比例（%）`}>
                <Input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value.replace(/[^\d.]/g, ""))} aria-label="比例" />
              </Field>
              <p className="mt-1 text-xs text-stone-500">{members[1].nickname} 自動是 {Math.round((100 - (Number(ratio) || 0)) * 100) / 100}%</p>
            </div>
          )}

          {mode === "AMOUNT" && (
            <div className="mt-3 space-y-2">
              {members.map((m) => (
                <Field key={m.userId} label={`${m.nickname} 負擔`}>
                  <Input
                    inputMode="decimal"
                    aria-label={`${m.nickname} 負擔金額`}
                    value={amounts[m.userId] ?? ""}
                    onChange={(e) => setAmounts((p) => ({ ...p, [m.userId]: e.target.value }))}
                  />
                </Field>
              ))}
              {hasItems && (
                <button type="button" onClick={fillFromItems} className="text-xs text-brand-600 underline underline-offset-2" data-testid="fill-from-items">
                  依明細品項的「誰的」自動帶入金額
                </button>
              )}
            </div>
          )}

          {dues && (
            <div className="mt-3 space-y-1 border-t border-line pt-2.5 text-xs" data-testid="preorder-due-preview">
              {dues.map((l) => (
                <div key={l.userId} className="flex justify-between" data-due={l.userId}>
                  <span className="text-stone-600">{members.find((m) => m.userId === l.userId)?.nickname ?? "已離開的成員"}</span>
                  <span className="tnum font-semibold text-stone-800">{formatMoney(l.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {splitError && <p className="mt-2 text-xs text-red-600" role="alert">{splitError}</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-stone-400">
            這裡設定的是「應該由誰負擔多少」。實際每次付款要誰出錢、怎麼分，還是在記帳時決定。
          </p>
        </div>
      )}

      <Field label="備註（選填）">
        <textarea name="note" maxLength={200} rows={2} defaultValue={values.note} className={cx(inputClass, "h-auto py-2.5")} />
      </Field>
      <p className="rounded-xl bg-canvas/70 px-3 py-2 text-xs leading-relaxed text-stone-600">
        還沒付的錢不會扣帳戶、也不會算進這個月的支出。等你真的付款時再按「記錄付款」，那時候才會變成一筆消費。
      </p>
      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm text-brand-700">{state.ok}</p>}
      <Button className="w-full" disabled={pending || !!splitError}>{pending ? "儲存中…" : values.id ? "儲存" : "建立預購"}</Button>
    </ActionForm>
  );
}

/** 記錄一次付款。金額自己填（訂金、尾款、分幾次都可以）。 */
export function PayPreorderForm({ id, remaining, today, accounts, categories, defaultCategoryId, members, meId, dues }: {
  id: string;
  remaining: number;
  today: string;
  accounts: Array<{ id: string; label: string }>;
  categories: Array<{ id: string; name: string }>;
  /** 這張單的預設分類（建立預購時選的） */
  defaultCategoryId: string | null;
  members: Array<{ userId: string; nickname: string }>;
  meId: string;
  /** 這張單每個人「應負擔」多少，用來提供「依預購分法」 */
  dues: Array<{ userId: string; due: number }>;
}) {
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  const [who, setWho] = useState<"ME" | "EQUAL" | "RULE">("ME");
  const [occurredOn, setOccurredOn] = useState(today);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // 記錄成功後清掉金額並換一個 requestId，連按兩下不會記成兩筆
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof payPreorderAction>>, fd: FormData) => {
    const r = await payPreorderAction(prev, fd);
    if (r?.ok) { setAmount(""); setRequestId(crypto.randomUUID()); }
    return r;
  }, undefined);
  const value = parseAmount(amount) ?? 0;
  /** 這次付款怎麼分。「依預購分法」= 按每個人應負擔的比例分這一筆。 */
  const dueTotal = dues.reduce((a, d) => a + d.due, 0);
  const canUseRule = members.length > 1 && dueTotal > 0 && dues.some((d) => d.due > 0 && d.due < dueTotal);
  function splitOf() {
    if (who === "RULE" && canUseRule) {
      // 換成比例：AMOUNT 規則是綁在應付總額上的，套到別的金額會對不起來
      const pct = dues.map((d) => Math.round((d.due / dueTotal) * 10000) / 100);
      const fixed = pct.slice(0, -1);
      const last = Math.round((100 - fixed.reduce((a, b) => a + b, 0)) * 100) / 100;
      return { method: "RATIO", participants: dues.map((d, i) => ({ userId: d.userId, value: i === dues.length - 1 ? last : pct[i] })) };
    }
    if (who === "EQUAL" && members.length > 1) return { method: "EQUAL", participants: members.map((m) => ({ userId: m.userId })) };
    return { method: "FULL", participants: [{ userId: meId }] };
  }

  const payload = JSON.stringify({
    amount: value,
    accountId,
    categoryId: categoryId || null,
    title: "預購付款",
    note: "",
    occurredOn,
    split: splitOf(),
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
          <div className={cx("grid rounded-2xl bg-stone-200/60 p-1", canUseRule ? "grid-cols-3" : "grid-cols-2")}>
            {([["ME", "我自己付"], ["EQUAL", "兩人平分"], ...(canUseRule ? [["RULE", "依預購分法"] as const] : [])] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setWho(k as typeof who)}
                className={cx("h-10 rounded-xl text-[13px] font-semibold transition", who === k ? "bg-white text-stone-800 shadow-sm" : "text-stone-500")}>
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
