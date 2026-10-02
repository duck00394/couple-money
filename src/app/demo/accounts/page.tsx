"use client";

/** 試用模式的帳戶頁。餘額一律由 `accountBalances()`（−Σpayment）算出來，不存欄位。 */
import { useState } from "react";
import { ArtTile } from "@/components/ArtIcon";
import { Button, Card, ErrorText, Field, Input, PageHeader, SectionTitle, Select } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABEL } from "@/lib/accounts";
import * as select from "@/demo/select";
import { useDemo } from "@/demo/store";
import type { DemoAccount } from "@/demo/types";

const TYPES: Array<DemoAccount["type"]> = ["CASH", "BANK", "CREDIT_CARD", "E_WALLET", "JOINT", "OTHER"];

export default function DemoAccountsPage() {
  const { state, run } = useDemo();
  const accounts = select.accounts(state);
  const [name, setName] = useState("");
  const [type, setType] = useState<DemoAccount["type"]>("CASH");
  const [owner, setOwner] = useState<string>("JOINT");
  const [error, setError] = useState<string>();

  const nameOf = (id: string | null) =>
    id === null ? "共同" : state.users.find((u) => u.id === id)?.nickname ?? "";

  const groups = [
    { label: "共同", items: accounts.filter((a) => a.ownerId === null) },
    ...state.users.map((u) => ({ label: u.nickname, items: accounts.filter((a) => a.ownerId === u.id) })),
  ].filter((g) => g.items.length > 0);

  const submit = () => {
    const r = run({ kind: "account.add", name, type, ownerId: owner === "JOINT" ? null : owner });
    setError(r?.error);
    if (!r?.error) setName("");
  };

  return (
    <>
      <PageHeader title="帳戶" back="/demo" />
      <div className="px-4">
        {groups.map((g) => (
          <div key={g.label}>
            <SectionTitle>{g.label}</SectionTitle>
            <Card className="divide-y divide-line p-0">
              {g.items.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3" data-testid="demo-account-row">
                  <ArtTile name={a.ownerId === null ? "users" : "wallet"} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-stone-800">{a.name}</p>
                    <p className="truncate text-xs text-stone-500">
                      {ACCOUNT_TYPE_LABEL[a.type]}・{nameOf(a.ownerId)}
                    </p>
                  </div>
                  <span className="amount shrink-0 text-[15px] text-stone-800">{formatMoney(a.balance)}</span>
                </div>
              ))}
            </Card>
          </div>
        ))}

        <SectionTitle>新增帳戶</SectionTitle>
        <Card className="space-y-3.5">
          <Field label="名稱">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：旅遊專用卡" data-testid="demo-account-name" />
          </Field>
          <Field label="類型">
            <Select value={type} onChange={(e) => setType(e.target.value as DemoAccount["type"])}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="屬於誰">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="JOINT">共同</option>
              {state.users.map((u) => <option key={u.id} value={u.id}>{u.nickname}</option>)}
            </Select>
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button onClick={submit} disabled={!name.trim()} data-testid="demo-account-submit">新增帳戶</Button>
        </Card>

        <p className="mt-4 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600">
          帳戶餘額是<b className="text-stone-700">現算</b>的（全部付款紀錄加總的負數），
          資料庫裡沒有「餘額」這個欄位 —— 試用模式也用同一份算法。
        </p>
      </div>
    </>
  );
}
