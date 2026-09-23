/**
 * 試用用的示範資料（demo data）。
 *
 * 只呼叫既有的 service（跟 App 按按鈕走的是同一套規則），
 * 不會繞過任何財務驗證，也不會新增或修改任何資料表。
 *
 * 用法（Windows PowerShell）：
 *   $env:DATABASE_URL="postgresql://postgres:你的密碼@localhost:5432/couple_money_demo"
 *   npx tsx scripts/seed-demo.ts
 *
 * 想重來一次（清空這個資料庫再重建）：
 *   npx tsx scripts/seed-demo.ts --reset
 *
 * ⚠️ --reset 會清空 DATABASE_URL 指到的那個資料庫，請務必指向 demo 資料庫。
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/server/db";
import * as users from "../src/server/services/users";
import * as books from "../src/server/services/books";
import * as ledger from "../src/server/services/ledger";
import * as funds from "../src/server/services/funds";
import * as goals from "../src/server/services/goals";
import * as tasks from "../src/server/services/tasks";
import * as transfers from "../src/server/services/transfers";
import * as budgets from "../src/server/services/budgets";
import { toDateKey } from "../src/lib/dates";
import type { SplitRule } from "../src/server/domain/split";

const $ = (n: number) => Math.round(n * 100); // 金額一律整數最小單位
const rid = () => randomUUID();

const A = { email: "demo-a@couple.local", password: "demo1234", name: "小安" };
const B = { email: "demo-b@couple.local", password: "demo1234", name: "小森" };

const today = toDateKey(new Date());
const month = today.slice(0, 7);
/** 這個月的第 d 天（不會超過今天，避免出現未來日期）。 */
const D = (d: number) => {
  const key = `${month}-${String(d).padStart(2, "0")}`;
  return key > today ? today : key;
};

