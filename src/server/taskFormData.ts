import type { TaskFormValues } from "@/components/TaskForm";
import type { BookContext } from "./services/books";
import { listFunds } from "./services/funds";
import { DEFAULT_MILESTONES } from "./services/tasks";

export async function loadTaskFormProps(ctx: BookContext) {
  const funds = await listFunds(ctx, { includeArchived: true });
  return {
    me: { userId: ctx.me.userId, nickname: ctx.me.nickname },
    partner: ctx.partner ? { userId: ctx.partner.userId, nickname: ctx.partner.nickname } : null,
    funds: funds.map((f) => ({ id: f.id, name: `${f.name}${f.isArchived ? "（封存）" : ""}` })),
  };
}

export function newTaskValues(ctx: BookContext, fundId: string | null): TaskFormValues {
  return {
    title: "",
    description: "",
    emoji: "check-circle",
    scope: "PERSONAL",
    assigneeId: ctx.me.userId,
    frequency: "DAILY",
    daysOfWeek: 127,
    requiresApproval: false,
    requiresPhoto: false,
    rewardAmount: 0,
    fundId,
    penaltyAmount: 0,
    penaltyText: "",
    isActive: true,
    milestones: DEFAULT_MILESTONES.map((m) => ({ ...m, bonusAmount: 0, rewardText: "" })),
  };
}
