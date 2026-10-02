import type { Metadata } from "next";
import { BottomNav } from "@/components/BottomNav";
import { DemoProvider } from "@/demo/store";
import { DemoBadge } from "@/components/DemoBadge";

/**
 * 試用模式的外殼。
 *
 * **刻意沒有 `getAppContext()`。** 正式的 (app) layout 第一行就是它（未登入 → /login），
 * 試用模式整個繞過登入，也因此繞過 Prisma：這一層底下沒有任何 server 端資料讀取。
 *
 * 裡面的每一頁都是 Client Component，資料來源是 `useDemo()` 的記憶體 state。
 * 沒有 server action 可以呼叫 —— 不是「用 if 擋住」，是結構上沒有那條路。
 */
export const metadata: Metadata = {
  title: "試用看看 ・ Couple Money",
  // 試用頁不希望被搜尋引擎收錄
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <DemoProvider>
      <DemoBadge />
      <main className="pb-24">{children}</main>
      <BottomNav base="/demo" />
    </DemoProvider>
  );
}
