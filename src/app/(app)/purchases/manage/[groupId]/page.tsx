import { notFound } from "next/navigation";
import { GroupSettingsForm, KeywordBox, NewTagForm, TagRow } from "@/components/PurchaseForms";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { prisma } from "@/server/db";
import { getGroupDetail, listGroups } from "@/server/services/purchases";

/**
 * 某個作品的角色管理與關鍵字。
 *
 * 標題已經是作品名，所以**每一列不再重複作品**。
 * 預設角色排最上面、標「預設」、只有改名沒有刪除——用畫面直接說明規則，
 * 不是等使用者按了才跳錯誤。
 */
export default async function PurchaseManageGroupPage({ params }: PageProps<"/purchases/manage/[groupId]">) {
  const { ctx } = await getAppContext();
  const { groupId } = await params;
  const groups = await listGroups(ctx);
  const summary = groups.find((g) => g.id === groupId);
  if (!summary) notFound();

  const [detail, keywords] = await Promise.all([
    getGroupDetail(ctx, groupId),
    prisma.purchaseKeyword.findMany({ where: { bookId: ctx.book.id, groupId }, orderBy: { createdAt: "asc" } }),
  ]);
  const wordsFor = (tagId: string | null) =>
    keywords.filter((k) => k.tagId === tagId).map((k) => ({ id: k.id, word: k.word }));

  return (
    <>
      <PageHeader title={summary.name} back="/purchases/manage" />
      <div className="px-4">
        <SectionTitle>作品</SectionTitle>
        <Card><GroupSettingsForm group={{ id: summary.id, name: summary.name, icon: summary.icon, deletable: summary.deletable, entryCount: summary.totals.count }} /></Card>

        <SectionTitle>角色</SectionTitle>
        <Card className="divide-y divide-line p-0">
          {detail.tags.map((t) => (
            <TagRow key={t.id} tag={t} groupId={groupId} canWrite={ctx.canWrite} />
          ))}
          {ctx.canWrite && <NewTagForm groupId={groupId} />}
        </Card>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-stone-400">
          標「預設」的那個<b className="text-brand-700">只有改名、沒有刪除</b>：它是這個作品的落點，
          刪掉的話只對到作品的購買紀錄就沒地方放。刪掉其他角色時，底下的紀錄會自動移到它那裡，一筆都不會少。
        </p>

        <SectionTitle>自動辨識關鍵字</SectionTitle>
        <p className="mb-2 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          記帳時如果<b className="text-stone-700">名稱、店家或備註</b>出現這些字，系統會自動加入購買紀錄。
          不分大小寫、不分全半形。<br />
          關鍵字<b className="text-stone-700">只判斷作品與角色，不判斷歸屬</b>（歸屬一律預設共同），而且
          <b className="text-stone-700">改關鍵字不會回頭重算舊資料</b>。
        </p>
        <Card className="mb-2.5">
          <p className="mb-2 text-sm font-bold">作品關鍵字</p>
          <p className="mb-2.5 text-xs text-stone-500">命中但沒對到角色時，會落到「{detail.tags.find((t) => t.isDefault)?.name}」。</p>
          <KeywordBox groupId={groupId} tagId={null} words={wordsFor(null)} canWrite={ctx.canWrite} />
        </Card>
        {detail.tags.map((t) => (
          <Card key={t.id} className="mb-2.5">
            <p className="mb-2.5 text-sm font-bold">
              {t.name}
              {t.isDefault && <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">預設</span>}
            </p>
            <KeywordBox groupId={groupId} tagId={t.id} words={wordsFor(t.id)} canWrite={ctx.canWrite} />
          </Card>
        ))}
      </div>
    </>
  );
}
