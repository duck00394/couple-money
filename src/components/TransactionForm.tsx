"use client";

import { useActionState, useMemo, useState } from "react";
import { deleteTransactionAction, saveTransactionAction } from "@/app/actions/transactions";
import { formatMoney, parseAmount, toInputString } from "@/lib/money";
import { computeSplit, type SplitMethod, type SplitRule } from "@/server/domain/split";
import { DomainError } from "@/server/domain/errors";
import { Button, cx, ErrorText, Field, Input, inputClass } from "./ui";
import { ArtIcon } from "./ArtIcon";

type Member = { userId: string; nickname: string };
type AccountOpt = { id: string; name: string; type: string; ownerId: string | null; icon: string };
type CategoryOpt = { id: string; name: string; icon: string; kind: "EXPENSE" | "INCOME" };

export interface TxInitial {
  id: string;
  version: number;
  type: "EXPENSE" | "INCOME";
  amount: number;
  accountId: string;
  categoryId: string | null;
  title: string;
  note: string;
  occurredOn: string;
  split: SplitRule | null;
  fundId: string | null;
  fundAccountId: string | null;
  tags: string[];
}

const METHODS: Array<{ id: Exclude<SplitMethod, "SHARES">; label: string }> = [
  { id: "EQUAL", label: "平分" },
  { id: "RATIO", label: "比例" },
  { id: "AMOUNT", label: "金額" },
  { id: "FULL", label: "一人負擔" },
];

