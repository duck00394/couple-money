import { RecurringForm } from "@/components/RecurringForm";
import { PageHeader } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { assertCanWrite } from "@/server/services/books";
import { listAccounts, listCategories } from "@/server/services/ledger";
import { accountOptionLabel } from "@/server/txFormData";

export default async function NewRecurringPage() {
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  const [accounts, categories] = await Promise.all([listAccounts(ctx), listCategories(ctx)]);
  return (
    <>
      <PageHeader title="新增固定支出" back="/recurring" />
      <RecurringForm
        me={{ userId: ctx.me.userId, nickname: ctx.me.nickname }}
        partner={ctx.partner ? { userId: ctx.partner.userId, nickname: ctx.partner.nickname } : null}
        accounts={accounts.map((a) => ({ id: a.id, label: accountOptionLabel(ctx, a), ownerId: a.ownerId }))}
        categories={categories.filter((c) => c.kind === "EXPENSE").map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
        today={toDateKey(new Date())}
      />
    </>
  );
}
