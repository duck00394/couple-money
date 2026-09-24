import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getCurrentUser } from "@/server/auth/session";

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/";
  if (await getCurrentUser()) redirect(nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/");
  return <AuthForm mode="register" next={nextPath} />;
}
