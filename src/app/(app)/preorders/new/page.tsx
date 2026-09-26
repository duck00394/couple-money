import { PreorderForm } from "@/components/PreorderForms";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { assertCanWrite } from "@/server/services/books";

export default async function NewPreorderPage() {
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  return (
    <>
      <PageHeader title="新增預購" back="/preorders" />
      <Card className="mx-4">
        <PreorderForm
          values={{ name: "", seller: "", emoji: "package", expectedOn: "", itemAmount: "", shipping: "", ownerId: ctx.me.userId, note: "" }}
          members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname }))}
        />
      </Card>
    </>
  );
}
