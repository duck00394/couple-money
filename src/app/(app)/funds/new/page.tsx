import { FundForm } from "@/components/FundForms";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { listAccounts } from "@/server/services/ledger";

export default async function NewFundPage() {
  const { ctx } = await getAppContext();
  // 基金只能指定「帳戶裡真的有的錢」，信用卡不是存錢的地方
  const openingAccounts = (await listAccounts(ctx))
    .filter((a) => a.isActive && a.type !== "CREDIT_CARD")
    .map((a) => ({
      id: a.id,
      label:
        a.ownerId === null ? `共同・${a.name}`
        : a.ownerId === ctx.me.userId ? `我的・${a.name}`
        : `${ctx.members.find((m) => m.userId === a.ownerId)?.nickname ?? "另一半"}・${a.name}`,
    }));

  return (
    <>
      <PageHeader title="新增基金" back="/funds" />
      <Card className="mx-4">
        <FundForm
          values={{ name: "", emoji: "piggy-bank", description: "", target: "", dueDate: "" }}
          openingAccounts={ctx.canWrite ? openingAccounts : []}
        />
      </Card>
    </>
  );
}
