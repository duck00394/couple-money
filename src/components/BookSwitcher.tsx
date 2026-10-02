"use client";

import Link from "next/link";
import { useState } from "react";
import { switchBookAction } from "@/app/actions/books";
import { cx } from "./ui";
import type { BookListItem } from "@/server/services/books";

/**
 * 帳本選擇器。
 *
 * 兩件事要小心：
 *   1. 下拉選單是絕對定位的，**所以放它的容器不能 overflow-hidden** ——
 *      首頁的 hero 原本會把選單裁掉，只露出第一列，別本帳本點不到。
 *      裁切已經移到插圖那一層（見 app/(app)/page.tsx）。
 *   2. 不用 emoji。每一列只有帳本名稱，需要補充時才加一行小字
 *      （日期區間、外幣、已結案），其餘留白。
 */
export function BookSwitcher({ books, current }: { books: BookListItem[]; current: BookListItem }) {
  const [open, setOpen] = useState(false);
  const live = books.filter((b) => !b.isClosed);
  const closed = books.filter((b) => b.isClosed);

  /** 第二行小字：沒東西可講就不佔一行 */
  const sub = (b: BookListItem) => {
    const bits: string[] = [];
    if (b.startOn) bits.push(`${b.startOn.replaceAll("-", "/")}${b.endOn ? `～${b.endOn.replaceAll("-", "/")}` : ""}`);
    if (b.baseCurrency !== "TWD") bits.push(b.baseCurrency);
    if (b.isClosed) bits.push("已結案");
    return bits.join("・");
  };

  const Row = ({ b }: { b: BookListItem }) => {
    const line = sub(b);
    return (
      <form action={switchBookAction}>
        <input type="hidden" name="bookId" value={b.id} />
        <button
          type="submit"
          className="flex w-full items-center gap-2 px-4 py-3 text-left active:bg-stone-50"
          data-testid="book-option"
        >
          {/* 固定寬度的勾勾欄，讓每一列的名稱都對齊 */}
          <span className="w-3.5 shrink-0 text-center text-xs text-brand-600">{b.isActive ? "✓" : ""}</span>
          <span className="min-w-0 flex-1">
            <span className={cx("block truncate text-[15px]", b.isActive ? "font-semibold text-brand-700" : "text-stone-800")}>
              {b.name}
            </span>
            {line && <span className="block truncate text-[11px] text-stone-400">{line}</span>}
          </span>
        </button>
      </form>
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="book-switcher"
        className="press flex max-w-full items-center gap-1.5 rounded-[10px] border-2 border-stone-800 bg-brand-500 px-2.5 py-1 text-[13px] font-semibold tracking-wide text-white shadow-md"
      >
        <span className="truncate">{current.name}</span>
        <span className="shrink-0 text-[9px] leading-none opacity-80">▼</span>
      </button>

      {open && (
        <>
          {/* 點外面關掉。壓在選單下面一層，不會擋到選單本身 */}
          <button
            type="button"
            aria-label="關閉帳本選單"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            className="absolute left-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-2xl border-[1.5px] border-stone-800 bg-white shadow-lg"
            data-testid="book-menu"
          >
            <div className="divide-y divide-line">
              {live.map((b) => <Row key={b.id} b={b} />)}
            </div>

            {closed.length > 0 && (
              <>
                <p className="border-t border-line bg-stone-50 px-4 py-1.5 text-[11px] text-stone-400">歷史紀錄</p>
                <div className="divide-y divide-line">
                  {closed.map((b) => <Row key={b.id} b={b} />)}
                </div>
              </>
            )}

            <Link
              href="/books/new"
              onClick={() => setOpen(false)}
              className="block border-t-[1.5px] border-stone-800 px-4 py-2.5 text-[13px] font-semibold text-brand-600 active:bg-stone-50"
              data-testid="book-new-link"
            >
              ＋ 新增帳本
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
