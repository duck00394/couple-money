/**
 * 現有資料完整性檢查（唯讀，不會修改任何資料）。
 * 用法：DATABASE_URL=... npx tsx scripts/data-integrity-check.ts
 *
 * 檢查這次驗收修正的 11 個 Bug 在修正前有沒有已經產生髒資料，以及跨帳本的孤兒關聯。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REAL_FUND_TYPES = ["DEPOSIT", "WITHDRAW", "EXPENSE", "REWARD_DEPOSIT"] as const;
const money = (v: number) => `$${(v / 100).toLocaleString("en-US")}`;

type Finding = { table: string; id: string; problem: string };
const findings: Finding[] = [];
const add = (table: string, id: string, problem: string) => findings.push({ table, id, problem });

async function main() {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop();
  console.log(`\n=== 資料完整性檢查：${db} ===`);
  const counts = {
    book: await prisma.book.count(),
    account: await prisma.account.count(),
    transaction: await prisma.transaction.count(),
    fund: await prisma.fund.count(),
    task: await prisma.task.count(),
    recurring: await prisma.recurringExpense.count(),
  };
  console.log("資料量：", JSON.stringify(counts));

  // 1. 帳戶餘額 < 已指定給基金（基金帳上有、實際沒有）
  const payments = await prisma.transactionPayment.findMany({
    where: { transaction: { deletedAt: null, status: "POSTED" } },
    select: { accountId: true, amount: true },
  });
  const balance = new Map<string, number>();
  for (const p of payments) balance.set(p.accountId, (balance.get(p.accountId) ?? 0) - p.amount);
  const earmarkRows = await prisma.fundTransaction.groupBy({
    by: ["accountId"],
    where: { deletedAt: null, type: { in: [...REAL_FUND_TYPES] }, accountId: { not: null } },
    _sum: { amount: true },
  });
  for (const r of earmarkRows) {
    const e = r._sum.amount ?? 0;
    const b = balance.get(r.accountId!) ?? 0;
    if (e > 0 && b < e) {
      const acc = await prisma.account.findUnique({ where: { id: r.accountId! } });
      add("Account", r.accountId!, `餘額 ${money(b)} < 已指定給基金 ${money(e)}（帳戶「${acc?.name}」）`);
    }
  }

  // 2. 已刪除的任務還留著未入金獎金／未抵扣懲罰
  const ghostRewards = await prisma.taskReward.findMany({
    where: { deletedAt: null, depositEntryId: null, task: { deletedAt: { not: null } } },
    select: { id: true, amount: true, taskId: true },
  });
  for (const r of ghostRewards) add("TaskReward", r.id, `任務 ${r.taskId} 已刪除，卻還有未入金獎金 ${money(r.amount)}`);
  const ghostPenalties = await prisma.taskPenalty.findMany({
    where: { waivedAt: null, depositEntryId: null, task: { deletedAt: { not: null } } },
    select: { id: true, amount: true, taskId: true },
  });
  for (const p of ghostPenalties) add("TaskPenalty", p.id, `任務 ${p.taskId} 已刪除，卻還有未抵扣懲罰 ${money(p.amount)}`);

  // 3. 固定支出：同一期重複產生、應付日倒退、狀態錯誤
  const dupRecurring = await prisma.transaction.groupBy({
    by: ["recurringExpenseId", "recurringDueDate"],
    where: { recurringExpenseId: { not: null }, deletedAt: null },
    _count: { _all: true },
  });
  for (const d of dupRecurring.filter((x) => x._count._all > 1)) {
    add("Transaction", `${d.recurringExpenseId}@${d.recurringDueDate?.toISOString().slice(0, 10)}`, `同一期產生了 ${d._count._all} 筆`);
  }
  const recurrings = await prisma.recurringExpense.findMany({ where: { deletedAt: null } });
  for (const r of recurrings) {
    const last = r.lastGeneratedDate?.toISOString().slice(0, 10);
    const next = r.nextDueDate?.toISOString().slice(0, 10);
    if (last && next && next <= last) add("RecurringExpense", r.id, `下一次應付日 ${next} 沒有晚於最後產生日 ${last}（會卡住產生不出來）`);
    const generated = await prisma.transaction.findMany({ where: { recurringExpenseId: r.id }, select: { recurringDueDate: true, deletedAt: true } });
    const newest = generated.map((g) => g.recurringDueDate?.toISOString().slice(0, 10)).filter(Boolean).sort().at(-1);
    if (newest && last && newest > last) add("RecurringExpense", r.id, `已產生到 ${newest}，但 lastGeneratedDate 還停在 ${last}`);
    if (next && generated.some((g) => g.recurringDueDate?.toISOString().slice(0, 10) === next && !g.deletedAt)) {
      add("RecurringExpense", r.id, `下一次應付日 ${next} 其實已經產生過了`);
    }
  }

  // 4. 同一個帳戶被重複建立（同帳本、同擁有者、同名字）
  const accounts = await prisma.account.findMany({ where: { deletedAt: null }, select: { id: true, bookId: true, ownerId: true, name: true, createdAt: true } });
  const seen = new Map<string, string[]>();
  for (const a of accounts) {
    const key = `${a.bookId}|${a.ownerId ?? "joint"}|${a.name}`;
    seen.set(key, [...(seen.get(key) ?? []), a.id]);
  }
  for (const [key, ids] of seen) if (ids.length > 1) add("Account", ids.join(","), `同一個帳本有 ${ids.length} 個同名帳戶（${key.split("|")[2]}），可能是連點兩下建立的`);
  const openings = await prisma.transaction.groupBy({
    by: ["clientRequestId", "bookId"],
    where: { type: "OPENING_BALANCE", deletedAt: null },
    _count: { _all: true },
  });
  for (const o of openings.filter((x) => x._count._all > 1)) add("Transaction", o.clientRequestId, `同一個帳戶有 ${o._count._all} 筆期初餘額`);

  // 5. 帳戶名稱被停用／啟用覆蓋（只能從稽核紀錄推測）
  const nameChanges = await prisma.auditLog.count({ where: { entityType: "Account", action: "UPDATE" } });

  // 6. 退款：總額超過原始消費、回沖超過原始分帳、重複退款
  const refundGroups = await prisma.transaction.groupBy({
    by: ["relatedId"],
    where: { type: "REFUND", deletedAt: null, status: "POSTED", relatedId: { not: null } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  for (const g of refundGroups) {
    const original = await prisma.transaction.findUnique({ where: { id: g.relatedId! }, include: { splits: true } });
    if (!original) {
      add("Transaction", g.relatedId!, "退款指向的原始消費不存在（孤兒退款）");
      continue;
    }
    const refunded = g._sum.amount ?? 0;
    if (refunded > original.amount) add("Transaction", original.id, `退款總額 ${money(refunded)} 超過原始消費 ${money(original.amount)}`);
    if (original.deletedAt) add("Transaction", original.id, "原始消費已刪除，但退款還在");
    // 分帳回沖不可超過原始各自負擔
    const refunds = await prisma.transaction.findMany({ where: { relatedId: original.id, type: "REFUND", deletedAt: null }, include: { splits: true } });
    const back = new Map<string, number>();
    for (const r of refunds) for (const s of r.splits) back.set(s.userId, (back.get(s.userId) ?? 0) + Math.abs(s.amount));
    for (const s of original.splits) {
      const b = back.get(s.userId) ?? 0;
      if (b > Math.abs(s.amount)) add("TransactionSplit", `${original.id}/${s.userId}`, `回沖 ${money(b)} 超過原始負擔 ${money(Math.abs(s.amount))}`);
    }
  }

  // 7. 轉帳：被算成收支、產生分帳、金流不平衡
  const transfers = await prisma.transaction.findMany({
    where: { type: { in: ["TRANSFER", "SETTLEMENT"] }, deletedAt: null },
    include: { payments: true, splits: true },
  });
  for (const t of transfers) {
    const sum = t.payments.reduce((a, p) => a + p.amount, 0);
    if (sum !== 0) add("Transaction", t.id, `${t.type} 的金流加總 ${money(sum)} 不是 0`);
    if (t.splits.length > 0) add("Transaction", t.id, `${t.type} 不該有分帳，卻有 ${t.splits.length} 筆`);
    if (t.payments.length !== 2) add("Transaction", t.id, `${t.type} 應該剛好兩筆金流，實際 ${t.payments.length} 筆`);
  }

  // 8. 收支類型的分錄不平衡
  const flows = await prisma.transaction.findMany({
    where: { type: { in: ["EXPENSE", "INCOME", "REFUND"] }, deletedAt: null, status: "POSTED" },
    include: { payments: true, splits: true },
  });
  for (const t of flows) {
    const sign = t.type === "EXPENSE" ? 1 : -1;
    const ps = t.payments.reduce((a, p) => a + p.amount, 0);
    const ss = t.splits.reduce((a, s) => a + s.amount, 0);
    if (ps !== sign * t.amount) add("Transaction", t.id, `${t.type} 金流 ${money(ps)} 與金額 ${money(sign * t.amount)} 不符`);
    if (ss !== sign * t.amount) add("Transaction", t.id, `${t.type} 分帳 ${money(ss)} 與金額 ${money(sign * t.amount)} 不符`);
  }

  // 9. 獎金入金：來源是信用卡
  const deposits = await prisma.fundTransaction.findMany({ where: { type: "REWARD_DEPOSIT", deletedAt: null, transactionId: { not: null } }, select: { id: true, transactionId: true } });
  for (const d of deposits) {
    const t = await prisma.transaction.findUnique({ where: { id: d.transactionId! }, include: { payments: { include: { account: true } } } });
    const from = t?.payments.find((p) => p.amount > 0);
    if (from?.account.type === "CREDIT_CARD") add("FundTransaction", d.id, `獎金入金從信用卡「${from.account.name}」轉出`);
  }

  // 10. 基金支出：動用的額度帳戶不存在／不同帳本／額度變負
  const fundExpenses = await prisma.fundTransaction.findMany({ where: { type: "EXPENSE", deletedAt: null }, select: { id: true, bookId: true, fundId: true, accountId: true, transactionId: true } });
  for (const fe of fundExpenses) {
    if (!fe.accountId) { add("FundTransaction", fe.id, "基金支出沒有記錄動用哪個帳戶的額度"); continue; }
    const acc = await prisma.account.findUnique({ where: { id: fe.accountId } });
    if (!acc) add("FundTransaction", fe.id, `動用的帳戶 ${fe.accountId} 不存在`);
    else if (acc.bookId !== fe.bookId) add("FundTransaction", fe.id, "動用的帳戶屬於別的帳本");
    if (fe.transactionId) {
      const t = await prisma.transaction.findUnique({ where: { id: fe.transactionId } });
      if (!t) add("FundTransaction", fe.id, "對應的消費不存在");
      else if (t.bookId !== fe.bookId) add("FundTransaction", fe.id, "對應的消費屬於別的帳本");
      else if (t.deletedAt) add("FundTransaction", fe.id, "對應的消費已刪除，基金支出卻還有效");
    }
  }
  // 每個基金在各帳戶的額度不可為負
  const allocs = await prisma.fundTransaction.groupBy({
    by: ["fundId", "accountId"],
    where: { deletedAt: null, type: { in: [...REAL_FUND_TYPES] }, accountId: { not: null } },
    _sum: { amount: true },
  });
  for (const a of allocs) if ((a._sum.amount ?? 0) < 0) add("Fund", a.fundId, `在帳戶 ${a.accountId} 的額度是負的（${money(a._sum.amount ?? 0)}）`);
  const fundTotals = await prisma.fundTransaction.groupBy({ by: ["fundId"], where: { deletedAt: null, type: { in: [...REAL_FUND_TYPES] } }, _sum: { amount: true } });
  for (const f of fundTotals) if ((f._sum.amount ?? 0) < 0) add("Fund", f.fundId, `實際基金金額是負的（${money(f._sum.amount ?? 0)}）`);

  // 11. 跨帳本／孤兒關聯
  const checks: Array<[string, () => Promise<Array<{ id: string; why: string }>>]> = [
    ["Transaction→Account", async () => (await prisma.transactionPayment.findMany({ include: { transaction: true, account: true } }))
      .filter((p) => p.transaction.bookId !== p.account.bookId).map((p) => ({ id: p.transactionId, why: "金流帳戶屬於別的帳本" }))],
    ["Transaction→Category", async () => (await prisma.transaction.findMany({ where: { categoryId: { not: null } }, include: { category: true } }))
      .filter((t) => t.category && t.category.bookId !== t.bookId).map((t) => ({ id: t.id, why: "分類屬於別的帳本" }))],
    ["Transaction→Recurring", async () => (await prisma.transaction.findMany({ where: { recurringExpenseId: { not: null } }, include: { recurring: true } }))
      .filter((t) => t.recurring && t.recurring.bookId !== t.bookId).map((t) => ({ id: t.id, why: "固定支出屬於別的帳本" }))],
    ["Transaction→Related(refund)", async () => {
      const rs = await prisma.transaction.findMany({ where: { relatedId: { not: null } }, select: { id: true, bookId: true, relatedId: true } });
      const out: Array<{ id: string; why: string }> = [];
      for (const r of rs) {
        const o = await prisma.transaction.findUnique({ where: { id: r.relatedId! }, select: { bookId: true } });
        if (!o) out.push({ id: r.id, why: "原始消費不存在" });
        else if (o.bookId !== r.bookId) out.push({ id: r.id, why: "原始消費屬於別的帳本" });
      }
      return out;
    }],
    ["FundTransaction→Fund", async () => (await prisma.fundTransaction.findMany({ include: { fund: true } }))
      .filter((f) => f.fund.bookId !== f.bookId).map((f) => ({ id: f.id, why: "基金屬於別的帳本" }))],
    ["Goal→Fund", async () => (await prisma.goal.findMany({ where: { fundId: { not: null } }, include: { fund: true } }))
      .filter((g) => g.fund && g.fund.bookId !== g.bookId).map((g) => ({ id: g.id, why: "連結的基金屬於別的帳本" }))],
    ["Task→Fund", async () => {
      const ts = await prisma.task.findMany({ where: { fundId: { not: null } }, select: { id: true, bookId: true, fundId: true, deletedAt: true } });
      const out: Array<{ id: string; why: string }> = [];
      for (const t of ts) {
        const f = await prisma.fund.findUnique({ where: { id: t.fundId! }, select: { bookId: true, deletedAt: true } });
        if (!f) out.push({ id: t.id, why: "連結的基金不存在" });
        else if (f.bookId !== t.bookId) out.push({ id: t.id, why: "連結的基金屬於別的帳本" });
        else if (f.deletedAt && !t.deletedAt) out.push({ id: t.id, why: "連結的基金已刪除，任務還在" });
      }
      return out;
    }],
    ["CheckIn→Task", async () => (await prisma.checkIn.findMany({ include: { task: true } }))
      .filter((c) => c.task.bookId !== c.bookId).map((c) => ({ id: c.id, why: "任務屬於別的帳本" }))],
    ["Attachment→Book", async () => (await prisma.attachment.findMany({ select: { id: true, bookId: true, storageKey: true } }))
      .filter((a) => !a.storageKey.startsWith(`${a.bookId}/`)).map((a) => ({ id: a.id, why: "照片檔案路徑不屬於這個帳本" }))],
    ["RecurringExpense→Account", async () => {
      const rs = await prisma.recurringExpense.findMany({ where: { deletedAt: null }, select: { id: true, bookId: true, accountId: true } });
      const out: Array<{ id: string; why: string }> = [];
      for (const r of rs) {
        const a = await prisma.account.findUnique({ where: { id: r.accountId }, select: { bookId: true } });
        if (!a) out.push({ id: r.id, why: "付款帳戶不存在" });
        else if (a.bookId !== r.bookId) out.push({ id: r.id, why: "付款帳戶屬於別的帳本" });
      }
      return out;
    }],
    ["Settlement→Transaction", async () => (await prisma.settlement.findMany({ include: { transaction: true } }))
      .filter((s) => s.transaction.bookId !== s.bookId).map((s) => ({ id: s.id, why: "結算的交易屬於別的帳本" }))],
  ];
  for (const [name, fn] of checks) for (const r of await fn()) add(name, r.id, r.why);

  console.log(`帳戶更新稽核紀錄：${nameChanges} 筆（名稱是否被覆蓋需要人工比對稽核內容）`);
  console.log(`\n--- 結果 ---`);
  if (findings.length === 0) {
    console.log("沒有發現異常。");
  } else {
    for (const f of findings) console.log(`[${f.table}] ${f.id}\n    ${f.problem}`);
    console.log(`\n共 ${findings.length} 筆異常。`);
  }
  await prisma.$disconnect();
  return findings.length;
}

main().then((n) => process.exit(n > 0 ? 1 : 0)).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(2);
});
