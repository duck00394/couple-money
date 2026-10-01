import { notFound } from "next/navigation";
import { EditEntryForm } from "@/components/PurchaseForms";
import { PageHeader } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { getEntry, optionsForForm } from "@/server/services/purchases";

/**
 * 編輯購買紀錄。
 *
 * 來自記帳的：品項、日期、金額是灰色唯讀（金額與日期來自原始記帳），
 * 但作品、歸屬、角色照樣可以改。手動的：全部都能改。
 */
export default async function PurchaseEntryPage({ params }: PageProps<"/purchases/entry/[id]">) {
  const { ctx } = await getAppContext();
  const { id } = await params;
  const [entry, groups] = await Promise.all([getEntry(ctx, id), optionsForForm(ctx)]);
  if (!entry) notFound();

  const nameOf = (userId: string) => ctx.members.find((m) => m.userId === userId)?.nickname ?? "已離開的成員";
  const stamp = (d: Date) => `${toDateKey(d).slice(5).replace("-", "/")} ${d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" })}`;

  return (
    <>
      <PageHeader title="編輯購買紀錄" back={`/purchases/${entry.groupId}`} />
      <div className="px-4">
        <EditEntryForm
          entry={{
            id: entry.id,
            groupId: entry.groupId,
            tagId: entry.tagId,
            ownerId: entry.ownerId,
            note: entry.note,
            title: entry.title,
            amount: entry.amount,
            occurredOn: toDateKey(entry.occurredAt),
            fromTransaction: entry.fromTransaction,
            transactionId: entry.transactionId,
            createdByName: nameOf(entry.createdById),
            updatedByName: nameOf(entry.updatedById),
            createdAt: stamp(entry.createdAt),
            updatedAt: stamp(entry.updatedAt),
          }}
          groups={groups}
          members={ctx.members.map((m) => ({ userId: m.userId, nickname: m.nickname, avatarColor: m.avatarColor, avatarUrl: m.avatarUrl }))}
          returnTo={`/purchases/${entry.groupId}`}
        />
      </div>
    </>
  );
}
