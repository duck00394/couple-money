"use client";

/**
 * 試用模式的作品內頁，逐層往下：商品分類 → 共同/A/B → 角色 → 實際品項。
 *
 * 層級用 query 參數表示（?cat=&owner=&tag=），跟正式模式同一套 IA：
 * 每進一層才顯示下一層，每一層的件數與金額都算在「上面已經選定」的範圍內。
 * 商品分類與角色都是**依作品分開**的（每個 IP 會出的東西不一樣）。
 */
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Avatar, Card, Empty, PageHeader, SectionTitle, cx } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { JOINT } from "@/server/domain/purchase";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";
import type { DemoPurchaseEntry } from "@/demo/types";

export default function DemoPurchaseGroupPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const sp = useSearchParams();
  const { state, run } = useDemo();

  const cat = sp.get("cat") ?? "";
  const owner = sp.get("owner") ?? "";
  const tag = sp.get("tag") ?? "";

  const group = state.purchaseGroups.find((g) => g.id === groupId);
  if (!group) {
    return (
      <>
        <PageHeader title="找不到作品" back="/demo/purchases" />
        <div className="px-4">
          <Card quiet className="p-0"><Empty icon="sparkles">這個作品不存在</Empty></Card>
        </div>
      </>
    );
  }

  const categories = state.purchaseCategories.filter((c) => c.groupId === groupId);
  const tags = state.purchaseTags.filter((t) => t.groupId === groupId);

  /** 目前這一層：沒選商品分類就停在第二層，以此類推 */
  const level = !cat ? "category" : !owner ? "owner" : "tag";

  const url = (next: { cat?: string; owner?: string; tag?: string }) => {
    const q = new URLSearchParams();
    const c = next.cat !== undefined ? next.cat : cat;
    const o = next.owner !== undefined ? next.owner : owner;
    const t = next.tag !== undefined ? next.tag : tag;
    if (c) q.set("cat", c);
    if (o) q.set("owner", o);
    if (t) q.set("tag", t);
    return `/demo/purchases/${groupId}${q.size ? `?${q}` : ""}`;
  };
  const back = tag || owner
    ? (owner ? url({ owner: "", tag: "" }) : url({ cat: "", owner: "", tag: "" }))
    : cat ? url({ cat: "", owner: "", tag: "" }) : "/demo/purchases";

  // 已經選定的範圍（上面幾層的篩選）
  const scope = select.purchaseDrill(state, groupId, {
    ...(cat ? { categoryId: cat } : {}),
    ...(owner ? { ownerId: owner === JOINT ? null : owner } : {}),
    ...(tag ? { tagId: tag } : {}),
  });

  const nameOf = (id: string | null) =>
    id === null ? "共同" : state.users.find((u) => u.id === id)?.nickname ?? "";
  const colorOf = (id: string) =>
    id === JOINT ? "#f3e3be" : state.users.find((u) => u.id === id)?.avatarColor ?? "#eee";

  const catName = categories.find((c) => c.id === cat)?.name ?? "";
  const ownerName = owner ? nameOf(owner === JOINT ? null : owner) : "";
  const tagName = tags.find((t) => t.id === tag)?.name ?? "";
  const crumb = [group.name, catName, ownerName, tagName].filter(Boolean).join(" ・ ");

  /** 一層的清單：每一列都顯示件數與金額，範圍是「上面已選定」之內 */
  const levelList = (
    rows: Array<{ id: string; name: string; count: number; total: number }>,
    hrefOf: (id: string) => string,
    withAvatar = false,
  ) =>
    rows.filter((r) => r.count > 0).length === 0 ? (
      <Card quiet className="p-0"><Empty icon="package">這個範圍裡還沒有東西</Empty></Card>
    ) : (
      <Card className="divide-y divide-line p-0" data-testid="demo-purchase-level">
        {rows
          .filter((r) => r.count > 0)
          .map((r) => (
            <Link
              key={r.id}
              href={hrefOf(r.id)}
              className="flex items-center gap-3 px-4 py-3 active:bg-stone-50"
              data-testid="demo-purchase-level-row"
            >
              {withAvatar && <Avatar name={r.name} color={colorOf(r.id)} size={32} />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-stone-800">{r.name}</p>
                <p className="truncate text-xs text-stone-500">{r.count} 件</p>
              </div>
              <span className="amount shrink-0 text-[15px] text-stone-800">{formatMoney(r.total)}</span>
              <span className="shrink-0 text-stone-400">›</span>
            </Link>
          ))}
      </Card>
    );

  const agg = (rows: DemoPurchaseEntry[]) => ({ count: rows.length, total: rows.reduce((a, e) => a + e.amount, 0) });

  return (
    <>
      <PageHeader title={group.name} back={back} />
      <div className="px-4">
        {/* 麵包屑：讓人知道現在在第幾層 */}
        <p className="mb-2 text-xs text-stone-500" data-testid="demo-purchase-crumb">{crumb}</p>

        <Card className="px-5 py-3.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-stone-500">這個範圍</p>
              <p className="amount mt-0.5 text-[1.6rem] text-stone-800">{formatMoney(agg(scope).total)}</p>
            </div>
            <p className="tnum shrink-0 text-xs text-stone-500">{scope.length} 件</p>
          </div>
        </Card>

        {level === "category" && (
          <>
            <SectionTitle>商品分類</SectionTitle>
            {levelList(
              categories.map((c) => ({
                id: c.id,
                name: c.name,
                ...agg(select.purchaseDrill(state, groupId, { categoryId: c.id })),
              })),
              (id) => url({ cat: id }),
            )}
          </>
        )}

        {level === "owner" && (
          <>
            <SectionTitle>誰的</SectionTitle>
            {levelList(
              [
                { id: JOINT, ownerId: null as string | null },
                ...state.users.map((u) => ({ id: u.id, ownerId: u.id as string | null })),
              ].map((o) => ({
                id: o.id,
                name: nameOf(o.ownerId),
                ...agg(select.purchaseDrill(state, groupId, { categoryId: cat, ownerId: o.ownerId })),
              })),
              (id) => url({ owner: id }),
              true,
            )}
          </>
        )}

        {level === "tag" && (
          <>
            <SectionTitle>角色</SectionTitle>
            {levelList(
              tags.map((t) => ({
                id: t.id,
                name: t.name,
                ...agg(
                  select.purchaseDrill(state, groupId, {
                    categoryId: cat,
                    ownerId: owner === JOINT ? null : owner,
                    tagId: t.id,
                  }),
                ),
              })),
              (id) => url({ tag: id }),
            )}
          </>
        )}

        {/* 最底層：實際品項 */}
        {tag && (
          <>
            <SectionTitle>品項 ・ {scope.length} 件</SectionTitle>
            {scope.length === 0 ? (
              <Card quiet className="p-0"><Empty icon="package">還沒有東西</Empty></Card>
            ) : (
              <Card className="divide-y divide-line p-0" data-testid="demo-purchase-entries">
                {scope.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-3" data-testid="demo-purchase-entry">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-stone-800">{e.title}</p>
                      <p className="truncate text-xs text-stone-500">
                        {e.occurredOn}
                        {e.transactionId && <span className="ml-1.5 text-brand-600">來自記帳</span>}
                        {e.note && `・${e.note}`}
                      </p>
                    </div>
                    <span className="amount shrink-0 text-[15px] text-stone-800">{formatMoney(e.amount)}</span>
                    <button
                      type="button"
                      onClick={() => run({ kind: "purchase.remove", id: e.id })}
                      className={cx("shrink-0 text-xs text-stone-400 underline-offset-2 hover:underline")}
                      data-testid="demo-purchase-remove"
                    >
                      移除
                    </button>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          四層是：<b className="text-stone-700">作品 → 商品分類 → 誰的 → 角色</b>。
          商品分類跟角色都是依作品分開管理的，因為每個 IP 會出的東西本來就不一樣。
        </p>
        <p className="mt-2 text-center text-xs text-stone-400">
          想新增一筆？到<Link href="/demo/transactions/new" className="text-brand-600">記一筆</Link>勾「同時加進購買紀錄」。
        </p>
      </div>
    </>
  );
}
