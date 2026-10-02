/**
 * Demo 的 reducer（純函式，沒有任何 I/O）。
 *
 * 分錄一律交給 `src/server/domain/ledger.ts` 的 `buildFlowLines` /
 * `buildSettlementLines` 產生 —— 跟正式模式**同一個函式**。
 * 所以 Demo 的 Σpayment === Σsplit、帳戶餘額 = −Σpayment、欠款零和這些不變量
 * 是被同一份程式保證的，不是另外手寫一套近似值。
 *
 * 這裡不碰 Prisma、不碰 fetch、不碰 localStorage。要它變慢或寫到資料庫都做不到。
 */
import { buildFlowLines, buildSettlementLines, type AccountRef } from "@/server/domain/ledger";
import { DomainError, assert } from "@/server/domain/errors";
import { assertRate, toBaseAmount } from "@/server/domain/exchange";
import type { DemoOp, DemoState, DemoTx, TxInput } from "./types";

/** 產生 Demo 的 id。流水號而不是 cuid —— Demo 不需要防碰撞，可重現比較好除錯。 */
const nextId = (s: DemoState, prefix: string) => `${prefix}_${s.seq}`;

const accountRef = (s: DemoState, accountId: string): AccountRef => {
  const a = s.accounts.find((x) => x.id === accountId);
  if (!a) throw new DomainError("ACCOUNT_NOT_FOUND", "找不到帳戶");
  return { id: a.id, ownerId: a.ownerId };
};

/**
 * 由 TxInput 產生一筆完整的 DemoTx（含 payments / splits）。
 *
 * V14：外幣的處理跟正式模式**完全一樣** —— 本位幣金額由原幣 × 當下匯率算出來
 * （同一個 toBaseAmount），匯率鎖在這筆交易上。所以試用模式裡改匯率也只影響新交易。
 */
function buildTx(s: DemoState, id: string, input: TxInput): DemoTx {
  const money = resolveMoney(s, input);
  assert(money.amount > 0, "TX_AMOUNT", "金額必須大於 0");
  const payers = input.payers.map((p) => ({ account: accountRef(s, p.accountId), amount: money.amount }));
  const lines = buildFlowLines(input.type, money.amount, payers, input.rule);
  return {
    id,
    type: input.type,
    title: input.title,
    amount: money.amount,
    currency: money.currency,
    foreignAmount: money.foreignAmount,
    rateForeignUnits: money.rateForeignUnits,
    rateBaseMinor: money.rateBaseMinor,
    occurredOn: input.occurredOn,
    categoryId: input.categoryId,
    note: input.note ?? "",
    payments: lines.payments,
    splits: lines.splits,
    settlement: null,
    fundId: input.fundId ?? null,
    tags: input.tags ?? [],
  };
}

/**
 * 決定這筆的幣別、匯率與本位幣金額。對應正式模式 services/ledger.ts 的同名函式。
 * 找不到匯率就擋下來，不會偷偷當成 1:1。
 */
function resolveMoney(s: DemoState, input: TxInput) {
  const code = (input.currency || s.baseCurrency).toUpperCase();
  if (code === s.baseCurrency) {
    return {
      amount: input.amount,
      currency: s.baseCurrency,
      foreignAmount: null as number | null,
      rateForeignUnits: null as number | null,
      rateBaseMinor: null as number | null,
    };
  }
  const r = s.rates.find((x) => x.currency === code);
  assert(!!r, "RATE_MISSING", `還沒設定 ${code} 的匯率`);
  const foreign = input.foreignAmount ?? 0;
  assert(Number.isSafeInteger(foreign) && foreign > 0, "TX_AMOUNT", "金額必須大於 0");
  return {
    amount: toBaseAmount(foreign, { currency: code, foreignUnits: r!.foreignUnits, baseMinor: r!.baseMinor }),
    currency: code,
    foreignAmount: foreign,
    rateForeignUnits: r!.foreignUnits,
    rateBaseMinor: r!.baseMinor,
  };
}

/** 這個人的個人帳戶（結算要用）。 */
function personalAccount(s: DemoState, userId: string) {
  const a = s.accounts.find((x) => x.ownerId === userId && x.isActive);
  if (!a) throw new DomainError("SETTLE_PERSONAL", "這個人還沒有個人帳戶");
  return { id: a.id, ownerId: userId };
}

