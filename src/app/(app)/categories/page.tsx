import { CategoryRow, NewCategoryForm, type CategoryItem } from "@/components/CategoryForms";
import { Card, Empty, PageHeader, SectionTitle } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { CATEGORY_KIND_LABEL, CATEGORY_KINDS } from "@/server/domain/category";
import { listCategoriesForManage } from "@/server/services/categories";

/** 分類管理：改名、換圖示、停用／啟用；完全沒用過的分類才可以真的刪掉。 */
export default async function CategoriesPage() {
  const { ctx } = await getAppContext();
  const categories = await listCategoriesForManage(ctx);

  return (
    <>
      <PageHeader title="分類" back="/more" />
      <div className="px-4">
        <p className="px-1 pb-1 text-xs leading-relaxed text-stone-500">
          停用只是「新紀錄不能再選」，舊紀錄仍然看得到、搜尋得到、也算進統計。改名同理，不會動到任何舊紀錄。
        </p>

        {CATEGORY_KINDS.map((kind) => {
          const list = categories.filter((c) => c.kind === kind);
          return (
            <section key={kind}>
              <SectionTitle right={<span className="text-xs text-stone-400">{list.filter((c) => !c.isArchived).length} 個可用</span>}>
                {CATEGORY_KIND_LABEL[kind]}分類
              </SectionTitle>
              <Card className="divide-y divide-stone-100 p-0">
                {list.length === 0 ? (
                  <Empty icon="🏷️">還沒有{CATEGORY_KIND_LABEL[kind]}分類</Empty>
                ) : (
                  list.map((c) => <CategoryRow key={c.id} category={c as CategoryItem} canWrite={ctx.canWrite} />)
                )}
              </Card>
            </section>
          );
        })}

        {ctx.canWrite ? (
          <div className="mt-5">
            <NewCategoryForm />
          </div>
        ) : (
          <p className="mt-5 text-center text-xs text-stone-400">你沒有這個帳本的編輯權限，只能查看分類。</p>
        )}
        <p className="mt-6 text-center text-xs text-stone-400">分類只影響怎麼分類，不會影響任何金額、統計或誰欠誰。</p>
      </div>
    </>
  );
}
