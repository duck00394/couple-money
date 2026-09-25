import type { AccountOption } from "@/components/FundForms";
import { prisma } from "./db";
import type { BookContext } from "./services/books";
import { earmarkedByAccount } from "./services/funds";
import { listAccounts } from "./services/ledger";

/** 帳戶選項：可自由使用金額（餘額 − 已指定給基金）與某個基金在該帳戶的額度。 */
export async function accountOptions(ctx: BookContext, allocations?: Map<string, number>): Promise<AccountOption[]> {
  const [accounts, earmarked] = await Promise.all([listAccounts(ctx), earmarkedByAccount(prisma, ctx.book.id)]);
  const nick = (uid: string | null) => (uid === null ? "共同" : uid === ctx.me.userId ? "我" : ctx.members.find((m) => m.userId === uid)?.nickname ?? "已離開");
  return accounts.map((a) => ({
    id: a.id,
    name: `${nick(a.ownerId)}・${a.name}`,
    free: a.balance - (earmarked.get(a.id) ?? 0),
    allocated: allocations?.get(a.id) ?? 0,
    isCard: a.type === "CREDIT_CARD",
    preferred: a.ownerId === null || a.ownerId === ctx.me.userId,
  }));
}
