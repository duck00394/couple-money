import { ArtIcon } from "./ArtIcon";
/** 「個人帳戶／共同帳戶／共同基金／共同目標」的差別說明（可收合）。 */
export function MoneyConcepts({ open = false }: { open?: boolean }) {
  const rows = [
    ["banknote", "個人帳戶", "錢實際放在誰身上（現金、銀行、信用卡）。用個人帳戶付錢，會照分帳產生「誰欠誰」。"],
    ["couple", "共同帳戶", "兩人一起的錢實際放在哪裡。從共同帳戶付錢，不會產生個人欠款。"],
    ["piggy-bank", "共同基金", "把帳戶裡的錢「指定用途」，例如旅遊、租屋。投入不會移動錢、不算欠款，但不能超過帳戶「可自由使用」的金額。"],
    ["trophy", "尚未入金獎金", "完成任務獲得的獎金（扣掉懲罰），只是兩人的承諾，還不是現金。到基金頁「入金」後才變成實際基金金額。"],
    ["target", "共同目標", "想達成的結果。目前金額 = 連結基金的實際金額；尚未入金獎金另外顯示。"],
  ];
  return (
    <details className="group rounded-2xl bg-white p-4 text-sm shadow-sm" open={open} data-testid="money-concepts">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-stone-800">
        <span className="flex items-center gap-2"><ArtIcon name="lightbulb" size={16} />帳戶、基金、目標有什麼不同？</span>
        <span className="text-stone-400 transition group-open:rotate-90">›</span>
      </summary>
      <dl className="mt-3 space-y-2.5">
        {rows.map(([icon, title, desc]) => (
          <div key={title} className="flex gap-2">
            <dt className="shrink-0 pt-0.5 text-stone-400"><ArtIcon name={icon} size={16} /></dt>
            <dd><b>{title}</b>：<span className="text-stone-600">{desc}</span></dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 rounded-2xl bg-stone-100/70 px-3 py-2.5 text-xs leading-relaxed text-stone-500">
        例：共同帳戶實際餘額 $26,000，其中 $16,800 已指定給「日本旅遊基金」→ 可自由使用 $9,200；目標「日本旅行」目前 $16,800，另有尚未入金獎金 $120。
      </p>
    </details>
  );
}
