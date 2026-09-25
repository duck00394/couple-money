/**
 * 「這筆獎勵／懲罰有沒有被提列走」的唯一判斷。
 *
 * 提列會在 TaskReward / TaskPenalty 上留下 withdrawalId，指向那筆 INCOME Transaction。
 * 但**光是有 withdrawalId 不代表已提列** —— 那筆收入可能已經被作廢，
 * 作廢時帳戶的錢已經退回去了，這時候還當它已提列，那筆錢就會兩邊都不在，
 * 而且取消打卡、刪除任務、免除懲罰全部會被擋住（「請先作廢那筆收入」——可是已經作廢了）。
 *
 * 所以一律看「那筆收入還在不在」：
 *   有 withdrawalId、而且那筆 Transaction 存在且沒被作廢  → 已提列
 *   沒有 withdrawalId／交易不存在／交易已作廢              → 沒有有效的提列
 */

/** 已經讀出關聯時用這個（in-memory 判斷）。 */
export const isWithdrawn = (row: { withdrawal?: { deletedAt: Date | null } | null }) =>
  !!row.withdrawal && row.withdrawal.deletedAt === null;

/** 查詢時用這個：挑出「沒有有效提列」的獎勵／懲罰。 */
export const NOT_WITHDRAWN = {
  OR: [
    { withdrawalId: null },                        // 從來沒提列過
    { withdrawal: { is: null } },                  // 指向的交易已經不存在
    { withdrawal: { deletedAt: { not: null } } },  // 指向的交易已作廢
  ],
};

/** 讀關聯時的 select，三個地方共用同一份。 */
export const WITHDRAWAL_SELECT = { select: { deletedAt: true } } as const;
