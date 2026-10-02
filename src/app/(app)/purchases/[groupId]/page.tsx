import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtIcon } from "@/components/ArtIcon";
import { VoidedEntryActions } from "@/components/PurchaseForms";
import { Avatar, Card, cx, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getMainBookContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { JOINT, ownerLabel } from "@/server/domain/purchase";
import { getGroupDetail, type LevelRow } from "@/server/services/purchases";

/**
 * 作品內頁，逐層往下：商品分類 → 共同/A/B → 角色 → 實際品項。
 *
 * 層級用 query 參數表示（?cat=&owner=&tag=），每進一層才顯示下一層，
 * 不會一次把四層全部攤開。每一層都保留「全部」，而且每一層的件數與金額
 * 都算在「上面已經選定」的範圍內。
 *
 * 作品這一層由頁面標題決定，所以畫面上不再出現作品選單，每一列也不重複作品名。
 */
export default async function PurchaseGroupPage({ params, searchParams }: PageProps<"/purchases/[groupId]">) {
  const { ctx } = await getMainBookContext();
  const { groupId } = await params;
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const tag = typeof sp.tag === "string" ? sp.tag : "";

  let detail;
  try {
    detail = await getGroupDetail(ctx, groupId, { categoryId: cat || null, owner: owner || null, tagId: tag || null });
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }

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
    return `/purchases/${groupId}${q.size ? `?${q}` : ""}`;
  };
  // 上一層：一層一層退回去，最後回到作品列表
  const back = tag || owner ? (owner ? url({ owner: "", tag: "" }) : url({ cat: "", owner: "", tag: "" })) : cat ? url({ cat: "", owner: "", tag: "" }) : "/purchases";

  const catName = detail.categories.find((c) => c.id === cat)?.name ?? "";
  const ownerName = owner === JOINT ? "共同" : owner ? ownerLabel(owner, ctx.members) : "";
  const tagName = detail.tags.find((t) => t.id === tag)?.name ?? "";
  const crumb = [detail.name, catName, ownerName, tagName].filter(Boolean).join(" ・ ");
  const colorOf = (id: string) => (id === JOINT ? "#f3e3be" : ctx.members.find((m) => m.userId === id)?.avatarColor ?? "#eee");

  /** 一層的清單：每一列都顯示件數與金額 */
  const levelList = (rows: LevelRow[], hrefOf: (r: LevelRow) => string, withAvatar = false) => (
    <Card className="divide-y divide-line p-0">
      {rows.map((r) => (
        <Link key={r.id} href={hrefOf(r)} className="press flex items-center gap-3 px-4 py-3.5" data-testid="purchase-level-row">
          {withAvatar && <Avatar name={r.name} color={colorOf(r.id)} size={26} />}
          <p className="min-w-0 flex-1 truncate font-medium">
            {r.name}
            {r.isDefault && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">預設</span>}
          </p>
          <div className="shrink-0 text-right">
            <p className="amount text-[15px]">{formatMoney(r.totals.amount)}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">{r.totals.count} 件</p>
          </div>
          <span className="text-lg text-stone-400">›</span>
        </Link>
      ))}
    </Card>
  );

  return (
    <>
      <PageHeader
        title={detail.name}
        back={back}
        right={<Link href={`/purchases/manage/${groupId}`} className="text-[13px] font-semibold text-brand-600">管理</Link>}
      />
      <div className="px-4">
        {/* 目前在哪一條路徑上，以及這條路徑的小計 */}
        <Card className="flex items-baseline gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-stone-500" data-testid="purchase-crumb">{crumb}</p>
            <p className="amount-lg mt-1 text-[30px]" data-testid="purchase-total">{formatMoney(detail.totals.amount)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum text-base font-bold" data-testid="purchase-count">{detail.totals.count} 件</p>
            <p className="mt-0.5 text-[11px] text-stone-500">目前這一層的小計</p>
          </div>
        </Card>

        {level === "category" && (
          <>
            <SectionTitle right={<Link href={url({ cat: "" })} className="text-xs font-semibold text-stone-500">看全部品項 ↓</Link>}>
              商品分類
            </SectionTitle>
            {levelList(detail.categories, (r) => url({ cat: r.id, owner: "", tag: "" }))}
          </>
        )}

        {level === "owner" && (
          <>
            <SectionTitle>誰的</SectionTitle>
            {levelList(detail.owners, (r) => url({ owner: r.id, tag: "" }), true)}
            <p className="mt-2 px-1 text-[11px] leading-relaxed text-stone-400">
              「共同」是兩個人的收藏，<b className="text-stone-500">不是付款人</b>。誰出的錢在那筆記帳裡。
            </p>
          </>
        )}

        {level === "tag" && (
          <>
            <SectionTitle>角色</SectionTitle>
            <div className="flex flex-wrap gap-1.5" data-testid="tag-filter">
              <Link
                href={url({ tag: "" })}
                className={cx(
                  "press rounded-full border-[1.5px] px-3 py-1.5 text-[13px]",
                  !tag ? "border-stone-800 bg-stone-800 font-semibold text-white" : "border-line bg-white text-stone-700",
                )}
              >
                全部
              </Link>
              {detail.tags.map((t) => (
                <Link
                  key={t.id}
                  href={url({ tag: t.id })}
                  className={cx(
                    "press rounded-full border-[1.5px] px-3 py-1.5 text-[13px]",
                    tag === t.id
                      ? "border-stone-800 bg-brand-500 font-semibold text-white shadow-xs"
                      : t.isDefault
                        ? "border-dashed border-brand-500 bg-brand-50 text-brand-700"
                        : "border-line bg-white text-stone-700",
                  )}
                  data-testid={t.isDefault ? "default-tag-chip" : undefined}
                >
                  {t.name}
                  <span className="ml-1.5 text-[11px] opacity-70">{t.totals.count}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {detail.voided.length > 0 && (
          <>
            <SectionTitle>需要處理 ・ {detail.voided.length} 筆</SectionTitle>
            <Card className="space-y-3 border-orange-400">
              {detail.voided.map((e) => (
                <div key={e.id} data-testid="voided-entry">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-stone-500 line-through">{e.title}</p>
                      <p className="mt-0.5 text-xs font-semibold text-orange-700">原始記帳已作廢・沒有計入上面的總計</p>
                    </div>
                    <span className="amount text-stone-400 line-through">{formatMoney(e.amount)}</span>
                  </div>
                  {ctx.canWrite && <div className="mt-2"><VoidedEntryActions entry={{ id: e.id, title: e.title, amount: e.amount }} /></div>}
                </div>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>品項 ・ {detail.entries.length} 件</SectionTitle>
        {detail.entries.length === 0 ? (
          <Empty icon="shopping-bag">這一層還沒有購買紀錄</Empty>
        ) : (
          <Card className="divide-y divide-line p-0">
            {detail.entries.map((e) => (
              <Link key={e.id} href={`/purchases/entry/${e.id}`} className="press flex items-center gap-3 px-4 py-3" data-testid="purchase-entry-row">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">
                  <ArtIcon name={detail.icon} size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.title}</p>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
                    {/* 已經選定的那幾層就不再重複顯示 */}
                    {!cat && <>{e.categoryName} ・ </>}
                    {!owner && (
                      <>
                        <Avatar name={ownerLabel(e.ownerId, ctx.members)} color={colorOf(e.ownerId ?? JOINT)} size={15} />
                        {ownerLabel(e.ownerId, ctx.members)} ・{" "}
                      </>
                    )}
                    {!tag && <>{e.tagName} ・ </>}
                    {toDateKey(e.occurredAt).slice(5).replace("-", "/")}
                  </span>
                </div>
                <span className="amount shrink-0">{formatMoney(e.amount)}</span>
              </Link>
            ))}
          </Card>
        )}

        {ctx.canWrite && (
          <div className="mt-4">
            <LinkButton href={`/purchases/new?group=${groupId}`} className="w-full">＋ 在這個作品新增</LinkButton>
          </div>
        )}
      </div>
    </>
  );
}
