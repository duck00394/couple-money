"use client";

/**
 * 試用模式的記帳頁。
 *
 * 用的是**正式模式那個 `<TransactionForm>`**（830 行，含計算機、分帳方式、
 * 購買紀錄勾選⋯⋯），只把 `saveAction` 換成瀏覽器端的函式。
 * 兩邊讀同一份 FormData 契約（hidden input `payload` 的那包 JSON），
 * 所以朋友在試用模式填表的體驗跟正式一模一樣，但沒有任何一條路通到資料庫。
 */
import { useRouter } from "next/navigation";
import { TransactionForm } from "@/components/TransactionForm";
import { PageHeader } from "@/components/ui";
import { txActions } from "@/demo/actions";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoNewTransactionPage() {
  const { state, todayKey, runAll } = useDemo();
  const router = useRouter();
  const { save } = txActions(runAll, () => router.push("/demo"));

  return (
    <>
      <PageHeader title="記一筆" back="/demo" />
      <TransactionForm {...select.txFormOptions(state, todayKey)} saveAction={save} stayDisabled />
    </>
  );
}
