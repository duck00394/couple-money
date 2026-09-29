import { PreorderForm } from "@/components/PreorderForms";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { listCategories } from "@/server/services/ledger";
import { assertCanWrite } from "@/server/services/books";

export default async function NewPreorderPage() {
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  const categories = await listCategories(ctx);
  return (
    <>
      <PageHeader title="新增預購" back="/preorders" />
      <Card className="mx-4">
        <PreorderForm
          values={{ name: "", seller: "", emoji: "package", expectedOn: "", itemAmount: "", shipping: "", ownerId: ctx.me.userId, note: "", categoryId: "", items: [], splitRule: null }}
          members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }))}
          categories={categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name }))}
        />
      </Card>
    </>
  );
}
