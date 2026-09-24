import { FundForm } from "@/components/FundForms";
import { Card, PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";

export default async function NewFundPage() {
  await getAppContext();
  return (
    <>
      <PageHeader title="新基金" back="/goals" />
      <Card className="mx-4">
        <FundForm values={{ name: "", emoji: "piggy-bank", description: "", target: "", dueDate: "" }} />
      </Card>
    </>
  );
}
