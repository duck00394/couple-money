import Link from "next/link";
import { ArtIcon } from "@/components/ArtIcon";
import { NewGroupForm } from "@/components/PurchaseForms";
import { Card, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getAppContext } from "@/server/context";
import { listGroups } from "@/server/services/purchases";

/**
 * 分類管理・作品列表。
 *
 * 這一層只管作品與它底下的角色，**完全不管歸屬（共同／A／B）**——
 * 歸屬是每一筆購買紀錄自己的欄位，不是分類。
 */
export default async function PurchaseManagePage() {
  const { ctx } = await getAppContext();
  const groups = await listGroups(ctx);

  return (
    <>
      <PageHeader
        title="管理購買分類"
        back="/purchases"
        right={<Link href="/purchases/trial" className="text-[13px] font-semibold text-brand-600">試跑</Link>}
      />
      <div className="px-4">
        <SectionTitle>作品</SectionTitle>
        {groups.length === 0 ? (
          <Empty icon="gift">還沒有任何作品</Empty>
        ) : (
          <div className="space-y-2.5">
            {groups.map((g) => (
              <Link key={g.id} href={`/purchases/manage/${g.id}`} className="press block" data-testid="manage-group-row">
                <Card className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-stone-800 bg-brand-100">
                    <ArtIcon name={g.icon} size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{g.name}</p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {g.categoryCount} 個商品分類 ・ {g.tagCount} 個角色
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="amount text-[15px]">{formatMoney(g.totals.amount)}</p>
                    <p className="mt-0.5 text-[11px] text-stone-500">{g.totals.count} 件</p>
                  </div>
                  <span className="text-lg text-stone-400">›</span>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {ctx.canWrite && (
          <>
            <SectionTitle>新增作品</SectionTitle>
            <Card><NewGroupForm /></Card>
          </>
        )}

        <p className="mt-5 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          <b className="text-stone-700">商品分類與角色都在各自的作品底下</b><br />
          每個 IP 會出的東西不一樣，所以不共用一份 —— 點進作品才管理它自己的分類與角色。<br />
          有購買紀錄的作品不能直接刪除，要先把底下的紀錄移走或移除。
        </p>
        <div className="mt-3">
          <LinkButton href="/purchases/trial" variant="soft" className="w-full">試跑看看關鍵字會抓到什麼</LinkButton>
        </div>
      </div>
    </>
  );
}
