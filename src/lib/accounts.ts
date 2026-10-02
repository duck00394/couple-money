/**
 * 帳戶類型的文案與圖示。
 *
 * 從 `src/server/services/ledger.ts` 搬出來的 —— 那個檔案 import 了 Prisma，
 * 所以 Client Component（例如試用模式的頁面）不能碰它，一碰整包 Prisma 就被拉進
 * 瀏覽器 bundle。這裡是純資料、零相依，兩邊都能用。
 * `ledger.ts` 仍然 re-export 這三個名字，既有的 import 路徑一行都不用改。
 */
import type { AccountType } from "@prisma/client";

export const ACCOUNT_TYPES = ["CASH", "BANK", "CREDIT_CARD", "E_WALLET", "JOINT", "OTHER"] as const;

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  CASH: "現金",
  BANK: "銀行帳戶",
  CREDIT_CARD: "信用卡",
  E_WALLET: "電子支付",
  JOINT: "共同帳戶",
  OTHER: "其他",
};

/** 帳戶類型的 icon key（見 `src/lib/icons.ts`），不是 emoji。 */
export const ACCOUNT_TYPE_ICON: Record<AccountType, string> = {
  CASH: "banknote",
  BANK: "landmark",
  CREDIT_CARD: "credit-card",
  E_WALLET: "smartphone",
  JOINT: "couple",
  OTHER: "wallet",
};
