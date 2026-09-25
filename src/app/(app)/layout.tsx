import { BottomNav } from "@/components/BottomNav";
import { ToastHost } from "@/components/Toast";
import { getAppContext } from "@/server/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await getAppContext(); // 未登入 → /login；沒有帳本 → /onboarding
  return (
    <>
      <main className="pb-24">{children}</main>
      <BottomNav />
      <ToastHost />
    </>
  );
}
