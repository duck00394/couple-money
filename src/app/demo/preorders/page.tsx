"use client";

/**
 * 試用模式的預購頁。
 *
 * 重點是展示「每個人該付多少」怎麼算 —— 共同品項平分、有指定歸屬的算該人的。
 * 這正是 v11 修掉的那個 bug（原本不管歸屬一律平分），所以示範資料刻意放了
 * 三種組合：全共同、全個人、共同＋個人混合。
 *
 * 試用模式不做「記一筆付款」：那會牽動代墊、欠款與交易，複雜度遠高於展示需要。
 */
import Link from "next/link";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoPreordersPage() {
  const { state, todayKey } = useDemo();
  const rows = select.preorders(state);
  const pending = rows.filter((p) => p.status === "PENDING");
  const arrived = rows.filter((p) => p.status === "ARRIVED");

  const nameOf = (id: string | null) =>
    id === null ? "共同" : state.users.find((u) => u.id === id)?.nickname ?? "";

  const Row = ({ p }: { p: select.PreorderView }) => (
    <Card className="px-4 py-3.5" data-testid="demo-preorder-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-2xl">{p.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-stone-800">{p.name}</p>
          <p className="truncate text-xs text-stone-500">
            {p.seller}・預計 {p.expectedOn}
            {p.expectedOn < todayKey && p.status === "PENDING" && (
              <span className="ml-1 font-semibold text-orange-600">已過預計日</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            歸屬 {nameOf(p.ownerId)}
            {p.paidById && `・${nameOf(p.paidById)} 先代墊`}
          </p>
        </div>
        <span className="amount shrink-0 text-[15px] text-stone-800">{formatMoney(p.total)}</span>
      </div>

      {/* 品項 */}
      <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-xs">
        {p.items.map((it) => (
          <li key={it.id} className="flex justify-between gap-2">
            <span className="truncate text-stone-600">
              {it.name}
              <span className="ml-1.5 rounded bg-stone-100 px-1 py-0.5 text-[10px] text-stone-500">
                {nameOf(it.ownerId)}
              </span>
            </span>
            <span className="tnum shrink-0 text-stone-700">{formatMoney(it.amount)}</span>
          </li>
        ))}
      </ul>

      {/* 每個人該付多少 */}
      <div className="mt-2.5 border-t border-line pt-2.5">
        <p className="mb-1.5 text-[11px] font-semibold text-stone-500">每個人該付</p>
        <div className="flex gap-2">
          {p.dues.map((d) => (
            <div key={d.userId} className="flex-1 rounded-xl bg-stone-100 px-2.5 py-1.5">
              <p className="truncate text-[11px] text-stone-500">{nameOf(d.userId)}</p>
              <p className="amount text-[15px] text-stone-800">{formatMoney(d.amount)}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );

  return (
    <>
      <PageHeader title="預購" back="/demo" />
      <div className="px-4">
        <SectionTitle>還在路上 ・ {pending.length} 筆</SectionTitle>
        {pending.length === 0 ? (
          <Card quiet className="p-0">
            <Empty icon="package">目前沒有等待中的預購</Empty>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {pending.map((p) => <Row key={p.id} p={p} />)}
          </div>
        )}

        {arrived.length > 0 && (
          <>
            <SectionTitle>已到貨</SectionTitle>
            <div className="space-y-2.5">
              {arrived.map((p) => <Row key={p.id} p={p} />)}
            </div>
          </>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          「每個人該付」的規則：有指定歸屬的品項就算那個人的，<b className="text-stone-700">只有共同品項才平分</b>。
          不是整張單直接除以二 —— 看看上面三張單的差別。
        </p>
        <p className="mt-2 text-center text-xs text-stone-400">
          試用模式只展示到這裡；正式模式可以直接
          <Link href="/demo/transactions/new" className="text-brand-600">記一筆付款</Link>
          掛在預購單上。
        </p>
      </div>
    </>
  );
}
