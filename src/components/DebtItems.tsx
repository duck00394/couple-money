import type { ReactNode } from "react";
import { moneyFmt } from "@/lib/money";
import { ArtTile } from "./ArtIcon";
import { Card, cx } from "./ui";

export interface DebtItemView {
  id: string;
  dateKey: string;
  title: string;
  icon: string;
  amount: number;
  myShare: number;
  owed: number;
  settled: number;
  remaining: number;
}

/**
 * 逐筆欠款的一列。可勾選與唯讀兩種畫面共用同一份排版，
 * 差別只在有沒有傳 `checkbox` 進來——兩個人打開結算頁看到的東西才會一致。
 */
export function DebtItemRow({ currency, item, checkbox, shareLabel }: { currency: string;
  item: DebtItemView;
  checkbox?: ReactNode;
  /** 「我應負擔」在唯讀畫面要改成對方的名字 */
  shareLabel: string;
}) {
  const fmtMoney = moneyFmt(currency);
  const done = item.remaining === 0;
  return (
    <>
      {checkbox}
      <ArtTile name={item.icon} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-stone-800">{item.title}</p>
        {/* 390px 一行塞不下四個欄位，拆兩行才不會被截掉 */}
        <p className="truncate text-xs text-stone-500">
          {item.dateKey.replaceAll("-", "/")}・原始 {fmtMoney(item.amount)}
        </p>
        <p className="truncate text-[11px] text-stone-400">
          {shareLabel} {fmtMoney(item.myShare)}
          {item.settled > 0 && `・已沖銷 ${fmtMoney(item.settled)} / ${fmtMoney(item.owed)}`}
        </p>
      </div>
      <span className={cx("tnum shrink-0 text-[15px]", done ? "text-stone-400" : "font-semibold text-brand-700")}>
        {done ? "已還清" : fmtMoney(item.remaining)}
      </span>
    </>
  );
}

/**
 * 唯讀的逐筆欠款：給「對方欠我」的那一方看。
 *
 * 只是把同一份推導結果換個方式呈現，沒有 checkbox、也沒有還款按鈕——
 * 錢是對方要付的，不該由我在自己的手機上代替他勾選。
 * 真的收到錢時，用下面那個表單記一筆就好。
 */
export function DebtItemList({ currency, items, ownerName }: { currency: string; items: DebtItemView[]; ownerName: string }) {
  const open = items.filter((i) => i.remaining > 0);
  const settled = items.length - open.length;
  return (
    <div data-testid="debt-readonly">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[13px] font-semibold text-stone-700">{ownerName}還沒還的項目</span>
        <span className="tnum text-xs text-stone-400">{open.length} 筆</span>
      </div>
      <Card className="divide-y divide-line p-0">
        {open.length === 0 && <p className="px-5 py-6 text-center text-sm text-stone-500">目前沒有欠款項目</p>}
        {/* 唯讀畫面只列「還沒還的」——看的人想知道的是還剩什麼，不是已經還過什麼 */}
        {open.map((i) => (
          <div
            key={i.id}
            data-testid="debt-item"
            data-title={i.title}
            data-remaining={i.remaining}
            data-paid={i.remaining === 0 ? "1" : "0"}
            className={cx("flex items-center gap-3 px-4 py-3", i.remaining === 0 && "opacity-55")}
          >
            <DebtItemRow currency={currency} item={i} shareLabel={`${ownerName}應負擔`} />
          </div>
        ))}
      </Card>
      {settled > 0 && <p className="mt-1.5 px-1 text-[11px] text-stone-400">另有 {settled} 筆已經還清了</p>}
      <p className="mt-2 rounded-xl bg-canvas/70 px-3 py-2 text-xs leading-relaxed text-stone-600">
        這些是{ownerName}還沒還的部分。錢要由{ownerName}付，所以這裡只能看不能勾；
        真的收到錢之後，用下面的表單記一筆就好。
      </p>
    </div>
  );
}
