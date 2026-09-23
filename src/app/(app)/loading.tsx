import { Skeleton } from "@/components/ui";

/** 換頁時的骨架畫面：手機上點下去要馬上有反應。 */
export default function AppLoading() {
  return (
    <div className="px-4 pt-5" role="status" aria-label="載入中" data-testid="page-loading">
      <Skeleton className="mb-4 h-6 w-32 rounded-lg" />
      <Skeleton className="mb-3 h-24" />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
    </div>
  );
}
