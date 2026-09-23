import { TaskForm } from "@/components/TaskForm";
import { PageHeader } from "@/components/ui";
import { getAppContext } from "@/server/context";
import { assertCanWrite } from "@/server/services/books";
import { loadTaskFormProps, newTaskValues } from "@/server/taskFormData";

export default async function NewTaskPage() {
  const { ctx } = await getAppContext();
  assertCanWrite(ctx);
  const props = await loadTaskFormProps(ctx);
  return (
    <>
      <PageHeader title="新任務" back="/tasks" />
      <TaskForm {...props} values={newTaskValues(ctx, props.funds[0]?.id ?? null)} />
    </>
  );
}
