import Link from "next/link";
import { ArtIcon } from "@/components/ArtIcon";
import { AddFromTransactionForm, AddManualForm } from "@/components/PurchaseForms";
import { Card, cx, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listAddableTransactions, optionsForForm } from "@/server/services/purchases";

/**
 * 新增購買紀錄。
 *
 * 從作品頁進來（?group=）時作品已由脈絡決定，**不再問一次作品**；
 * 從首頁進來就要先選。歸屬兩種情況都要選——頁面脈絡給不了它。
 */
export default async function NewPurchasePage({ searchParams }: PageProps<"/purchases/new">) {
  const { ctx } = await getAppContext();
  const sp = await searchParams;
  const fixedGroupId = typeof sp.group === "string" ? sp.group : undefined;
  const from = typeof sp.tx === "string" ? sp.tx : "";
  const mode = sp.mode === "manual" ? "manual" : "tx";

  const [groups, addable] = await Promise.all([optionsForForm(ctx), listAddableTransactions(ctx)]);
  const group = fixedGroupId ? groups.find((g) => g.id === fixedGroupId) : undefined;
  const members = ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname, avatarColor: m.avatarColor, avatarUrl: m.avatarUrl }));
  const picked = addable.find((t) => t.id === from);

  if (groups.length === 0) {
    return (
      <>
        <PageHeader title="新增購買紀錄" back="/purchases" />
        <div className="px-4">
          <Empty icon="shopping-bag">還沒有任何作品分類<span className="mt-2 block text-xs text-stone-500">先建立一個作品，才知道東西要放哪裡。</span></Empty>
          <LinkButton href="/purchases/manage" className="w-full">先建立作品分類</LinkButton>
        </div>
      </>
    );
  }

  const tab = (href: string, active: boolean, label: string) => (
    <Link href={href} className={cx("flex h-10 items-center justify-center rounded-xl text-[13px] font-semibold transition", active ? "bg-white text-stone-800 shadow-sm" : "text-stone-500")}>
      {label}
    </Link>
  );
  const base = `/purchases/new${fixedGroupId ? `?group=${fixedGroupId}` : ""}`;
  const withMode = (m: string) => (fixedGroupId ? `${base}&mode=${m}` : `/purchases/new?mode=${m}`);

  return (
    <>
      <PageHeader title={group ? `${group.name}・新增` : "新增購買紀錄"} back={group ? `/purchases/${group.id}` : "/purchases"} />
      <div className="px-4">
        {picked ? (
          <AddFromTransactionForm
            transaction={{ id: picked.id, title: picked.title, amount: picked.amount, occurredOn: toDateKey(picked.occurredAt) }}
            groups={groups}
            members={members}
            fixedGroupId={fixedGroupId}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/60 p-1">
              {tab(withMode("tx"), mode === "tx", "從既有記帳挑")}
              {tab(withMode("manual"), mode === "manual", "記一筆歷史購買")}
            </div>

            {mode === "manual" ? (
              <div className="mt-4">
                <AddManualForm groups={groups} members={members} fixedGroupId={fixedGroupId} today={toDateKey(new Date())} />
              </div>
            ) : (
              <>
                <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
                  挑一筆記帳，金額與日期就直接沿用它，不用重打。
                  <b className="text-brand-700">已經加入過的不會出現在這份清單裡</b>，同一筆不會重複加。
                </p>
                <SectionTitle>還沒加入購買紀錄的記帳</SectionTitle>
                {addable.length === 0 ? (
                  <Empty icon="transaction">最近的記帳都已經處理過了</Empty>
                ) : (
                  <Card quiet className="divide-y divide-line p-0">
                    {addable.map((t) => (
                      <Link
                        key={t.id}
                        href={`${base}${base.includes("?") ? "&" : "?"}tx=${t.id}`}
                        className="press flex items-center gap-3 px-4 py-3"
                        data-testid="addable-tx"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">
                          <ArtIcon name={t.categoryIcon} size={18} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{t.title}</p>
                          <p className="mt-0.5 text-xs text-stone-500">{t.categoryName} ・ {toDateKey(t.occurredAt).slice(5).replace("-", "/")}</p>
                        </div>
                        <span className="amount shrink-0">{formatMoney(t.amount)}</span>
                      </Link>
                    ))}
                  </Card>
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
