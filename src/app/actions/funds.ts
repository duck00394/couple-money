"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/server/context";
import { formatMoney, parseAmount } from "@/lib/money";
import { toDateKey } from "@/lib/dates";
import { DomainError } from "@/server/domain/errors";
import { accountFreeAmount, addFundEntry, cancelFundEntry, cancelRewardDeposit, createFund, depositRewards, updateFund, type FundInput } from "@/server/services/funds";
import { prisma } from "@/server/db";
import type { BookContext } from "@/server/services/books";
import { str, toActionState, type ActionState } from "@/server/actions";

function parseFund(form: FormData): FundInput {
  const raw = str(form, "target").trim();
  const target = raw ? parseAmount(raw) : null;
  if (raw && !target) throw new DomainError("FUND_TARGET", "請輸入正確的目標金額");
  return { name: str(form, "name"), emoji: str(form, "emoji"), description: str(form, "description"), targetAmount: target, dueDate: str(form, "dueDate") || null };
}

/** 初始金額要放進哪個帳戶：只能是這個帳本裡還在用的、不是信用卡的帳戶。 */
async function requireOpeningAccount(ctx: BookContext, accountId: string | null) {
  if (!accountId) throw new DomainError("FUND_ACCOUNT_REQUIRED", "請選擇這筆錢放在哪個帳戶");
  const acc = await prisma.account.findFirst({ where: { id: accountId, bookId: ctx.book.id, deletedAt: null } });
  if (!acc) throw new DomainError("FUND_ACCOUNT", "帳戶不存在");
  if (acc.type === "CREDIT_CARD") throw new DomainError("FUND_ACCOUNT", "信用卡不能當作基金的存放帳戶");
  return acc;
}

export async function saveFundAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");
  let fundId = id;
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    if (id) {
      await updateFund(ctx, id, { ...parseFund(form), isArchived: str(form, "isArchived") === "true" }, str(form, "expectedUpdatedAt") || null);
      return { ok: "已儲存" };
    }
    // 初始金額（選填）：建立完直接投入一筆，使用者不用再跑一次「投入」流程。
    // 走的是既有的 addFundEntry，金流規則（可自由使用金額、指定額度）完全沒有改。
    const opening = str(form, "openingAmount").trim();
    const openingAccountId = str(form, "openingAccountId") || null;
    let amount = 0;
    if (opening) {
      const parsed = parseAmount(opening);
      if (!parsed) throw new DomainError("FUND_AMOUNT", "請輸入正確的初始金額");
      amount = parsed;
      // 先檢查錢夠不夠，不夠就整個不要建立，避免留下一個空基金
      const acc = await requireOpeningAccount(ctx, openingAccountId);
      const { free } = await accountFreeAmount(prisma, ctx.book.id, acc.id);
      if (amount > free) {
        throw new DomainError(
          "FUND_OVER_FREE",
          `「${acc.name}」可自由使用的金額只剩 ${formatMoney(Math.max(0, free))}，不能當作 ${formatMoney(amount)} 的初始金額`,
        );
      }
    }
    fundId = (await createFund(ctx, parseFund(form))).id;
    if (amount) {
      await addFundEntry(ctx, {
        fundId, type: "DEPOSIT", amount, userId: null, accountId: openingAccountId,
        note: "初始金額", occurredOn: str(form, "openingDate") || toDateKey(new Date()),
        clientRequestId: `fund-open:${fundId}`,
      });
    }
  });
  if (state?.error || id) {
    revalidatePath("/", "layout");
    return state;
  }
  revalidatePath("/", "layout");
  redirect(`/funds/${fundId}`);
}

export async function fundEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const type = str(form, "type") === "WITHDRAW" ? "WITHDRAW" : "DEPOSIT";
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const amount = parseAmount(str(form, "amount"));
    if (!amount) throw new DomainError("FUND_AMOUNT", "請輸入正確的金額");
    const who = str(form, "userId");
    await addFundEntry(ctx, {
      fundId: str(form, "fundId"),
      type,
      amount,
      userId: who === "JOINT" ? null : who,
      accountId: str(form, "accountId") || null,
      note: str(form, "note"),
      occurredOn: str(form, "occurredOn"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: type === "DEPOSIT" ? "已投入基金" : "已從基金取回" };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelFundEntryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelFundEntry(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}

export async function depositRewardsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    const e = await depositRewards(ctx, {
      fundId: str(form, "fundId"),
      targetAccountId: str(form, "targetAccountId"),
      sourceAccountId: str(form, "sourceAccountId") || null,
      note: str(form, "note"),
      occurredOn: str(form, "occurredOn"),
      clientRequestId: str(form, "clientRequestId"),
    });
    return { ok: `已入金 ${formatMoney(e.amount)}，基金實際金額已增加` };
  });
  revalidatePath("/", "layout");
  return state;
}

export async function cancelRewardDepositAction(_: ActionState, form: FormData): Promise<ActionState> {
  const state = await toActionState(async () => {
    const { ctx } = await getAppContext();
    await cancelRewardDeposit(ctx, str(form, "id"));
  });
  revalidatePath("/", "layout");
  return state;
}
