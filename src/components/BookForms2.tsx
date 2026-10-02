"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { closeBookAction, createBookAction2, reopenBookAction } from "@/app/actions/books";
import { deleteBookAction, updateBookAction2 } from "@/app/actions/bookEdit";
import { ActionForm } from "./ActionForm";
import { Button, Card, DateInput, ErrorText, Field, Input, Select, cx } from "./ui";
import { CURRENCIES } from "@/lib/currency";
import { basePerUnit, parseRatePair } from "@/server/domain/exchange";

/**
 * 新增帳本。
 *
 * 旅遊帳本可以填起訖日與幣別；自訂帳本就只有名字。
 * 幣別預設沿用原帳本 —— 絕大多數情況不用動它。
 */
export function NewBookForm({ baseCurrency }: { baseCurrency: string }) {
  const [state, action, pending] = useActionState(createBookAction2, undefined);
  const [type, setType] = useState<"TRIP" | "CUSTOM">("TRIP");
  // 選了外幣就在這一頁直接填匯率，不用再跑一趟設定頁
  const [currency, setCurrency] = useState(baseCurrency);
  const [rateText, setRateText] = useState("");
  const foreign = currency !== "TWD";
  // 打字的同時就把那句話寫出來，確認方向沒有填反（0.21 還是 4.76）
  const ratePair = parseRatePair(rateText, "TWD");
  const ratePreview = ratePair ? `1 ${currency} ≈ ${basePerUnit(ratePair, "TWD")} TWD` : null;

  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="帳本類型">
        <div className="grid grid-cols-2 gap-2">
          {([["TRIP", "旅遊"], ["CUSTOM", "自訂"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setType(v)}
              className={cx(
                "press rounded-2xl border-[1.5px] py-3 text-[15px] font-semibold transition-colors",
                type === v ? "border-stone-800 bg-brand-500 text-white shadow-md" : "border-line bg-white text-stone-600",
              )}
              aria-pressed={type === v}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <input type="hidden" name="type" value={type} />

      <Field label="帳本名稱">
        <Input name="name" required maxLength={30} placeholder={type === "TRIP" ? "例如：日本旅遊" : "例如：裝修"} autoFocus />
      </Field>

      {type === "TRIP" && (
        <>
          <Field label="開始日期" hint="可以不填">
            <DateInput name="startOn" />
          </Field>
          <Field label="結束日期" hint="可以不填">
            <DateInput name="endOn" />
          </Field>
        </>
      )}

      <Field
        label={type === "TRIP" ? "旅行地區／幣別" : "本位幣"}
        hint={type === "TRIP" ? "這趟旅行用當地幣別記帳，統計與結算也用它" : "這本帳本的統計與結算用哪個幣別"}
      >
        <Select name="baseCurrency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>{c.code}・{c.name}</option>
          ))}
        </Select>
      </Field>

      {foreign && (
        <Field label="匯率" hint={`1 ${currency} 大約多少台幣，小數最多六位。之後在首頁隨時可以改`}>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-stone-600">1 {currency} =</span>
            <Input
              name="homeRateValue"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              placeholder="0"
              className="flex-1 text-center"
              aria-label="台幣金額"
            />
            <span className="shrink-0 text-sm font-semibold text-stone-600">TWD</span>
          </div>
          {ratePreview && (
            <p className="mt-1.5 text-xs text-stone-500" data-testid="new-book-rate-preview">{ratePreview}</p>
          )}
        </Field>
      )}

      <Field label="備註" hint="可以不填">
        <Input name="note" maxLength={200} placeholder="例如：和朋友一起" />
      </Field>

      <ErrorText>{state?.error}</ErrorText>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "建立中…" : "建立並切換過去"}
      </Button>
      <p className="text-center text-xs leading-relaxed text-stone-500">
        建立後會直接切換到這本帳本，之後記帳都會記進去。<br />
        兩個人都會自動是成員，不用重新邀請。
      </p>
    </ActionForm>
  );
}

