"use client";

import { useEffect } from "react";
import { Button, Card, LinkButton, PageHeader } from "@/components/ui";

/** 頁面載入失敗時的畫面（取代 Next.js 預設的英文錯誤頁）。 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <>
      <PageHeader title="載入失敗" />
      <div className="px-4">
        <Card className="space-y-3 text-center">
          <p className="text-4xl">😵</p>
          <p className="text-sm text-stone-600">
            這個畫面載入時發生問題，資料沒有被改動。
            <br />
            可以再試一次，或先回首頁。
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button variant="secondary" onClick={() => reset()}>再試一次</Button>
            <LinkButton href="/">回首頁</LinkButton>
          </div>
        </Card>
      </div>
    </>
  );
}
