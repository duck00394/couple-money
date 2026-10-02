import { NewBookForm } from "@/components/BookForms2";
import { PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";

export default async function NewBookPage() {
  const { ctx } = await getAppContext();
  return (
    <>
      <PageHeader title="新增帳本" back="/books" />
      <div className="px-4">
        <NewBookForm baseCurrency={ctx.book.baseCurrency} />
      </div>
    </>
  );
}