async function reset() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(",")} CASCADE`);
  console.log("已清空 demo 資料庫");
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  console.log(`資料庫：${url.replace(/\/\/[^@]*@/, "//***@")}`);

  if (process.argv.includes("--reset")) await reset();

  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log(`\n這個資料庫已經有 ${existing} 個使用者，為了安全起見不動它。`);
    console.log("如果確定要重建示範資料，請加上 --reset：npx tsx scripts/seed-demo.ts --reset\n");
    return;
  }

  // ── 兩個人 + 一本帳本 ──────────────────────────────
  const a = await users.registerUser({ email: A.email, password: A.password, name: A.name });
  const b = await users.registerUser({ email: B.email, password: B.password, name: B.name });
  await books.createBook(a.id, { name: "我們的帳本", nickname: A.name });
  let ctxA = (await books.getBookContext(a.id))!;
  const invite = await books.getOrCreateInvite(ctxA);
  await books.acceptInvite(b.id, invite.code, B.name);
  ctxA = await books.loadContext(a.id, ctxA.book.id);
  const ctxB = await books.loadContext(b.id, ctxA.book.id);

  // ── 帳戶 ────────────────────────────────────────
  const accounts = await ledger.listAccounts(ctxA);
  const cashA = accounts.find((x) => x.ownerId === a.id)!.id;
  const cashB = accounts.find((x) => x.ownerId === b.id)!.id;
  const joint = accounts.find((x) => x.ownerId === null)!.id;
  const bankA = (await ledger.createAccount(ctxA, { name: "台新銀行", type: "BANK", shared: false, openingBalance: $(48000) })).id;
  const cardA = (await ledger.createAccount(ctxA, { name: "玉山卡", type: "CREDIT_CARD", shared: false, openingBalance: 0 })).id;
  const bankB = (await ledger.createAccount(ctxB, { name: "小森銀行", type: "BANK", shared: false, openingBalance: $(36000) })).id;

  // 共同帳戶先放錢：兩人各轉一筆進去（轉帳不算收支、不產生欠款）
  await transfers.createTransfer(ctxA, { fromAccountId: bankA, toAccountId: joint, amount: $(15000), occurredOn: D(1), note: "這個月的共同生活費", clientRequestId: rid() });
  await transfers.createTransfer(ctxB, { fromAccountId: bankB, toAccountId: joint, amount: $(15000), occurredOn: D(1), note: "這個月的共同生活費", clientRequestId: rid() });

  const cats = await ledger.listCategories(ctxA);
  const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? null;

  const eq: SplitRule = { method: "EQUAL", participants: [{ userId: a.id }, { userId: b.id }] };
  const mine: SplitRule = { method: "FULL", participants: [{ userId: a.id }] };

  // ── 這個月的日常記帳 ─────────────────────────────
  const spend = (ctx: typeof ctxA, title: string, amount: number, day: number, catName: string, accountId: string, split = eq) =>
    ledger.createTransaction(ctx, {
      type: "EXPENSE", amount: $(amount), accountId, categoryId: cat(catName), title,
      note: "", occurredOn: D(day), split, clientRequestId: rid(),
    });

  await ledger.createTransaction(ctxA, {
    type: "INCOME", amount: $(62000), accountId: bankA, categoryId: cat("薪水"), title: "九月薪水",
    note: "", occurredOn: D(5), split: mine, clientRequestId: rid(),
  });

  await spend(ctxA, "早餐店", 120, 2, "餐飲", cashA);
  await spend(ctxA, "全聯採買", 860, 3, "日用品", joint);
  await spend(ctxB, "捷運儲值", 500, 3, "交通", cashB);
  const dinner = await spend(ctxA, "居酒屋", 1680, 5, "餐飲", cardA);
  await spend(ctxA, "電影票", 640, 6, "娛樂", cardA);
  await spend(ctxB, "手搖飲", 130, 7, "餐飲", cashB);
  await spend(ctxA, "水電瓦斯", 2340, 8, "居家", joint);
  await spend(ctxA, "藥妝店", 780, 10, "日用品", cashA);
  await spend(ctxB, "計程車", 260, 11, "交通", cashB);
  await spend(ctxA, "咖啡", 180, 12, "餐飲", cashA);
  await spend(ctxA, "情人節晚餐", 2400, 14, "約會", cardA);
  await spend(ctxB, "超市", 950, 15, "日用品", joint);
  await spend(ctxA, "健身房月費", 1200, 16, "其他", bankA, mine);
  await spend(ctxA, "午餐便當", 110, 18, "餐飲", cashA);
  await spend(ctxB, "電影票", 640, 20, "娛樂", cashB);
  // 最後兩筆記在今天，打開首頁的「最近紀錄」就看得到日常消費
  await spend(ctxA, "便利商店", 95, 31, "日用品", cashA);
  await spend(ctxB, "晚餐 火鍋", 1180, 31, "餐飲", joint);

  // 退款：居酒屋退了一部分
  await transfers.createRefund(ctxA, { originalId: dinner.id, amount: $(280), accountId: cardA, occurredOn: D(6), note: "多算一道菜", clientRequestId: rid() });

  // ── 基金與目標 ──────────────────────────────────
  const fund = await funds.createFund(ctxA, { name: "日本旅遊基金", emoji: "🐷", targetAmount: $(80000), dueDate: null });
  await funds.addFundEntry(ctxA, {
    fundId: fund.id, type: "DEPOSIT", amount: $(12000), userId: a.id, accountId: joint,
    note: "先存一點", occurredOn: D(2), clientRequestId: rid(),
  });
  await goals.createGoal(ctxA, {
    name: "日本旅行", description: "明年春天去看櫻花", emoji: "🎯",
    targetAmount: $(80000), startDate: D(1), deadline: null, fundId: fund.id, isActive: true,
  });

  // ── 任務與打卡 ──────────────────────────────────
  const task1 = await tasks.createTask(ctxA, {
    title: "運動 30 分鐘", description: "", emoji: "🏃", scope: "PERSONAL", assigneeId: a.id,
    frequency: "DAILY", daysOfWeek: 0, requiresApproval: false, requiresPhoto: false,
    rewardAmount: $(50), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
  });
  await tasks.createTask(ctxA, {
    title: "一起散步", description: "", emoji: "🚶", scope: "SHARED", assigneeId: null,
    frequency: "DAILY", daysOfWeek: 0, requiresApproval: false, requiresPhoto: false,
    rewardAmount: $(20), fundId: fund.id, penaltyAmount: 0, penaltyText: "", isActive: true, milestones: [],
  });
  await tasks.checkIn(ctxA, task1.id);

  // ── 這個月的預算 ────────────────────────────────
  const food = cat("餐飲");
  if (food) await budgets.createBudget(ctxA, { categoryId: food, month, amount: $(8000), note: "外食少一點" });
  const fun = cat("娛樂");
  if (fun) await budgets.createBudget(ctxA, { categoryId: fun, month, amount: $(1500), note: "" });

  const balances = await ledger.getBalances(ctxA);
  const debt = balances.debts[0];
  console.log(`
示範資料建立完成 ✅

  帳本：我們的帳本
  A：${A.email} / ${A.password}（${A.name}）
  B：${B.email} / ${B.password}（${B.name}）

  這個月已經有 18 筆記帳、1 筆退款、2 筆轉帳、1 個基金、1 個目標、2 個任務、2 個預算。
  目前欠款：${debt ? `${debt.from === a.id ? A.name : B.name} 要還 ${debt.from === a.id ? B.name : A.name} $${(debt.amount / 100).toLocaleString()}` : "互不相欠"}

  現在可以 npm run dev，開 http://localhost:3000 登入試用。
`);
}

main()
  .catch((e) => {
    console.error("\n建立示範資料失敗：", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