export function TransactionForm(props: {
  me: Member;
  partner: Member | null;
  accounts: AccountOpt[];
  categories: CategoryOpt[];
  today: string;
  initial?: TxInitial;
  returnTo?: string;
  funds?: Array<{ id: string; name: string; balance: number; isArchived: boolean }>;
  allocations?: Array<{ fundId: string; accountId: string; amount: number }>;
  defaultFundId?: string | null;
  defaultAccountId?: string | null;
}) {
  const { me, partner, accounts, categories, today, initial } = props;
  const members = partner ? [me, partner] : [me];
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<"EXPENSE" | "INCOME">(initial?.type ?? "EXPENSE");
  const [amountStr, setAmountStr] = useState(initial ? toInputString(initial.amount) : "");
  const [accountId, setAccountId] = useState(
    initial?.accountId ?? props.defaultAccountId ?? accounts.find((a) => a.ownerId === me.userId)?.id ?? accounts[0]?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [tagText, setTagText] = useState((initial?.tags ?? []).map((t) => `#${t}`).join(" "));
  const [date, setDate] = useState(initial?.occurredOn ?? today);
  const [fundId, setFundId] = useState<string>(initial?.fundId ?? props.defaultFundId ?? "");
  const [fundAccountId, setFundAccountId] = useState<string>(initial?.fundAccountId ?? "");

  const init = initial?.split;
  const initMethod = init && init.method !== "SHARES" ? init.method : "EQUAL";
  const [method, setMethod] = useState<Exclude<SplitMethod, "SHARES">>(partner ? initMethod : "FULL");
  const [myRatio, setMyRatio] = useState(
    init?.method === "RATIO" ? String(init.participants.find((p) => p.userId === me.userId)?.value ?? 50) : "50",
  );
  const [myAmountStr, setMyAmountStr] = useState(
    init?.method === "AMOUNT" ? toInputString(init.participants.find((p) => p.userId === me.userId)?.value ?? 0) : "",
  );
  const [fullUser, setFullUser] = useState(
    init?.method === "FULL" ? init.participants[0]?.userId ?? me.userId : me.userId,
  );

  const amount = parseAmount(amountStr);
  const account = accounts.find((a) => a.id === accountId);
  const isShared = account?.ownerId === null;

  const rule: SplitRule = useMemo(() => {
    if (!partner) return { method: "FULL", participants: [{ userId: me.userId }] };
    switch (method) {
      case "EQUAL":
        return { method, participants: members.map((m) => ({ userId: m.userId })) };
      case "RATIO": {
        const r = Number(myRatio);
        return { method, participants: [{ userId: me.userId, value: r }, { userId: partner.userId, value: Math.round((100 - r) * 100) / 100 }] };
      }
      case "AMOUNT": {
        const mine = parseAmount(myAmountStr) ?? 0;
        return { method, participants: [{ userId: me.userId, value: mine }, { userId: partner.userId, value: (amount ?? 0) - mine }] };
      }
      case "FULL":
        return { method, participants: [{ userId: fullUser }] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, myRatio, myAmountStr, fullUser, amount, partner?.userId, me.userId]);

  const preview = useMemo(() => {
    if (!amount) return { lines: null, error: null };
    try {
      return { lines: computeSplit(amount, rule), error: null };
    } catch (e) {
      return { lines: null, error: e instanceof DomainError ? e.message : "分帳設定不正確" };
    }
  }, [amount, rule]);

  const [state, action, pending] = useActionState(saveTransactionAction, undefined);
  const [delState, delAction, deleting] = useActionState(deleteTransactionAction, undefined);

  const payload = JSON.stringify({
    type,
    amount: amount ?? 0,
    accountId,
    categoryId,
    title,
    note,
    tags: tagText.split(/[,，、\s]+/).map((t) => t.replace(/^#+/, "").trim()).filter(Boolean),
    occurredOn: date,
    split: rule,
    clientRequestId,
    fundId: type === "EXPENSE" && fundId ? fundId : null,
    fundAccountId: type === "EXPENSE" && fundId && fundAccountId ? fundAccountId : null,
    id: initial?.id,
    version: initial?.version,
  });

  const shareOf = (uid: string) => preview.lines?.find((l) => l.userId === uid)?.amount ?? 0;
  const effect = (() => {
    if (!partner || !preview.lines || !account || type !== "EXPENSE") return null;
    if (isShared) return "共同帳戶支付，不影響誰欠誰";
    const payer = account.ownerId;
    const other = payer === me.userId ? partner : me;
    const owe = shareOf(other.userId);
    if (owe === 0) return "這筆不會產生欠款";
    return payer === me.userId ? `${partner.nickname} 要還你 ${formatMoney(owe)}` : `你要還 ${partner.nickname} ${formatMoney(owe)}`;
  })();

  const cats = categories.filter((c) => c.kind === type);
  const grouped = [
    { label: "我的", items: accounts.filter((a) => a.ownerId === me.userId) },
    ...(partner ? [{ label: partner.nickname, items: accounts.filter((a) => a.ownerId === partner.userId) }] : []),
    { label: "共同", items: accounts.filter((a) => a.ownerId === null) },
  ].filter((g) => g.items.length > 0);

  const canSubmit = !!amount && !!accountId && !preview.error && !pending && (!fundId || !!fundAccountId);

  return (
    <div className="pb-submit-bar px-4">
      <form action={action} className="space-y-5">
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="returnTo" value={props.returnTo ?? ""} />

        <div className="grid grid-cols-2 rounded-2xl bg-stone-200/60 p-1">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setCategoryId(null);
                if (t === "INCOME") setMethod("FULL");
              }}
              className={cx(
                "h-10 rounded-xl text-sm font-semibold transition",
                type === t ? "bg-white text-stone-800 shadow-sm" : "text-stone-500",
              )}
            >
              {t === "EXPENSE" ? "支出" : "收入"}
            </button>
          ))}
        </div>

        <div className="rounded-3xl bg-white px-5 py-4 shadow-xs ring-1 ring-line/70 ring-1 ring-brand-100">
          <span className="text-xs font-medium text-stone-500">金額</span>
          <div className="flex items-center gap-1.5">
            <span className="text-3xl font-bold text-brand-400">$</span>
            <input
              aria-label="金額"
              name="amountDisplay"
              inputMode="decimal"
              autoFocus={!initial}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0"
              className="amount-lg w-full bg-transparent text-5xl text-stone-800 outline-none placeholder:text-stone-300"
            />
          </div>
          {amountStr && !amount && <p className="mt-1 text-xs text-red-600">請輸入正確金額（最多兩位小數）</p>}
        </div>

        {/* 數字鍵盤：直接寫進上面同一個 amountStr，鍵盤與輸入框永遠一致 */}
        <div className="grid grid-cols-3 gap-2" data-testid="amount-keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((k) => (
            <button
              key={k}
              type="button"
              aria-label={k === "del" ? "刪除一個字" : k}
              onClick={() =>
                setAmountStr((v) =>
                  k === "del" ? v.slice(0, -1)
                  : k === "." ? (v.includes(".") ? v : (v || "0") + ".")
                  : (v + k).replace(/^0(?=\d)/, ""),
                )
              }
              className="press flex h-12 items-center justify-center rounded-xl border-[1.5px] border-stone-800 bg-brand-100 text-xl font-extrabold text-stone-800 shadow-xs active:translate-y-px active:shadow-none"
            >
              {k === "del" ? <ArtIcon name="undo" size={20} /> : k}
            </button>
          ))}
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-600">分類</p>
          <div className="grid grid-cols-5 gap-2">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}
                className={cx(
                  "press flex flex-col items-center gap-0.5 rounded-2xl py-2.5 text-xs shadow-xs",
                  categoryId === c.id ? "bg-brand-100 font-semibold text-brand-700 ring-2 ring-brand-500" : "bg-white text-stone-600",
                )}
              >
                <ArtIcon name={c.icon} size={20} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="名稱（選填）">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={50} placeholder={cats.find((c) => c.id === categoryId)?.name ?? "例如：晚餐"} />
          </Field>
          <Field label="日期">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-[9.5rem]" />
          </Field>
        </div>

        <Field label={type === "EXPENSE" ? "誰付的／用哪個帳戶" : "存入哪個帳戶"}>
          <select aria-label="帳戶" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cx(inputClass, "appearance-none")}>
            {grouped.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((a) => (
                  <option key={a.id} value={a.id}>
                    {g.label === "共同" ? "" : `${g.label}・`}{a.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {type === "EXPENSE" && (props.funds?.length ?? 0) > 0 && (
          <div>
            <Field label="從基金扣（選填）">
              <select aria-label="從基金扣" value={fundId} onChange={(e) => { setFundId(e.target.value); setFundAccountId(""); }} className={cx(inputClass, "appearance-none")}>
                <option value="">不從基金扣</option>
                {props.funds!.filter((f) => !f.isArchived || f.id === initial?.fundId).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}（剩 {formatMoney(f.balance)}）</option>
                ))}
              </select>
            </Field>
            {fundId && (() => {
              const f = props.funds!.find((x) => x.id === fundId);
              const editingSame = initial?.fundId === fundId;
              // 各帳戶的額度；編輯既有連結時，原本那筆已經扣過，要加回來
              const alloc = new Map<string, number>();
              for (const x of props.allocations ?? []) if (x.fundId === fundId) alloc.set(x.accountId, x.amount);
              if (editingSame && initial?.fundAccountId) alloc.set(initial.fundAccountId, (alloc.get(initial.fundAccountId) ?? 0) + initial.amount);
              const available = [...alloc.values()].reduce((a, b) => a + b, 0);
              const need = amount ?? 0;
              // 產品規則：一定要自己選「動用哪個帳戶的額度」，系統不會自動挑
              const used = fundAccountId || null;
              // 付款帳戶排最前面，最常見的選擇一眼就看得到
              const sources = [...alloc].sort((x, y) => Number(y[0] === account?.id) - Number(x[0] === account?.id) || y[1] - x[1]);
              const accName = (id: string | null) => {
                const acc = accounts.find((x) => x.id === id);
                if (!acc) return "";
                const owner = acc.ownerId === null ? "共同" : acc.ownerId === me.userId ? "我" : partner?.nickname ?? "";
                return `${owner}・${acc.name}`;
              };
              return (
                <div className="mt-2 space-y-2 rounded-2xl bg-white p-3 text-xs shadow-sm" data-testid="fund-hint">
                  <p className="font-semibold text-stone-700">這筆會怎麼記？（不會扣兩次）</p>
                  <ul className="space-y-1 text-stone-600">
                    <li><b>實際付款</b>：「{accName(accountId)}」扣 {formatMoney(need)}，帳戶只扣這一次</li>
                    <li><b>基金用途</b>：「{f?.name}」實際金額 −{formatMoney(need)}（動用「{accName(used) || "—"}」裡指定給基金的額度，那個帳戶的錢不會再扣一次）</li>
                    <li><b>分帳</b>：{account?.ownerId === null ? "共同帳戶付款，不產生欠款" : "照下方設定計算，另一半應負擔的部分會算成欠款"}</li>
                  </ul>
                  <label className="block">
                    <span className="mb-1 block text-stone-500">動用哪個帳戶的基金額度（必選）</span>
                    <select aria-label="基金動用來源" value={fundAccountId} onChange={(e) => setFundAccountId(e.target.value)} className={cx(inputClass, "h-10 appearance-none text-sm")}>
                      <option value="">請選擇</option>
                      {sources.map(([id, v]) => (
                        <option key={id} value={id} disabled={need > v}>
                          {accName(id)}（額度 {formatMoney(v)}{id === account?.id ? "・付款帳戶" : ""}{need > v ? "・不夠" : ""}）
                        </option>
                      ))}
                    </select>
                  </label>
                  {need > available && <p className="text-red-600">基金實際金額只有 {formatMoney(available)}，不夠這筆支出（尚未入金的獎金不能拿來付款）。</p>}
                  {need <= available && !used && <p className="text-amber-700">請選擇要動用哪個帳戶裡指定給這個基金的額度。</p>}
                  {account && account.ownerId !== null && partner && (
                    <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800" data-testid="fund-personal-warning">
                      用個人帳戶付：欠款照常產生。之後如果由共同帳戶把錢還給付款的人，再記一筆帳戶間轉帳即可。
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {partner && (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-medium text-stone-600">怎麼分</p>
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-stone-100 p-1">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cx("h-9 rounded-xl text-sm transition", method === m.id ? "bg-white font-semibold text-stone-800 shadow-sm" : "text-stone-500")}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-3">
              {method === "RATIO" && (
                <div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Number(myRatio) || 0}
                    onChange={(e) => setMyRatio(e.target.value)}
                    className="w-full accent-brand-500"
                    aria-label="我的比例"
                  />
                  <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                    <label className="flex items-center gap-1">
                      我
                      <input
                        aria-label="我的百分比"
                        inputMode="decimal"
                        value={myRatio}
                        onChange={(e) => setMyRatio(e.target.value.replace(/[^\d.]/g, ""))}
                        className="h-9 w-16 rounded-lg border border-stone-200 text-center"
                      />
                      %
                    </label>
                    <span>{partner.nickname} {Math.round((100 - Number(myRatio || 0)) * 100) / 100}%</span>
                  </div>
                </div>
              )}
              {method === "AMOUNT" && (
                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    我 $
                    <input
                      aria-label="我負擔的金額"
                      inputMode="decimal"
                      value={myAmountStr}
                      onChange={(e) => setMyAmountStr(e.target.value.replace(/[^\d.,]/g, ""))}
                      className="h-9 w-24 rounded-lg border border-stone-200 text-center"
                      placeholder="0"
                    />
                  </label>
                  <span>{partner.nickname} {formatMoney(Math.max(0, (amount ?? 0) - (parseAmount(myAmountStr) ?? 0)))}</span>
                </div>
              )}
              {method === "FULL" && (
                <div className="grid grid-cols-2 gap-2">
                  {members.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => setFullUser(m.userId)}
                      className={cx("h-10 rounded-lg text-sm", fullUser === m.userId ? "bg-brand-100 font-semibold text-brand-700 ring-2 ring-brand-500" : "bg-stone-100")}
                    >
                      全部由{m.userId === me.userId ? "我" : m.nickname}負擔
                    </button>
                  ))}
                </div>
              )}
            </div>

            {preview.error && amount && <p className="mt-3 text-sm text-red-600">{preview.error}</p>}
            {preview.lines && (
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                {members.map((m) => (
                  <div key={m.userId} className="flex justify-between">
                    <span className="text-stone-500">{m.userId === me.userId ? "我" : m.nickname}負擔</span>
                    <span className="tnum font-medium">{formatMoney(shareOf(m.userId))}</span>
                  </div>
                ))}
                {effect && <p className="pt-1 font-semibold text-brand-700" data-testid="split-effect">{effect}</p>}
              </div>
            )}
          </div>
        )}

        {/* 不常用的欄位收在次要區塊，讓「金額 → 分類 → 帳戶」這條主線最短 */}
        <div className="space-y-4 rounded-2xl bg-stone-100/70 p-3.5">
          <p className="text-xs font-semibold text-stone-500">其他（選填）</p>
          <Field label="標籤（選填）" hint="用空白分隔，例如：#約會 #日本旅行">
            <Input aria-label="標籤" value={tagText} onChange={(e) => setTagText(e.target.value)} maxLength={200} placeholder="#約會" />
          </Field>
          <Field label="備註（選填）">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={cx(inputClass, "h-auto py-2.5")} />
          </Field>
        </div>

        <ErrorText>{state?.error}</ErrorText>

        <div className="sticky-submit-bar">
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {pending ? "儲存中…" : initial ? "儲存修改" : "記下來"}
          </Button>
        </div>
      </form>

      {initial && (
        <form
          action={delAction}
          className="mt-6"
          onSubmit={(e) => {
            if (!confirm("確定要刪除這筆紀錄嗎？")) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={initial.id} />
          <ErrorText>{delState?.error}</ErrorText>
          <Button type="submit" variant="danger" className="mt-2 w-full" disabled={deleting}>
            {deleting ? "刪除中…" : "刪除這筆紀錄"}
          </Button>
        </form>
      )}
    </div>
  );
}
