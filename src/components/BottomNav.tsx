"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArtIcon } from "./ArtIcon";
import { cx } from "./ui";

/**
 * 底部導覽：首頁・記帳・交易・預算・統計。
 *
 * 「記帳」直接進新增頁（每天用最多的動作），「交易」才是明細列表。
 * 任務、目標、基金、帳戶、分類、動態、設定都收在首頁右上角的「更多」。
 */
const items = [
  { href: "/", label: "首頁", icon: "house", match: (p: string) => p === "/" },
  { href: "/transactions/new", label: "記帳", icon: "pencil", match: (p: string) => p.startsWith("/transactions/new") || p.startsWith("/transactions/transfer") || p.startsWith("/transactions/refund") },
  { href: "/transactions", label: "交易", icon: "transaction", match: (p: string) => p === "/transactions" || /^\/transactions\/[^/]+$/.test(p) },
  { href: "/budgets", label: "預算", icon: "target", match: (p: string) => p.startsWith("/budgets") },
  { href: "/stats", label: "統計", icon: "stats", match: (p: string) => p.startsWith("/stats") },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t-2 border-stone-800 bg-white">
      <ul className="grid h-16 grid-cols-5">
        {items.map(({ href, label, icon, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-full flex-col items-center justify-center gap-1 text-[11px]"
                aria-current={active ? "page" : undefined}
              >
                <span
                  className={cx(
                    "flex h-7 w-11 items-center justify-center rounded-full border-[1.5px] transition-colors duration-200",
                    active ? "border-stone-800 bg-brand-500" : "border-transparent group-active:bg-brand-100",
                  )}
                >
                  <ArtIcon name={icon} size={19} />
                </span>
                <span className={cx(active ? "font-extrabold text-brand-600" : "text-stone-500")}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