/** 結案按鈕（含確認）。原帳本不會顯示這顆。 */
export function CloseBookButton({ name }: { name: string }) {
  const [state, action, pending] = useActionState(closeBookAction, undefined);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="space-y-2">
        <ErrorText>{state?.error}</ErrorText>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="press w-full rounded-full border-[1.5px] border-stone-800 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-md"
          data-testid="close-book"
        >
          結案這本帳本
        </button>
      </div>
    );
  }

  return (
    <Card className="space-y-3 bg-orange-50">
      <p className="text-sm font-bold text-stone-800">確定結案「{name}」？</p>
      <p className="text-xs leading-relaxed text-stone-600">
        結案後這本帳本會移到<b>歷史紀錄</b>，<b className="text-stone-800">不會刪除任何資料</b>。
        之後仍然可以查看交易、統計與分帳，但不會出現在目前使用中的帳本裡，也不能再新增紀錄。
        <br />
        需要的話隨時可以「重新開啟」。
      </p>
      <ErrorText>{state?.error}</ErrorText>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="press flex-1 rounded-full border-[1.5px] border-line bg-white px-4 py-2.5 text-sm font-semibold text-stone-600"
        >
          取消
        </button>
        <ActionForm action={action} className="flex-1">
          <Button type="submit" className="w-full" disabled={pending} data-testid="close-book-confirm">
            {pending ? "結案中…" : "結案"}
          </Button>
        </ActionForm>
      </div>
    </Card>
  );
}

/** 重新開啟。會自動切換成目前帳本，所以按鈕上就要講清楚。 */
export function ReopenBookButton({ bookId, name }: { bookId: string; name: string }) {
  const [state, action, pending] = useActionState(reopenBookAction, undefined);
  return (
    <div className="space-y-1.5">
      <ActionForm action={action}>
        <input type="hidden" name="bookId" value={bookId} />
        <Button type="submit" className="w-full" disabled={pending} data-testid="reopen-book">
          {pending ? "開啟中…" : "重新開啟"}
        </Button>
      </ActionForm>
      <ErrorText>{state?.error}</ErrorText>
      <p className="text-center text-xs text-stone-500">
        重新開啟後「{name}」會回到使用中的帳本，並<b>直接切換過去</b>。
      </p>
    </div>
  );
}

/** 已結案帳本的橫幅：講清楚為什麼記不了帳，並給一條出路。 */
export function ClosedBookBanner({ bookId, name }: { bookId: string; name: string }) {
  return (
    <div className="mb-3 rounded-2xl border-[1.5px] border-stone-800 bg-stone-100 px-3.5 py-3" data-testid="closed-banner">
      <p className="text-sm font-bold text-stone-800">這本帳本已結案</p>
      <p className="mt-1 text-xs leading-relaxed text-stone-600">
        「{name}」在歷史紀錄裡，可以查看但不能新增或修改紀錄。
      </p>
      <div className="mt-2.5">
        <ReopenBookButton bookId={bookId} name={name} />
      </div>
    </div>
  );
}

/** 目前不在原帳本時，購買紀錄頁要講清楚它屬於原帳本（規格點 10）。 */
export function MainBookNotice({ activeBookName }: { activeBookName: string }) {
  return (
    <div className="mb-3 rounded-2xl border-[1.5px] border-brand-500 bg-brand-50 px-3.5 py-3" data-testid="main-book-notice">
      <p className="text-sm font-bold text-brand-700">購買紀錄屬於「原帳本」</p>
      <p className="mt-1 text-xs leading-relaxed text-stone-600">
        你目前在「{activeBookName}」，但收藏是長期的東西，所以不跟著旅遊帳本走。
        在這裡新增的購買紀錄都會記在原帳本，<b className="text-stone-700">離開這一頁之後仍然回到「{activeBookName}」</b>。
      </p>
      <Link href="/" className="mt-2 inline-block text-xs font-semibold text-brand-600">
        回「{activeBookName}」首頁 →
      </Link>
    </div>
  );
}

