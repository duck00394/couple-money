"use client";

/**
 * 試用模式的「更多」。
 *
 * 這一頁同時扮演「試用模式的邊界說明」：誠實列出哪些畫面沒有進試用模式，
 * 以免朋友以為功能壞了。
 */
import Link from "next/link";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { ArtIcon } from "@/components/ArtIcon";
import { useDemo } from "@/demo/store";

const IN_DEMO = [
  { href: "/demo", label: "首頁", icon: "house" },
  { href: "/demo/transactions", label: "記帳明細", icon: "transaction" },
  { href: "/demo/transactions/new", label: "記一筆", icon: "pencil" },
  { href: "/demo/accounts", label: "帳戶", icon: "wallet" },
  { href: "/demo/funds", label: "基金", icon: "piggy-bank" },
  { href: "/demo/tasks", label: "任務與獎勵", icon: "check-circle" },
  { href: "/demo/stats", label: "統計", icon: "stats" },
  { href: "/demo/settle", label: "欠款與結算", icon: "settle" },
  { href: "/demo/preorders", label: "預購", icon: "package" },
  { href: "/demo/purchases", label: "購買紀錄", icon: "sparkles" },
];

const NOT_IN_DEMO = ["分類管理", "固定支出", "預算", "動態紀錄", "收據照片", "匯出備份", "邀請另一半", "帳本設定"];

export default function DemoMorePage() {
  const { reset, state } = useDemo();

  return (
    <>
      <PageHeader title="更多" back="/demo" />
      <div className="px-4">
        <SectionTitle>試用模式可以操作的</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {IN_DEMO.map((m) => (
            <Link key={m.href} href={m.href} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50">
              <ArtIcon name={m.icon} size={18} />
              <span className="flex-1 text-[15px] text-stone-800">{m.label}</span>
              <span className="text-stone-400">›</span>
            </Link>
          ))}
        </Card>

        <SectionTitle>試用模式沒有做的</SectionTitle>
        <Card className="px-4 py-3.5">
          <p className="text-xs leading-relaxed text-stone-600">
            {NOT_IN_DEMO.join("、")}。
          </p>
          <p className="mt-2 text-xs leading-relaxed text-stone-500">
            這些是「用久了才需要」的管理功能，放進試用反而讓人找不到重點。
            登入正式帳戶就全部都在。
          </p>
        </Card>

        <SectionTitle>試用資料</SectionTitle>
        <Card className="space-y-3">
          <p className="text-xs leading-relaxed text-stone-600">
            目前有 {state.txs.length} 筆交易、{state.accounts.length} 個帳戶、
            {state.funds.length} 個基金、{state.tasks.length} 個任務、
            {state.preorders.length} 筆預購、{state.purchaseEntries.length} 筆購買紀錄。
            <br />
            全部只存在這個瀏覽器分頁的記憶體裡，<b className="text-stone-700">沒有寫進任何資料庫</b>。
          </p>
          <button
            type="button"
            onClick={reset}
            className="press w-full rounded-full border-[1.5px] border-stone-800 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-md"
            data-testid="demo-reset-more"
          >
            重置試用資料
          </button>
          <Link
            href="/login"
            className="press block w-full rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-md"
          >
            登入正式帳戶
          </Link>
        </Card>
      </div>
    </>
  );
}
