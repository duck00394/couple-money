"use client";

/**
 * 試用模式的結算頁。
 *
 * 可結算上限由 `maxSettleAmount()` 算出來（跟正式模式同一份），
 * 所以不可能結算超過實際欠的金額 —— 試用模式也擋得住。
 */
import { useState } from "react";
import { DebtCard } from "@/components/DebtCard";
import { Button, Card, Empty, ErrorText, Field, Input, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney, parseAmount, toInputString } from "@/lib/money";
import { maxSettleAmount } from "@/server/domain/balance";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoSettlePage() {
  const { state, run, todayKey } = useDemo();
  const ctx = select.demoCtx(state);
  const bal = select.balances(state);
  const debt = bal.debts[0];

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [ok, setOk] = useState<string>();

  const max = debt ? maxSettleAmount(bal.net, debt.from, debt.to) : 0;
  const nameOf = (id: string) => state.users.find((u) => u.id === id)?.nickname ?? "";

  const settled = select
    .sortedTxs(state)
    .filter((t) => t.type === "SETTLEMENT");

  const submit = () => {
    if (!debt) return;
    const value = parseAmount(amount);
    if (!value) {
      setError("請輸入金額");
      return;
    }
    if (value > max) {
      setError(`最多只能結算 ${formatMoney(max)}`);
      return;
    }
    const r = run({
      kind: "settle",
      fromUserId: debt.from,
      toUserId: debt.to,
      amount: value,
      occurredOn: todayKey,
      note,
    });
    setError(r?.error);
    setOk(r?.error ? undefined : "已記錄結算");
    if (!r?.error) {
      setAmount("");
      setNote("");
    }
  };

  return (
    <>
      <PageHeader title="結算" back="/demo" />
      <div className="px-4">
        <DebtCard ctx={ctx} debt={debt} compact base="/demo" />

        {debt ? (
          <>
            <SectionTitle>記一筆結算</SectionTitle>
            <Card className="space-y-3.5" data-testid="demo-settle-form">
              <p className="text-sm text-stone-600">
                <b>{nameOf(debt.from)}</b> 還給 <b>{nameOf(debt.to)}</b>
                <span className="ml-1.5 text-xs text-stone-400">最多 {formatMoney(max)}</span>
              </p>
              <Field label="金額">
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={toInputString(max)}
                  data-testid="demo-settle-amount"
                />
              </Field>
              <button
                type="button"
                onClick={() => setAmount(toInputString(max))}
                className="text-sm font-semibold text-brand-600"
                data-testid="demo-settle-all"
              >
                全部還清（{formatMoney(max)}）
              </button>
              <Field label="備註" hint="可以不填">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：轉帳給你了" />
              </Field>
              <ErrorText>{error}</ErrorText>
              {ok && <p className="text-sm font-semibold text-brand-700">{ok}</p>}
              <Button onClick={submit} data-testid="demo-settle-submit">記錄結算</Button>
            </Card>
          </>
        ) : (
          <Card quiet className="mt-3 p-0">
            <Empty icon="settle">目前互不相欠，沒有需要結算的</Empty>
          </Card>
        )}

        <SectionTitle>結算紀錄</SectionTitle>
        {settled.length === 0 ? (
          <Card quiet className="p-0">
            <Empty icon="settle">還沒有任何結算</Empty>
          </Card>
        ) : (
          <Card className="divide-y divide-line p-0" data-testid="demo-settle-history">
            {settled.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium text-stone-800">
                    {nameOf(t.settlement?.fromUserId ?? "")} → {nameOf(t.settlement?.toUserId ?? "")}
                  </p>
                  <p className="truncate text-xs text-stone-500">{t.occurredOn}{t.note && `・${t.note}`}</p>
                </div>
                <span className="amount shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 text-[15px] text-brand-700">
                  {formatMoney(t.amount)}
                </span>
              </div>
            ))}
          </Card>
        )}

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          結算本身也是一筆交易（Σpayment = 0、沒有分帳），所以它會把欠款推回去，
          但不會被算進收支統計。
        </p>
      </div>
    </>
  );
}
