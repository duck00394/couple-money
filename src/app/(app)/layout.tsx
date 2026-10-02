import { BottomNav } from "@/components/BottomNav";
import { ToastHost } from "@/components/Toast";
import { getAppContext } from "@/server/context";
import { CurrencyProvider } from "@/components/CurrencyContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await getAppContext(); // 未登入 → /login；沒有帳本 → /onboarding
  return (
    // V15：把目前帳本的本位幣交給底下的 Client Component（useMoney()）
    <CurrencyProvider currency={ctx.book.baseCurrency}>
      <main className="pb-24">{children}</main>
      <BottomNav />
      <ToastHost />
    </CurrencyProvider>
  );
}
