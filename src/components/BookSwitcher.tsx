"use client";

import Link from "next/link";
import { useState } from "react";
import { switchBookAction } from "@/app/actions/books";
import { cx } from "./ui";
import type { BookListItem } from "@/server/services/books";

const TYPE_ICON: Record<string, string> = { MAIN: "🏠", TRIP: "✈️", CUSTOM: "📗" };

/**
 * 帳本選擇器。
 *
 * 規格點 26：平常就是一個小小的「日本旅遊 ▼」，點開才看到清單。
 * 使用中與歷史紀錄**分開兩區**（規格點 3）—— 已結案的帳本混在一起會讓人誤以為還能記帳。
 */
export function BookSwitcher({ books, current }: { books: BookListItem[]; current: BookListItem }) {
  const [open, setOpen] = useState(false);
  const live = books.filter((b) => !b.isClosed);
  const closed = books.filter((b) => b.isClosed);

  const Row = ({ b }: { b: BookListItem }) => (
    <form action={switchBookAction}>
      <input type="hidden" name="bookId" value={b.id} />
      <button
        type="submit"
        className={cx(
          "flex w-full items-center gap-2.5 px-4 py-3 text-left active:bg-stone-50",
          b.isActive && "bg-brand-50",
        )}
        data-testid="book-option"
      >
        <span className="w-4 shrink-0 text-center text-sm text-brand-600">{b.isActive ? "✓" : ""}</span>
        <span className="shrink-0">{TYPE_ICON[b.type] ?? "📗"}</span>
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-[15px]", b.isActive ? "font-semibold text-brand-700" : "text-stone-800")}>
            {b.name}
          </span>
          {(b.startOn || b.baseCurrency !== "TWD" || b.isClosed) && (
            <span className="block truncate text-[11px] text-stone-500">
              {b.startOn && `${b.startOn.replaceAll("-", "/")}${b.endOn ? `～${b.endOn.replaceAll("-", "/")}` : ""}`}
              {b.baseCurrency !== "TWD" && `${b.startOn ? "・" : ""}${b.baseCurrency}`}
              {b.isClosed && `${b.startOn || b.baseCurrency !== "TWD" ? "・" : ""}已結案`}
            </span>
          )}
        </span>
      </button>
    </form>
  );

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
        {current.isClosed && <span className="shrink-0 rounded bg-white/25 px-1 text-[10px]">已結案</span>}
        <span className="shrink-0 text-[10px]">▼</span>
      </button>

      {open && (
        <>
          {/* 點外面關掉。放在選單下面一層，不擋到選單本身 */}
          <button
            type="button"
            aria-label="關閉帳本選單"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-2xl border-[1.5px] border-stone-800 bg-white shadow-lg"
            data-testid="book-menu"
          >
            <p className="bg-stone-100 px-4 py-1.5 text-[11px] font-semibold text-stone-500">使用中</p>
            <div className="divide-y divide-line">
              {live.map((b) => <Row key={b.id} b={b} />)}
            </div>

            {closed.length > 0 && (
              <>
                <p className="border-t border-line bg-stone-100 px-4 py-1.5 text-[11px] font-semibold text-stone-500">
                  歷史紀錄
                </p>
                <div className="divide-y divide-line">
                  {closed.map((b) => <Row key={b.id} b={b} />)}
                </div>
              </>
            )}

            <Link
              href="/books/new"
              onClick={() => setOpen(false)}
              className="block border-t-[1.5px] border-stone-800 px-4 py-3 text-[15px] font-semibold text-brand-600 active:bg-stone-50"
              data-testid="book-new-link"
            >
              ＋ 新增帳本
            </Link>
            <Link
              href="/books"
              onClick={() => setOpen(false)}
              className="block border-t border-line px-4 py-2.5 text-xs text-stone-500 active:bg-stone-50"
            >
              管理帳本
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
