import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/server/auth/session";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/";
  if (await getCurrentUser()) redirect(nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/");
  return (
    <>
      <AuthForm mode="login" next={nextPath} />

      {/*
        試用入口。放在登入下面、用安靜的樣式 —— 這是「給朋友看看」的側門，
        不是跟登入並重的主要動作，所以不做成第二顆實心按鈕。
      */}
      <div className="mt-5 border-t border-line pt-5">
        <Link
          href="/demo"
          className="press block w-full rounded-full border-[1.5px] border-stone-800 bg-white px-4 py-2.5 text-center text-sm font-semibold text-stone-800 shadow-md"
          data-testid="demo-entry"
        >
          {/* 文案刻意避開「註冊」兩個字：登入頁本來就有一個「註冊」連結，
              兩個都含這個詞會讓既有的 E2E 選擇器一次抓到兩個元素。 */}
          試用看看
        </Link>
        <p className="mt-2 text-center text-xs leading-relaxed text-stone-500">
          用示範資料直接操作，不用帳號、資料不會儲存
        </p>
      </div>
    </>
  );
}