/**
 * 編輯帳本：名稱、起訖日、備註、換回台幣的參考匯率。
 *
 * 匯率刻意放在這裡而不是設定頁 —— 建旅遊帳本的當下就是你查匯率的時候，
 * 沒必要再跑一趟設定。寫法也維持人看得懂的「100 JPY = 21.5 TWD」。
 */
export function EditBookForm({
  name, startOn, endOn, note, baseCurrency, homeRate,
}: {
  name: string;
  startOn: string | null;
  endOn: string | null;
  note: string | null;
  baseCurrency: string;
  homeRate: { units: number; minor: number } | null;
}) {
  const [state, action, pending] = useActionState(updateBookAction2, undefined);
  const isHome = baseCurrency === "TWD";

  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="帳本名稱">
        <Input name="name" required maxLength={30} defaultValue={name} />
      </Field>
      <Field label="開始日期" hint="可以不填">
        <DateInput name="startOn" defaultValue={startOn ?? ""} />
      </Field>
      <Field label="結束日期" hint="可以不填">
        <DateInput name="endOn" defaultValue={endOn ?? ""} />
      </Field>
      <Field label="備註" hint="可以不填">
        <Input name="note" maxLength={200} defaultValue={note ?? ""} />
      </Field>

      {!isHome && (
        <Field label="換回台幣的參考匯率" hint="只影響旁邊那行「約 NT$」，不會改到任何金額">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-stone-600">1 {baseCurrency} =</span>
            <Input
              name="homeRateValue"
              inputMode="decimal"
              defaultValue={homeRate ? basePerUnit({ foreignUnits: homeRate.units, baseMinor: homeRate.minor }, "TWD") : ""}
              placeholder="0"
              className="flex-1 text-center"
              aria-label="台幣金額"
            />
            <span className="shrink-0 text-sm font-semibold text-stone-600">TWD</span>
          </div>
        </Field>
      )}

      <ErrorText>{state?.error}</ErrorText>
      {state?.ok && <p className="text-sm font-semibold text-brand-700">{state.ok}</p>}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? "儲存中…" : "儲存"}</Button>
    </ActionForm>
  );
}

/**
 * 永久刪除帳本。
 *
 * 要把帳本名稱一字不差打進來才能按 —— 這是救不回來的操作，
 * 多一道手續比事後道歉便宜。server 端會再檢查一次，繞過表單也刪不掉。
 */
export function DeleteBookForm({ bookId, name }: { bookId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteBookAction, undefined);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-stone-400 underline-offset-2 hover:underline"
        data-testid="delete-book-open"
      >
        永久刪除這本帳本
      </button>
    );
  }

  return (
    <Card className="space-y-3 border-red-300 bg-red-50">
      <p className="text-sm font-bold text-red-700">永久刪除「{name}」</p>
      <p className="text-xs leading-relaxed text-stone-700">
        這會把這本帳本<b>連同裡面的交易、帳戶、分類、統計全部永久刪除</b>，
        <b className="text-red-700">救不回來</b>。
        <br />
        只是想收起來的話請用「結案」 —— 那不會刪任何資料，之後還能重新開啟。
      </p>
      <ActionForm action={action} className="space-y-2.5">
        <input type="hidden" name="bookId" value={bookId} />
        <Field label={`請輸入「${name}」以確認`}>
          <Input name="confirmName" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={name} data-testid="delete-book-confirm-name" autoComplete="off" />
        </Field>
        <ErrorText>{state?.error}</ErrorText>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setOpen(false); setTyped(""); }}
            className="press flex-1 rounded-full border-[1.5px] border-line bg-white px-4 py-2.5 text-sm font-semibold text-stone-600"
          >
            取消
          </button>
          <Button type="submit" variant="danger" className="flex-1" disabled={pending || typed.trim() !== name} data-testid="delete-book-confirm">
            {pending ? "刪除中…" : "永久刪除"}
          </Button>
        </div>
      </ActionForm>
    </Card>
  );
}
