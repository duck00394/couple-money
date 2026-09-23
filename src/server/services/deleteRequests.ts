/**
 * 需要另一半確認的刪除：共同目標、共同基金。
 * 帳本只有一個人時直接刪除；有另一半時建立申請，由另一半同意後才刪除。
 */
import { prisma, lockBook } from "../db";
import { assert } from "../domain/errors";
import { assertCanWrite, type BookContext } from "./books";
import { assertFundDeletable, auditIn, performDeleteFund } from "./funds";
import { assertGoalExists, performDeleteGoal } from "./goals";

export type DeletableType = "GOAL" | "FUND";
export const DELETE_LABEL: Record<DeletableType, string> = { GOAL: "共同目標", FUND: "共同基金" };

async function check(client: Parameters<typeof assertGoalExists>[0], ctx: BookContext, type: DeletableType, id: string) {
  if (type === "GOAL") await assertGoalExists(client, ctx, id);
  else await assertFundDeletable(client, ctx, id);
}

export async function requestDelete(ctx: BookContext, type: DeletableType, entityId: string) {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    await check(tx, ctx, type, entityId); // 申請時就先檢查，例如基金還有錢不能刪
    if (!ctx.partner) {
      if (type === "GOAL") await performDeleteGoal(tx, ctx, entityId);
      else await performDeleteFund(tx, ctx, entityId);
      return { deleted: true as const, request: null };
    }
    const existing = await tx.deleteRequest.findFirst({ where: { bookId: ctx.book.id, entityType: type, entityId, status: "PENDING" } });
    if (existing) return { deleted: false as const, request: existing };
    const request = await tx.deleteRequest.create({ data: { bookId: ctx.book.id, entityType: type, entityId, requestedById: ctx.me.userId } });
    await auditIn(tx, ctx, "REQUEST_DELETE", type === "GOAL" ? "Goal" : "Fund", entityId, null, { requestId: request.id });
    return { deleted: false as const, request };
  });
}

export async function decideDelete(ctx: BookContext, requestId: string, decision: "APPROVE" | "REJECT" | "CANCEL") {
  assertCanWrite(ctx);
  return prisma.$transaction(async (tx) => {
    await lockBook(tx, ctx.book.id);
    const r = await tx.deleteRequest.findFirst({ where: { id: requestId, bookId: ctx.book.id } });
    assert(r, "DELETE_REQUEST_NOT_FOUND", "找不到刪除申請");
    assert(r.status === "PENDING", "DELETE_REQUEST_DONE", "這個申請已經處理過了");
    if (decision === "CANCEL") {
      assert(r.requestedById === ctx.me.userId, "DELETE_REQUEST_NOT_MINE", "只有申請的人可以取消");
    } else {
      assert(r.requestedById !== ctx.me.userId, "DELETE_REQUEST_SELF", "要由另一半確認刪除");
    }
    const type = r.entityType as DeletableType;
    if (decision === "APPROVE") {
      if (type === "GOAL") await performDeleteGoal(tx, ctx, r.entityId);
      else await performDeleteFund(tx, ctx, r.entityId);
    }
    const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "CANCELLED";
    await tx.deleteRequest.update({ where: { id: r.id }, data: { status, decidedById: ctx.me.userId, decidedAt: new Date() } });
    await auditIn(tx, ctx, `DELETE_${status}`, type === "GOAL" ? "Goal" : "Fund", r.entityId, null, { requestId: r.id });
    return { status, entityType: type, entityId: r.entityId };
  });
}

export async function pendingDeleteRequests(ctx: BookContext, filter: { entityType?: DeletableType; entityId?: string } = {}) {
  return prisma.deleteRequest.findMany({
    where: { bookId: ctx.book.id, status: "PENDING", ...filter },
    orderBy: { createdAt: "desc" },
  });
}
