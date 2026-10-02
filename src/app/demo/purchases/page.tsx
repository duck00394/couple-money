"use client";

/** 試用模式的購買紀錄首頁：先選作品（第一層）。 */
import Link from "next/link";
import { ArtTile } from "@/components/ArtIcon";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { toIconKey } from "@/lib/icons";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoPurchasesPage() {
  const { state } = useDemo();
  const groups = select.purchaseGroups(state);
  const total = select.purchaseTotal(state);

  return (
    <>
      <PageHeader title="購買紀錄" back="/demo" />
      <div className="px-4">
        <Card className="px-5 py-4" data-testid="demo-purchase-total">
          <p className="text-xs text-stone-500">全部收藏加起來</p>
          <p className="amount mt-0.5 text-[1.9rem] text-stone-800">{formatMoney(total)}</p>
          <p className="mt-1.5 text-xs text-stone-500">
            共 {state.purchaseEntries.length} 筆・{groups.length} 個作品
          </p>
        </Card>

        <SectionTitle>作品</SectionTitle>
        {groups.length === 0 ? (
          <Card quiet className="p-0">
            <Empty icon="sparkles">還沒有任何作品</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-line p-0" data-testid="demo-purchase-groups">
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`/demo/purchases/${g.id}`}
                className="flex items-center gap-3 px-4 py-3 active:bg-stone-50"
                data-testid="demo-purchase-group"
              >
                <ArtTile name={toIconKey(g.icon)} tone="brand" size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-stone-800">{g.name}</p>
                  <p className="truncate text-xs text-stone-500">{g.count} 筆</p>
                </div>
                <span className="amount shrink-0 text-[15px] text-stone-800">{formatMoney(g.total)}</span>
                <span className="shrink-0 text-stone-400">›</span>
              </Link>
            ))}
          </Card>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          購買紀錄<b className="text-stone-700">完全不參與財務計算</b>：它不產生付款或分帳，
          所以帳戶餘額與欠款看不到它。這是結構上保證的，不是靠記得。
        </p>
      </div>
    </>
  );
}