/** 任務在某一天是否要做。weekdays 空陣列 = 每天。 */
export function taskDueOn(task: { weekdays: number[] }, dateKey: string): boolean {
  if (task.weekdays.length === 0) return true;
  // 用 UTC 解析，避免瀏覽器時區把日期推前一天
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return task.weekdays.includes(dow);
}

/**
 * 套用一個操作，回傳**新的** state（不修改傳入的 state）。
 *
 * 丟出 DomainError 時呼叫端要把訊息顯示給使用者 —— 跟正式模式的 server action
 * 一樣的錯誤型別，所以表單的錯誤顯示不用改。
 */
export function applyOp(state: DemoState, op: DemoOp): DemoState {
  const s: DemoState = { ...state, seq: state.seq + 1 };

  switch (op.kind) {
    case "tx.add": {
      const tx = buildTx(s, nextId(s, "tx"), op.input);
      return { ...s, txs: [...s.txs, tx] };
    }

    case "tx.update": {
      const old = s.txs.find((t) => t.id === op.id);
      assert(!!old, "TX_NOT_FOUND", "找不到這筆紀錄");
      assert(
        old!.type === "EXPENSE" || old!.type === "INCOME" || old!.type === "REFUND",
        "TX_NOT_EDITABLE",
        "這個類型不能直接編輯",
      );
      const tx = buildTx(s, op.id, op.input);
      return { ...s, txs: s.txs.map((t) => (t.id === op.id ? tx : t)) };
    }

    case "tx.delete": {
      const old = s.txs.find((t) => t.id === op.id);
      assert(!!old, "TX_NOT_FOUND", "找不到這筆紀錄");
      assert(old!.type !== "SETTLEMENT", "TX_NOT_DELETABLE", "結算要到結算頁取消");
      return {
        ...s,
        txs: s.txs.filter((t) => t.id !== op.id),
        // 購買紀錄若是從這筆記帳來的，連結要斷掉（Demo 直接轉成手動紀錄，跟正式行為一致）
        purchaseEntries: s.purchaseEntries.map((e) =>
          e.transactionId === op.id ? { ...e, transactionId: null } : e,
        ),
      };
    }

    case "account.add": {
      assert(op.name.trim().length > 0, "ACCOUNT_NAME", "請輸入帳戶名稱");
      return {
        ...s,
        accounts: [
          ...s.accounts,
          { id: op.id ?? nextId(s, "acc"), name: op.name.trim(), type: op.type, ownerId: op.ownerId, isActive: true },
        ],
      };
    }

    case "account.opening": {
      // 期初餘額：只有 payment、沒有 split，不影響欠款（跟 domain/ledger.ts 的不變式一致）。
      // payment 為負 = 錢流入帳戶；餘額 = −Σpayment，所以 −10000 會變成餘額 +100.00
      assert(op.amount > 0, "TX_AMOUNT", "期初餘額必須大於 0");
      const acc = accountRef(s, op.accountId);
      const tx: DemoTx = {
        id: nextId(s, "tx"),
        type: "OPENING_BALANCE",
        title: "期初餘額",
        amount: op.amount,
        occurredOn: op.occurredOn,
        categoryId: null,
        note: "",
        payments: [{ accountId: acc.id, userId: acc.ownerId, amount: -op.amount }],
        splits: [],
        settlement: null,
        currency: s.baseCurrency,
        foreignAmount: null,
        rateForeignUnits: null,
        rateBaseMinor: null,
        fundId: null,
        tags: [],
      };
      return { ...s, txs: [...s.txs, tx] };
    }

    case "fund.add": {
      assert(op.name.trim().length > 0, "FUND_NAME", "請輸入基金名稱");
      return {
        ...s,
        funds: [
          ...s.funds,
          { id: op.id ?? nextId(s, "fund"), name: op.name.trim(), icon: op.icon, targetAmount: op.targetAmount, isArchived: false },
        ],
      };
    }

    case "fund.deposit": {
      assert(op.amount > 0, "FUND_AMOUNT", "投入金額必須大於 0");
      assert(s.funds.some((f) => f.id === op.fundId), "FUND_NOT_FOUND", "找不到基金");
      return {
        ...s,
        fundTxs: [
          ...s.fundTxs,
          { id: nextId(s, "ftx"), fundId: op.fundId, amount: op.amount, occurredOn: op.occurredOn, note: op.note ?? "" },
        ],
      };
    }

    case "task.add": {
      assert(op.name.trim().length > 0, "TASK_NAME", "請輸入任務名稱");
      return {
        ...s,
        tasks: [
          ...s.tasks,
          {
            id: op.id ?? nextId(s, "task"),
            name: op.name.trim(),
            icon: op.icon,
            assigneeId: op.assigneeId,
            rewardAmount: op.rewardAmount,
            weekdays: op.weekdays,
          },
        ],
      };
    }

    case "task.checkIn": {
      const task = s.tasks.find((t) => t.id === op.taskId);
      assert(!!task, "TASK_NOT_FOUND", "找不到任務");
      assert(taskDueOn(task!, op.dateKey), "TASK_NOT_DUE", "今天沒有排這個任務");
      const dup = s.checkIns.some(
        (c) => c.taskId === op.taskId && c.userId === op.userId && c.dateKey === op.dateKey,
      );
      assert(!dup, "CHECKIN_DUPLICATE", "今天已經打過卡了");
      return {
        ...s,
        checkIns: [
          ...s.checkIns,
          {
            id: nextId(s, "ci"),
            taskId: op.taskId,
            userId: op.userId,
            dateKey: op.dateKey,
            rewardAmount: task!.rewardAmount,
          },
        ],
      };
    }

    case "task.undoCheckIn":
      return {
        ...s,
        checkIns: s.checkIns.filter(
          (c) => !(c.taskId === op.taskId && c.userId === op.userId && c.dateKey === op.dateKey),
        ),
      };

    case "settle": {
      assert(op.amount > 0, "TX_AMOUNT", "金額必須大於 0");
      const from = personalAccount(s, op.fromUserId);
      const to = personalAccount(s, op.toUserId);
      const lines = buildSettlementLines(op.amount, from, to);
      const tx: DemoTx = {
        id: nextId(s, "tx"),
        type: "SETTLEMENT",
        title: "結算",
        amount: op.amount,
        occurredOn: op.occurredOn,
        categoryId: null,
        note: op.note ?? "",
        payments: lines.payments,
        splits: lines.splits,
        settlement: { fromUserId: op.fromUserId, toUserId: op.toUserId },
        currency: s.baseCurrency,
        foreignAmount: null,
        rateForeignUnits: null,
        rateBaseMinor: null,
        fundId: null,
        tags: [],
      };
      return { ...s, txs: [...s.txs, tx] };
    }

    case "preorder.add": {
      const id = nextId(s, "po");
      return {
        ...s,
        preorders: [
          ...s.preorders,
          {
            ...op.input,
            id,
            items: op.input.items.map((it, i) => ({ ...it, id: `${id}_i${i}` })),
          },
        ],
      };
    }

    case "purchase.add":
      return { ...s, purchaseEntries: [...s.purchaseEntries, { ...op.input, id: nextId(s, "pe") }] };

    case "purchase.remove":
      return { ...s, purchaseEntries: s.purchaseEntries.filter((e) => e.id !== op.id) };

    case "rate.set": {
      // 只改設定，不碰任何既有交易 —— 跟正式模式一樣，歷史金額不會變
      assertRate(op);
      const rest = s.rates.filter((r) => r.currency !== op.currency);
      return {
        ...s,
        rates: [...rest, { currency: op.currency, foreignUnits: op.foreignUnits, baseMinor: op.baseMinor }]
          .sort((a, b) => a.currency.localeCompare(b.currency)),
      };
    }

    default: {
      const never: never = op;
      throw new DomainError("DEMO_UNKNOWN_OP", `不支援的操作：${JSON.stringify(never)}`);
    }
  }
}

/** 把一串操作依序套用。預設資料就是這樣跑出來的。 */
export const applyOps = (state: DemoState, ops: DemoOp[]): DemoState => ops.reduce(applyOp, state);
