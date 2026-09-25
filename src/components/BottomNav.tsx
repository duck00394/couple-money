"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArtIcon } from "./ArtIcon";
import { cx } from "./ui";

/**
 * 底部導覽：首頁・任務・記帳・基金・統計。
 *
 * 這五個是「每天會用到」的：看今天要做什麼、完成任務、記一筆、看錢存到哪、看花了多少。
 * 帳戶、分類、固定支出、動態、備份、設定這些低頻管理都收在「更多」。
 * 「記帳」直接進新增頁（每天用最多的動作），明細列表在「更多 → 記帳明細」。
 */
const items = [
  { href: "/", label: "首頁", icon: "house", match: (p: string) => p === "/" },
  { href: "/tasks", label: "任務", icon: "check-circle", match: (p: string) => p.startsWith("/tasks") },
  { href: "/transactions/new", label: "記帳", icon: "pencil", match: (p: string) => p.startsWith("/transactions") },
  { href: "/funds", label: "基金", icon: "piggy-bank", match: (p: string) => p.startsWith("/funds") || p.startsWith("/goals") },
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
                <span className={cx(active ? "font-semibold text-brand-600" : "text-stone-500")}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
