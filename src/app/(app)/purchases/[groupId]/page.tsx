import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtIcon } from "@/components/ArtIcon";
import { VoidedEntryActions } from "@/components/PurchaseForms";
import { Avatar, Card, cx, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { DomainError } from "@/server/domain/errors";
import { JOINT, ownerLabel } from "@/server/domain/purchase";
import { getGroupDetail } from "@/server/services/purchases";

/**
 * 作品內頁。
 *
 * 作品這一層已經由頁面標題決定，所以**這裡不再出現作品篩選列**，
 * 每一列也不重複作品名。剩下兩個互不相干的維度：
 *   第一排 歸屬（全部／共同／A／B）
 *   第二排 角色（全部／預設角色／各角色）
 * 兩個可以同時套用，件數與金額跟著一起變。
 */
export default async function PurchaseGroupPage({ params, searchParams }: PageProps<"/purchases/[groupId]">) {
  const { ctx } = await getAppContext();
  const { groupId } = await params;
  const sp = await searchParams;
  const owner = typeof sp.owner === "string" ? sp.owner : "";
  const tagId = typeof sp.tag === "string" ? sp.tag : "";

  let detail;
  try {
    detail = await getGroupDetail(ctx, groupId, { owner: owner || null, tagId: tagId || null });
  } catch (e) {
    if (e instanceof DomainError) notFound();
    throw e;
  }

  const href = (next: { owner?: string; tag?: string }) => {
    const o = next.owner !== undefined ? next.owner : owner;
    const t = next.tag !== undefined ? next.tag : tagId;
    const q = new URLSearchParams();
    if (o) q.set("owner", o);
    if (t) q.set("tag", t);
    return `/purchases/${groupId}${q.size ? `?${q}` : ""}`;
  };
  const chip = (active: boolean, extra = "") =>
    cx(
      "press rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition",
      active ? "border-stone-800 bg-brand-500 font-semibold text-white shadow-xs" : "border-line bg-white text-stone-700",
      extra,
    );
  const ownerOptions = [{ id: JOINT, name: "共同", color: "#f3e3be", url: null as string | null }, ...ctx.members.map((m) => ({ id: m.userId, name: m.nickname, color: m.avatarColor, url: m.avatarUrl }))];
  const ownerName = owner === JOINT ? "共同" : owner ? ownerLabel(owner, ctx.members) : "";
  const tagName = detail.tags.find((t) => t.id === tagId)?.name ?? "";
  const label = [ownerName && `${ownerName}的`, tagName || "全部角色"].filter(Boolean).join(" ・ ");

  return (
    <>
      <PageHeader
        title={detail.name}
        back="/purchases"
        right={<Link href={`/purchases/manage/${groupId}`} className="text-[13px] font-semibold text-brand-600">管理</Link>}
      />
      <div className="px-4">
        {/* 第一排：歸屬。「全部」＝共同 + A + B，用深色實心與後面的細線跟其他選項分開 */}
        <div className="rounded-2xl border border-line bg-white p-2.5" data-testid="owner-filter">
          <p className="mb-1.5 text-[10.5px] font-extrabold tracking-wider text-stone-400">歸屬</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={href({ owner: "" })} className={chip(!owner, owner ? "bg-stone-100" : "")} aria-current={!owner ? "true" : undefined}>全部</Link>
            <span className="mx-1 h-5 w-px bg-line" />
            {ownerOptions.map((o) => (
              <Link key={o.id} href={href({ owner: o.id })} className={cx(chip(owner === o.id), "flex items-center gap-1.5")}>
                <Avatar name={o.name} color={o.color} size={17} src={o.url} />
                {o.name}
              </Link>
            ))}
          </div>
        </div>

        {/* 第二排：角色。「全部」是篩選，預設角色是真的分類（虛線框），兩者刻意長得不一樣 */}
        <div className="mt-2 rounded-2xl border border-line bg-white p-2.5" data-testid="tag-filter">
          <p className="mb-1.5 text-[10.5px] font-extrabold tracking-wider text-stone-400">角色</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href={href({ tag: "" })} className={chip(!tagId, tagId ? "bg-stone-100" : "")}>全部</Link>
            <span className="mx-1 h-5 w-px bg-line" />
            {detail.tags.map((t) => (
              <Link
                key={t.id}
                href={href({ tag: t.id })}
                className={cx(
                  chip(tagId === t.id),
                  t.isDefault && tagId !== t.id && "border-dashed border-brand-500 bg-brand-50 text-brand-700",
                )}
                data-testid={t.isDefault ? "default-tag-chip" : undefined}
              >
                {t.name}
              </Link>
            ))}
          </div>
        </div>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-stone-400">
          兩個「全部」是不同維度：上面是「不分誰的」，下面是「不分角色」。
        </p>

        <Card className="mt-3 flex items-baseline gap-3">
          <div className="flex-1">
            <p className="text-xs font-semibold text-stone-500">{label}</p>
            <p className="amount-lg mt-1 text-[30px]" data-testid="purchase-total">{formatMoney(detail.totals.amount)}</p>
          </div>
          <div className="text-right">
            <p className="tnum text-base font-bold" data-testid="purchase-count">{detail.totals.count} 件</p>
            <p className="mt-0.5 text-[11px] text-stone-500">總計跟著篩選變</p>
          </div>
        </Card>

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
            <p className="mt-2 px-1 text-[11px] leading-relaxed text-stone-400">
              記帳被作廢代表那筆錢沒有真的花出去，所以不能再算進金額；但東西可能真的有買到，所以也不自己幫你刪掉。
            </p>
          </>
        )}

        <SectionTitle>品項</SectionTitle>
        {detail.entries.length === 0 ? (
          <Empty icon="shopping-bag">這個篩選條件下還沒有購買紀錄</Empty>
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
                    {/* 歸屬選「全部」時才顯示是誰的；選定某個人之後就不再重複 */}
                    {!owner && (
                      <>
                        <Avatar
                          name={ownerLabel(e.ownerId, ctx.members)}
                          color={e.ownerId === null ? "#f3e3be" : ctx.members.find((m) => m.userId === e.ownerId)?.avatarColor ?? "#eee"}
                          size={15}
                        />
                        {ownerLabel(e.ownerId, ctx.members)} ・{" "}
                      </>
                    )}
                    {e.tagName} ・ {toDateKey(e.occurredAt).slice(5).replace("-", "/")}
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
