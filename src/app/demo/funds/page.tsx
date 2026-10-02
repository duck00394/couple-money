"use client";

/**
 * 試用模式的基金頁。
 *
 * 基金餘額 = Σ FundTransaction（跟正式模式同一個定義，資料庫不存餘額欄位）。
 * 這裡可以新增基金、也可以投入金額。
 */
import { useState } from "react";
import { ArtTile } from "@/components/ArtIcon";
import { Button, Card, ErrorText, Field, Input, PageHeader, SectionTitle } from "@/components/ui";
import { formatMoney, parseAmount } from "@/lib/money";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";

export default function DemoFundsPage() {
  const { state, run, todayKey } = useDemo();
  const funds = select.funds(state);
  const available = select.availableMoney(state);

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [addError, setAddError] = useState<string>();

  // 哪個基金正在輸入投入金額
  const [depositFor, setDepositFor] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositError, setDepositError] = useState<string>();

  const addFund = () => {
    const r = run({
      kind: "fund.add",
      name,
      icon: "piggy-bank",
      targetAmount: parseAmount(target) ?? 0,
    });
    setAddError(r?.error);
    if (!r?.error) {
      setName("");
      setTarget("");
    }
  };

  const deposit = (fundId: string) => {
    const amount = parseAmount(depositAmount);
    if (!amount) {
      setDepositError("請輸入金額");
      return;
    }
    const r = run({ kind: "fund.deposit", fundId, amount, occurredOn: todayKey, note: "" });
    setDepositError(r?.error);
    if (!r?.error) {
      setDepositAmount("");
      setDepositFor(null);
    }
  };

  return (
    <>
      <PageHeader title="基金" back="/demo" />
      <div className="px-4">
        <Card className="px-5 py-4" data-testid="demo-fund-summary">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-stone-500">可以自由用的錢</p>
              <p className="amount mt-0.5 text-[1.9rem] text-stone-800">{formatMoney(available.free)}</p>
            </div>
            <div className="text-right text-xs text-stone-500">
              <p>帳上共 {formatMoney(available.total)}</p>
              <p className="mt-0.5">已存進基金 {formatMoney(available.earmarked)}</p>
            </div>
          </div>
        </Card>

        <SectionTitle>目標</SectionTitle>
        <div className="space-y-2.5">
          {funds.map((f) => (
            <Card key={f.id} className="px-4 py-3.5" data-testid="demo-fund-card">
              <div className="flex items-center gap-3">
                <ArtTile name={f.icon} tone="brand" size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-stone-800">{f.name}</p>
                  <p className="tnum truncate text-xs text-stone-500">
                    {formatMoney(f.balance)} / {formatMoney(f.targetAmount)}
                    <span className="ml-1.5 text-stone-400">{Math.round(f.progress * 100)}%</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDepositFor(depositFor === f.id ? null : f.id);
                    setDepositAmount("");
                    setDepositError(undefined);
                  }}
                  className="press shrink-0 rounded-full border-[1.5px] border-stone-800 bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-md"
                  data-testid="demo-fund-deposit-open"
                >
                  存錢
                </button>
              </div>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-stone-200">
                <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${f.progress * 100}%` }} />
              </div>

              {depositFor === f.id && (
                <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                  <Field label="要存多少">
                    <Input
                      inputMode="decimal"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="0"
                      data-testid="demo-fund-amount"
                      autoFocus
                    />
                  </Field>
                  <ErrorText>{depositError}</ErrorText>
                  <Button onClick={() => deposit(f.id)} data-testid="demo-fund-deposit-submit">存進「{f.name}」</Button>
                </div>
              )}

              {/* 這個基金的投入紀錄 */}
              {state.fundTxs.filter((t) => t.fundId === f.id).length > 0 && (
                <ul className="mt-2.5 space-y-1 border-t border-line pt-2.5 text-xs text-stone-500">
                  {state.fundTxs
                    .filter((t) => t.fundId === f.id)
                    .slice()
                    .reverse()
                    .slice(0, 4)
                    .map((t) => (
                      <li key={t.id} className="flex justify-between gap-2">
                        <span className="truncate">{t.occurredOn}{t.note && `・${t.note}`}</span>
                        <span className="tnum shrink-0">+{formatMoney(t.amount)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          ))}
        </div>

        <SectionTitle>新增基金</SectionTitle>
        <Card className="space-y-3.5">
          <Field label="名稱">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：換冰箱" data-testid="demo-fund-name" />
          </Field>
          <Field label="目標金額" hint="可以先不填">
            <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" />
          </Field>
          <ErrorText>{addError}</ErrorText>
          <Button onClick={addFund} disabled={!name.trim()} data-testid="demo-fund-submit">新增基金</Button>
        </Card>

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          存進基金的錢<b className="text-stone-700">還在帳戶裡</b>，只是被標記成「已經有用途」，
          所以「可以自由用的錢」會扣掉它。試用模式用的是同一份 <code className="text-[11px]">freeAmount</code> 定義。
        </p>
      </div>
    </>
  );
}
