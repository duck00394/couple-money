"use client";

import Link from "next/link";
import { useState } from "react";
import { SEARCH_KIND_LABEL, SEARCH_KINDS, type TransactionFilter } from "@/server/domain/search";
import { ArtIcon } from "./ArtIcon";
import { Button, Field, Input, Select, cx } from "./ui";

type Opt = { id: string; name: string };

/** 記帳頁的篩選：手機上用底部抽屜，送出後變成網址參數（可以分享、重新整理不會消失）。 */
export function FilterSheet({ filter, activeCount, options }: {
  filter: TransactionFilter;
  activeCount: number;
  options: { categories: Array<Opt & { kind: string }>; accounts: Opt[]; funds: Opt[]; tags: string[]; people: Opt[] };
}) {
  const [open, setOpen] = useState(false);
  const money = (v: number | null) => (v === null ? "" : String(v / 100));
  return (
    <>
      <form action="/transactions" className="flex gap-2" role="search">
        {/* 保留目前其他條件，只改關鍵字 */}
        {(["from", "to", "kind", "categoryId", "person", "accountId", "fundId", "tag", "min", "max"] as const).map((k) => {
          const name = { categoryId: "category", accountId: "account", fundId: "fund" }[k as string] ?? k;
          const v = filter[k];
          return v === null ? null : <input key={k} type="hidden" name={name} value={k === "min" || k === "max" ? money(v as number) : String(v)} />;
        })}
        <Input name="q" type="search" defaultValue={filter.q ?? ""} placeholder="搜尋名稱、備註、分類、標籤…" aria-label="搜尋關鍵字" className="h-11" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cx("press relative h-11 shrink-0 rounded-xl px-3 text-sm font-semibold shadow-sm", activeCount ? "bg-brand-200 text-stone-800" : "bg-white text-stone-600")}
          aria-label="開啟篩選"
        >
          篩選{activeCount > 0 && `（${activeCount}）`}
        </button>
      </form>

      {open && (
        <div className="fade fixed inset-0 z-40 mx-auto flex max-w-md items-end bg-stone-900/35 backdrop-blur-[2px]" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="篩選條件">
          <form
            action="/transactions"
            /* 送出後頁面會帶著新的條件重新渲染（父層以條件當 key 重建），抽屜自然關閉 */
            onClick={(e) => e.stopPropagation()}
            className="rise pb-safe max-h-[88dvh] w-full space-y-3 overflow-y-auto rounded-t-3xl bg-canvas p-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">篩選</h2>
              <button type="button" onClick={() => setOpen(false)} className="h-9 w-9 rounded-full text-xl text-stone-500" aria-label="關閉篩選"><ArtIcon name="close" size={18} className="mx-auto" /></button>
            </div>
            <Field label="關鍵字"><Input name="q" defaultValue={filter.q ?? ""} aria-label="篩選關鍵字" /></Field>
            <Field label="類型">
              <Select name="kind" defaultValue={filter.kind ?? ""} aria-label="篩選類型">
                <option value="">全部</option>
                {SEARCH_KINDS.map((k) => <option key={k} value={k}>{SEARCH_KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="開始日期"><Input name="from" type="date" defaultValue={filter.from ?? ""} aria-label="開始日期" /></Field>
              <Field label="結束日期"><Input name="to" type="date" defaultValue={filter.to ?? ""} aria-label="結束日期" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="最低金額"><Input name="min" inputMode="decimal" defaultValue={money(filter.min)} placeholder="0" aria-label="最低金額" /></Field>
              <Field label="最高金額"><Input name="max" inputMode="decimal" defaultValue={money(filter.max)} placeholder="不限" aria-label="最高金額" /></Field>
            </div>
            <Field label="分類">
              <Select name="category" defaultValue={filter.categoryId ?? ""} aria-label="篩選分類">
                <option value="">全部</option>
                <optgroup label="支出">{options.categories.filter((c) => c.kind === "EXPENSE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                <optgroup label="收入">{options.categories.filter((c) => c.kind === "INCOME").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="付款／收款人">
                <Select name="person" defaultValue={filter.person ?? ""} aria-label="篩選付款人">
                  <option value="">全部</option>
                  {options.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="帳戶">
                <Select name="account" defaultValue={filter.accountId ?? ""} aria-label="篩選帳戶">
                  <option value="">全部</option>
                  {options.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="基金">
                <Select name="fund" defaultValue={filter.fundId ?? ""} aria-label="篩選基金">
                  <option value="">全部</option>
                  {options.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </Field>
              <Field label="標籤">
                <Select name="tag" defaultValue={filter.tag ?? ""} aria-label="篩選標籤">
                  <option value="">{options.tags.length ? "全部" : "還沒有標籤"}</option>
                  {options.tags.map((t) => <option key={t} value={t}>#{t}</option>)}
                </Select>
              </Field>
            </div>
            {/* 手機上欄位較多要捲動，按鈕固定在抽屜底部，不用捲到最下面才按得到 */}
            <div className="sticky bottom-0 -mx-4 -mb-4 grid grid-cols-2 gap-3 bg-canvas px-4 pb-4 pt-3">
              <Link href="/transactions" className="flex h-12 items-center justify-center rounded-xl bg-stone-200 font-semibold text-stone-700">清除篩選</Link>
              <Button type="submit">套用</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
