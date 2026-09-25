import Link from "next/link";
import { JoinBookForm } from "@/components/BookForms";
import { Card, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/server/auth/session";
import { getBookContext, previewInvite } from "@/server/services/books";
import { ArtIcon } from "@/components/ArtIcon";

export default async function InvitePage({ params }: PageProps<"/invite/[code]">) {
  const { code } = await params;
  const invite = await previewInvite(code);
  const user = await getCurrentUser();
  const next = `/invite/${encodeURIComponent(code)}`;

  let body: React.ReactNode;
  if (!invite || invite.invalidReason) {
    body = (
      <>
        <p className="text-stone-600">{invite?.invalidReason ?? "找不到這個邀請碼"}</p>
        <LinkButton href="/" variant="secondary" className="mt-4">回首頁</LinkButton>
      </>
    );
  } else if (!user) {
    body = (
      <>
        <p className="text-stone-600">登入或註冊後就能加入。</p>
        <div className="mt-4 grid gap-3">
          <LinkButton href={`/register?next=${encodeURIComponent(next)}`}>註冊新帳號</LinkButton>
          <LinkButton href={`/login?next=${encodeURIComponent(next)}`} variant="secondary">我已經有帳號</LinkButton>
        </div>
      </>
    );
  } else {
    const current = await getBookContext(user.id);
    body = (
      <>
        {current && (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            你目前已經有帳本「{current.book.name}」，加入後會切換到新的帳本。
          </p>
        )}
        <JoinBookForm code={invite.code} lockCode defaultNickname={user.name} />
      </>
    );
  }

  return (
    <main className="px-5 py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-100 text-brand-700 shadow-sm"><ArtIcon name="mail" size={30} /></div>
        <h1 className="mt-3 text-xl font-bold">
          {invite && !invite.invalidReason ? `${invite.inviterName} 邀請你加入「${invite.bookName}」` : "邀請連結"}
        </h1>
      </div>
      <Card>{body}</Card>
      <p className="mt-6 text-center text-sm text-stone-400">
        <Link href="/">Couple Money</Link>
      </p>
    </main>
  );
}
