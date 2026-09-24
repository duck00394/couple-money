import Link from "next/link";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { ArtIcon } from "@/components/ArtIcon";

/** 找不到資料（例如另一半剛剛把這筆刪掉了）。 */
export default function AppNotFound() {
  return (
    <>
      <PageHeader title="找不到這筆資料" />
      <div className="px-4">
        <Card className="space-y-3 text-center">
          <p className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400"><ArtIcon name="search" size={22} /></p>
          <p className="text-sm text-stone-600">
            這筆資料可能已經被刪除，或是連結不正確。
            <br />
            如果是另一半剛剛刪掉的，重新整理列表就會看到最新狀態。
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <LinkButton href="/transactions" variant="secondary">回記帳</LinkButton>
            <LinkButton href="/">回首頁</LinkButton>
          </div>
          <Link href="/more" className="block pt-1 text-xs text-stone-400 underline">其他功能</Link>
        </Card>
      </div>
    </>
  );
}
