"use client";

import Link from "next/link";
import { useState } from "react";
import { useDemo } from "@/demo/store";

/**
 * 試用模式的狀態條。
 *
 * 規格點 6：要讓人清楚知道「這不是正式帳戶」，但**不要佔掉畫面**。
 * 所以做成一條 28px 的細條黏在最上面，展開才看到說明與重置。
 */
export function DemoBadge() {
  const { reset } = useDemo();
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-30 border-b-2 border-stone-800 bg-stone-800 text-white">
      <div className="mx-auto flex max-w-md items-center gap-2 px-3 py-1">
        <span className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold tracking-wide">
          試用模式
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] text-stone-300">
          資料不會儲存到正式帳戶
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-[11px] font-semibold text-brand-300 underline-offset-2 hover:underline"
          aria-expanded={open}
          data-testid="demo-badge-toggle"
        >
          {open ? "收起" : "說明"}
        </button>
      </div>

      {open && (
        <div className="mx-auto max-w-md space-y-2.5 px-3 pb-3 pt-1 text-[12px] leading-relaxed text-stone-300">
          <p>
            你現在看到的是<b className="text-white">示範資料</b>，人名、帳戶、金額全部是編造的。
            在這裡新增、修改、刪除都只存在這個瀏覽器分頁的記憶體裡，
            <b className="text-white">不會寫進任何資料庫</b>。
          </p>
          <p className="text-stone-400">
            重新整理頁面就會回到一開始的示範資料。
          </p>
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={reset}
              className="press rounded-full border-[1.5px] border-white/40 bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white"
              data-testid="demo-reset"
            >
              重置試用資料
            </button>
            <Link
              href="/login"
              className="press rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              登入正式帳戶
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
