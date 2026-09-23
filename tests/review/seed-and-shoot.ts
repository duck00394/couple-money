/**
 * 手機畫面巡檢：用服務層建立一組「用了兩週」的真實情境資料，再用手機尺寸瀏覽器截圖主要頁面。
 * 執行：DATABASE_URL=<測試資料庫> BASE_URL=http://localhost:3100 npx tsx tests/review/seed-and-shoot.ts
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium, devices, type BrowserContext } from "@playwright/test";
import { prisma } from "../../src/server/db";
import * as users from "../../src/server/services/users";
import * as books from "../../src/server/services/books";
import * as ledger from "../../src/server/services/ledger";
import * as funds from "../../src/server/services/funds";
import * as goals from "../../src/server/services/goals";
import * as tasks from "../../src/server/services/tasks";
import { addDays, keyToDbDate, toDateKey } from "../../src/lib/dates";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.OUT ?? "tests/review/shots";
mkdirSync(OUT, { recursive: true });
const $ = (n: number) => n * 100;
const today = toDateKey(new Date());
const tag = Date.now().toString(36);

async function login(context: BrowserContext, userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 86400_000) } });
  await context.addCookies([{ name: "cm_session", value: token, url: BASE }]);
}

async function main() {
  // ── 資料 ──
  const a = await users.registerUser({ email: `amy-${tag}@example.com`, password: "password123", name: "小艾" });
  const b = await users.registerUser({ email: `ben-${tag}@example.com`, password: "password123", name: "阿本" });
  await books.createBook(a.id, { name: "艾與本", nickname: "小艾" });
  let A = (await books.getBookContext(a.id))!;
  await books.acceptInvite(b.id, (await books.getOrCreateInvite(A)).code, "阿本");
  A = await books.loadContext(a.id, A.book.id);
  const B = await books.loadContext(b.id, A.book.id);
  const accs = await ledger.listAccounts(A);
  const aCash = accs.find((x) => x.ownerId === a.id)!.id;
  const bCash = accs.find((x) => x.ownerId === b.id)!.id;
  const joint = accs.find((x) => x.ownerId === null)!.id;
  const card = (await ledger.createAccount(A, { name: "玉山卡", type: "CREDIT_CARD", shared: false, openingBalance: 0 })).id;
  const bBank = (await ledger.createAccount(B, { name: "薪轉戶", type: "BANK", shared: false, openingBalance: $(52000) })).id;
  await ledger.createTransaction(A, { type: "INCOME", amount: $(30000), accountId: joint, categoryId: null, title: "兩人存入共同帳戶", note: "", occurredOn: addDays(today, -12), split: { method: "FULL", participants: [{ userId: a.id }] }, clientRequestId: randomUUID() });
  const cats = await ledger.listCategories(A);
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const eq = { method: "EQUAL" as const, participants: [{ userId: a.id }, { userId: b.id }] };
  const spend = (ctx: typeof A, amount: number, title: string, accountId: string, day: number, c = "餐飲", fundId?: string) =>
    ledger.createTransaction(ctx, { type: "EXPENSE", amount: $(amount), accountId, categoryId: cat(c), title, note: "", occurredOn: addDays(today, -day), split: eq, clientRequestId: randomUUID(), fundId });
  await spend(A, 1280, "火鍋", aCash, 6);
  await spend(B, 420, "電影", bCash, 4, "娛樂");
  await spend(A, 2350, "全聯", joint, 3, "日用品");
  await spend(A, 890, "約會晚餐", card, 1, "約會");

  const trip = await funds.createFund(A, { name: "日本旅遊基金", emoji: "✈️", targetAmount: $(30000), dueDate: addDays(today, 150) });
  const rent = await funds.createFund(B, { name: "租屋基金", emoji: "🏠", targetAmount: $(50000), dueDate: null });
  await funds.createFund(A, { name: "生日基金", emoji: "🎂", targetAmount: $(10000), dueDate: addDays(today, 40) });
  const entry = (ctx: typeof A, fundId: string, amount: number, userId: string | null, accountId: string | null, day: number) =>
    funds.addFundEntry(ctx, { fundId, type: "DEPOSIT", amount: $(amount), userId, accountId, note: "", occurredOn: addDays(today, -day), clientRequestId: randomUUID() });
  await entry(A, trip.id, 10000, a.id, joint, 12);
  await entry(B, trip.id, 8000, b.id, joint, 10);
  await entry(B, rent.id, 12000, b.id, bBank, 9);
  await spend(A, 1200, "機票訂金", joint, 2, "旅行", trip.id);
  await goals.createGoal(A, { name: "日本旅行", description: "明年春天去京都賞櫻", emoji: "🗾", targetAmount: $(30000), startDate: addDays(today, -14), deadline: addDays(today, 150), fundId: trip.id, isActive: true });
  await goals.createGoal(B, { name: "搬到大一點的家", description: "", emoji: "🏠", targetAmount: $(50000), startDate: addDays(today, -14), deadline: null, fundId: rent.id, isActive: true });

  const ms = tasks.DEFAULT_MILESTONES.map((m) => ({ ...m, bonusAmount: m.days === 7 ? $(200) : 0, rewardText: m.days === 30 ? "對方請吃大餐" : "" }));
  const base = { description: "", frequency: "DAILY" as const, daysOfWeek: 127, requiresApproval: false, requiresPhoto: false, penaltyAmount: 0, penaltyText: "", isActive: true };
  const english = await tasks.createTask(A, { ...base, title: "英文 30 分鐘", emoji: "📚", scope: "PERSONAL", assigneeId: a.id, rewardAmount: $(50), fundId: trip.id, penaltyAmount: $(20), penaltyText: "洗碗一次", milestones: ms });
  const run = await tasks.createTask(B, { ...base, title: "運動", emoji: "🏃", scope: "PERSONAL", assigneeId: b.id, rewardAmount: $(30), fundId: trip.id, requiresApproval: true, requiresPhoto: true, milestones: [] });
  const read = await tasks.createTask(A, { ...base, title: "睡前閱讀", emoji: "📖", scope: "PERSONAL", assigneeId: a.id, frequency: "CUSTOM", daysOfWeek: 0b0111110, rewardAmount: $(20), fundId: trip.id, milestones: [] });
  const walk = await tasks.createTask(A, { ...base, title: "一起散步", emoji: "🚶", scope: "SHARED", assigneeId: null, rewardAmount: $(20), fundId: rent.id, milestones: [] });
  for (const t of [english, run, read, walk]) {
    await prisma.task.update({ where: { id: t.id }, data: { startDate: keyToDbDate(addDays(today, -13)), penaltyStartDate: t.id === english.id ? keyToDbDate(addDays(today, -12)) : null } });
  }
  // 英文：前 13 天中漏兩天，最近 8 天連續（今天還沒打）
  for (let d = 13; d >= 1; d--) if (d !== 10 && d !== 9) await tasks.checkIn(A, english.id, { today: addDays(today, -d) });
  for (let d = 13; d >= 1; d -= 2) await tasks.checkIn(A, walk.id, { today: addDays(today, -d) }).catch(() => null);
  await tasks.checkIn(B, walk.id, { today }).catch(() => null);
  for (let d = 12; d >= 1; d--) { try { await tasks.checkIn(A, read.id, { today: addDays(today, -d) }); } catch { /* 週末不用做 */ } }
  await tasks.applyMissedPenalties(A, today);
  await funds.depositRewards(B, { fundId: rent.id, targetAccountId: joint, sourceAccountId: bBank, note: "", occurredOn: today, clientRequestId: randomUUID() });
  // 阿本今天運動：照片待確認
  const png = (await import("node:fs")).readFileSync("tests/review/sample-photo.png");
  const { saveUpload } = await import("../../src/server/services/attachments");
  const photo = await saveUpload(B, { name: "run.png", type: "image/png", size: png.length, arrayBuffer: async () => new Uint8Array(png).buffer });
  await tasks.checkIn(B, run.id, { today, photoId: photo.id, note: "河堤跑 5K" });
  const firstGoal = (await goals.listGoals(A))[0];

  // ── 截圖 ──
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const phone = { ...devices["iPhone 13"], locale: "zh-TW", timezoneId: "Asia/Taipei" };
  const ca = await browser.newContext(phone);
  const cb = await browser.newContext(phone);
  await login(ca, a.id);
  await login(cb, b.id);
  const pa = await ca.newPage();
  const pb = await cb.newPage();
  const shots: Array<[typeof pa, string, string]> = [
    [pa, "a-home", "/"],
    [pa, "a-transactions", "/transactions"],
    [pa, "a-tasks", "/tasks"],
    [pa, "a-task-english", `/tasks/${english.id}`],
    [pa, "a-task-run-review", `/tasks/${run.id}`],
    [pa, "a-goals", "/goals"],
    [pa, "a-goal", `/goals/${firstGoal.id}`],
    [pa, "a-fund-trip", `/funds/${trip.id}`],
    [pa, "a-fund-rent", `/funds/${rent.id}`],
    [pa, "a-new-tx-fund", `/transactions/new?fund=${trip.id}`],
    [pa, "a-new-task", "/tasks/new"],
    [pa, "a-accounts", "/accounts"],
    [pa, "a-settle", "/settle"],
    [pa, "a-more", "/more"],
    [pb, "b-home", "/"],
    [pb, "b-task-run", `/tasks/${run.id}`],
  ];
  for (const [page, name, path] of shots) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
  }
  await browser.close();
  console.log("done", { a: a.email, b: b.email, english: english.id });
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
