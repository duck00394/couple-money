import { GoalForm } from "@/components/GoalForms";
import { Card, PageHeader } from "@/components/ui";
import { toDateKey } from "@/lib/dates";
import { getAppContext } from "@/server/context";
import { listFunds } from "@/server/services/funds";

export default async function NewGoalPage() {
  const { ctx } = await getAppContext();
  const funds = await listFunds(ctx);
  return (
    <>
      <PageHeader title="新目標" back="/goals" />
      <Card className="mx-4">
        <GoalForm
          funds={funds.map((f) => ({ id: f.id, name: `${f.emoji} ${f.name}` }))}
          values={{ name: "", description: "", emoji: "🎯", target: "", startDate: toDateKey(new Date()), deadline: "", fundId: "NEW", isActive: true }}
        />
      </Card>
    </>
  );
}
