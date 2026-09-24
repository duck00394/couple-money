import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { CreateBookForm, JoinBookForm } from "@/components/BookForms";
import { Card } from "@/components/ui";
import { requireUser } from "@/server/auth/session";
import { getBookContext } from "@/server/services/books";

export default async function OnboardingPage() {
  const user = await requireUser();
  if (await getBookContext(user.id)) redirect("/");
  return (
    <main className="px-5 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-stone-800">嗨，{user.name}</h1>
      <p className="mt-1 text-sm leading-relaxed text-stone-500">先建立你們的共同帳本，或輸入另一半給你的邀請碼。</p>

      <Card className="mt-6">
        <h2 className="mb-3 font-semibold text-stone-800">建立新帳本</h2>
        <CreateBookForm defaultNickname={user.name} />
      </Card>

      <div className="my-5 flex items-center gap-3 text-sm text-stone-400">
        <span className="h-px flex-1 bg-stone-200" />或<span className="h-px flex-1 bg-stone-200" />
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-stone-800">我有邀請碼</h2>
        <JoinBookForm defaultNickname={user.name} />
      </Card>

      <form action={logoutAction} className="mt-8 text-center">
        <button className="text-sm text-stone-500 underline underline-offset-2">登出（{user.email}）</button>
      </form>
    </main>
  );
}
