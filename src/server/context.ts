import { redirect } from "next/navigation";
import { cache } from "react";
import { requireUser } from "./auth/session";
import { getBookContext } from "./services/books";

/** App 頁面共用：必須登入且已有帳本，否則導向登入／建立帳本。 */
export const getAppContext = cache(async () => {
  const user = await requireUser();
  const ctx = await getBookContext(user.id);
  if (!ctx) redirect("/onboarding");
  return { user, ctx };
});
