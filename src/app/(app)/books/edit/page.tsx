import { DeleteBookForm, EditBookForm } from "@/components/BookForms2";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { listMyBooks } from "@/server/services/books";

/**
 * 編輯「目前這本」帳本。
 *
 * 名稱、起訖日、備註、換回台幣的參考匯率都在這裡改 —— 匯率不用再跑設定頁。
 * 原帳本不提供刪除。
 */
export default async function EditBookPage() {
  const { ctx, user } = await getAppContext();
  const books = await listMyBooks(user.id);
  const me = books.find((b) => b.id === ctx.book.id);

  return (
    <>
      <PageHeader title="帳本設定" back="/books" />
      <div className="px-4">
        <Card className="mb-3 px-4 py-3">
          <p className="text-sm text-stone-700">
            {ctx.book.name}
            <span className="ml-1.5 text-xs text-stone-500">
              {ctx.book.type === "MAIN" ? "原帳本" : ctx.book.type === "TRIP" ? "旅遊帳本" : "自訂帳本"}
              ・{ctx.book.baseCurrency}
            </span>
          </p>
        </Card>

        <EditBookForm
          name={ctx.book.name}
          startOn={me?.startOn ?? null}
          endOn={me?.endOn ?? null}
          note={me?.note ?? null}
          baseCurrency={ctx.book.baseCurrency}
          homeRate={ctx.book.homeRate}
        />

        {ctx.book.type !== "MAIN" && (
          <>
            <SectionTitle>危險區</SectionTitle>
            <DeleteBookForm bookId={ctx.book.id} name={ctx.book.name} />
          </>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          本位幣在建立帳本時就決定了，之後不能改 —— 改掉會讓已經記進去的金額全部變成另一種幣別的數字。
          真的需要換幣別請新建一本。
        </p>
      </div>
    </>
  );
}
