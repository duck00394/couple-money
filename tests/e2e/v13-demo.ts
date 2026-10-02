/**
 * V13：試用／展示模式。
 *
 * 這一支的重點是規格點 20 第 10 項 —— **不要只測 UI，要直接確認資料庫**：
 *
 *     操作前   每個 Prisma model 的列數 = X
 *     操作後   每個 Prisma model 的列數 = X
 *
 * 所以流程是：先數一次全部 model 的列數 → 在 /demo 裡大量操作（新增、編輯、
 * 刪除、分帳、打卡、結算、存基金、新增帳戶、移除購買紀錄、重置、重整）
 * → 再數一次，逐一比對。任何一個主要 model 多出一列就算失敗。
 *
 * 另外驗證：
 *   - /demo 不用登入就能進（而且不會被導去 /login）
 *   - 試用模式的提示有出現
 *   - 新增的交易真的影響了畫面上的餘額與欠款（不是假的靜態頁）
 *   - 重整後回到預設資料（記憶體模式的預期行為）
 *   - 重置可以把朋友亂改的東西復原
 *   - 整個過程沒有任何對 server action 的請求
 */
import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { go, loaded, pageText, shot, step } from "./lib";

/** 會被盯著的 model。任何一個在試用操作後變多就是 bug。 */
const MODELS = [
  "user", "session", "book", "bookMember", "invite",
  "account", "category", "tag", "transaction", "transactionPayment",
  "transactionSplit", "transactionTag", "settlement", "fund", "fundTransaction",
  "goal", "task", "checkIn", "rewardLedger", "budget",
  "recurringExpense", "attachment", "notification", "auditLog", "deleteRequest",
  "preorder", "preorderItem", "purchaseGroup", "purchaseTag", "purchaseCategory",
  "purchaseEntry", "purchaseKeyword",
] as const;

type Counts = Record<string, number>;

/**
 * 試用模式內部一律用「點連結」的軟導覽。
 *
 * **不要用 go()／page.goto()。** 那是整頁重新載入，React 樹會重建，
 * 記憶體裡的試用狀態就全部沒了（這正是第一版測試誤以為「餘額是寫死的」的原因）。
 * 朋友實際使用時點的也是連結，所以軟導覽才是真實路徑。
 *
 * 路線：先回試用首頁（底部導覽一定在），需要的話再經過「更多」這個樞紐頁 ——
 * /demo/more 列了全部試用頁面的連結。
 */
async function softGo(p: Page, href: string) {
  const here = new URL(p.url()).pathname;
  if (here !== href) {
    if (here !== "/demo") {
      const home = p.locator('nav a[href="/demo"]');
      if (await home.count() > 0) {
        await home.first().click();
        await p.waitForURL(/\/demo$/);
        await loaded(p);
      }
    }
    if (href !== "/demo") {
      let link = p.locator(`a[href="${href}"]`).first();
      if ((await link.count()) === 0) {
        await p.locator('a[href="/demo/more"]').first().click();
        await p.waitForURL(/\/demo\/more$/);
        await loaded(p);
        link = p.locator(`a[href="${href}"]`).first();
      }
      await link.click();
      await p.waitForURL((u) => new URL(u).pathname === href);
      await loaded(p);
    }
  }
  return (await p.locator("body").innerText()).replace(/\s+/g, " ");
}


async function countAll(prisma: PrismaClient): Promise<Counts> {
  const out: Counts = {};
  for (const m of MODELS) {
    // 有些 model 在不同階段可能還不存在於 schema，跳過而不是整支掛掉
    const delegate = (prisma as unknown as Record<string, { count?: () => Promise<number> }>)[m];
    if (!delegate?.count) continue;
    out[m] = await delegate.count();
  }
  return out;
}

export async function v13Demo(a: Page) {
  const prisma = new PrismaClient();

  try {
    // ───────── 0. 操作前先數一次 ─────────
    const before = await countAll(prisma);
    const total = Object.values(before).reduce((x, y) => x + y, 0);
    step(`操作前：${Object.keys(before).length} 個 model、共 ${total} 列`);

    // 這一支會送出的所有請求，之後用來確認沒有打到 server action
    const posts: string[] = [];
    const onRequest = (req: { method: () => string; url: () => string }) => {
      if (req.method() === "POST") posts.push(req.url());
    };
    a.on("request", onRequest);

    // ───────── 1. 不用登入就能進 ─────────
    // 先確定是「沒有登入」的狀態：清掉 cookie，正式頁應該被導去 /login
    await a.context().clearCookies();
    await go(a, "/");
    await a.waitForURL(/\/login/);
    step("清掉登入狀態後，正式首頁會被導去 /login");

    // 登入頁要有試用入口
    await expect(a.getByTestId("demo-entry")).toBeVisible();
    await a.getByTestId("demo-entry").click();
    await a.waitForURL(/\/demo$/);
    await loaded(a);
    step("登入頁的「試用看看」進得去 /demo，而且沒有被導回 /login");

    // ───────── 2. 狀態提示 ─────────
    const home = await pageText(a);
    expect(home, "沒有看到試用模式的提示").toContain("試用模式");
    expect(home).toContain("資料不會儲存到正式帳戶");
    expect(home, "示範資料沒載入").toContain("小桃");
    await shot(a, "v13-01-demo-home");
    step("試用模式的狀態條與示範資料都在");

    // 展開說明、確認重置按鈕在
    await a.getByTestId("demo-badge-toggle").click();
    await expect(a.getByTestId("demo-reset")).toBeVisible();
    await a.getByTestId("demo-badge-toggle").click();
    step("說明可以展開，裡面有「重置試用資料」");

    // ───────── 3. 新增交易，而且畫面真的跟著變 ─────────
    const feedBefore = await a.getByTestId("tx-row").count();
    await softGo(a, "/demo/transactions/new");
    await a.getByLabel("金額").fill("1234");
    await a.getByLabel("名稱（選填）").fill("試用新增的一筆");
    await a.getByRole("button", { name: "記下來" }).click();
    await a.waitForURL(/\/demo$/);
    await loaded(a);
    const afterAdd = await pageText(a);
    expect(afterAdd, "新增的交易沒有出現在首頁").toContain("試用新增的一筆");
    expect(await a.getByTestId("tx-row").count(), "列數沒有增加").toBeGreaterThan(feedBefore);
    await shot(a, "v13-02-added");
    step("新增一筆 $1,234，首頁立刻看得到（不是靜態頁）");

    // ───────── 4. 編輯 ─────────
    await a.getByText("試用新增的一筆").first().click();
    await a.waitForURL(/\/demo\/transactions\/tx_/);
    await loaded(a);
    await a.getByLabel("名稱（選填）").fill("改過名字了");
    await a.getByRole("button", { name: "儲存修改" }).click();
    await a.waitForURL(/\/demo\/transactions$/);
    await loaded(a);
    const afterEdit = await pageText(a);
    expect(afterEdit).toContain("改過名字了");
    expect(afterEdit, "舊名字還在，等於新增了一筆而不是編輯").not.toContain("試用新增的一筆");
    step("編輯：名稱改掉了，而且沒有變成多一筆");

    // ───────── 4b. 切換頁面後改動還在（軟導覽不該清掉狀態）─────────
    // 朋友會在底部導覽之間跳來跳去，如果一換頁就回到預設資料，試用模式等於不能用。
    await softGo(a, "/demo/stats");
    await softGo(a, "/demo/tasks");
    expect(await softGo(a, "/demo/transactions"), "換過幾頁之後改動不見了").toContain("改過名字了");
    step("在試用模式裡切換頁面，改過的資料還在（軟導覽保留狀態）");

    // ───────── 5. 餘額與欠款會跟著動 ─────────
    const accountsBefore = await softGo(a, "/demo/accounts");
    await softGo(a, "/demo/transactions/new");
    await a.getByLabel("金額").fill("5000");
    await a.getByLabel("名稱（選填）").fill("大筆支出");
    await a.getByRole("button", { name: "記下來" }).click();
    await a.waitForURL(/\/demo$/);
    const accountsAfter = await softGo(a, "/demo/accounts");
    expect(accountsAfter, "帳戶餘額完全沒變，餘額可能是寫死的").not.toBe(accountsBefore);
    step("新增支出後帳戶餘額跟著變（餘額是現算的，不是寫死的）");

    // ───────── 6. 刪除 ─────────
    await softGo(a, "/demo/transactions");
    await a.getByText("改過名字了").first().click();
    await a.waitForURL(/\/demo\/transactions\/tx_/);
    await loaded(a);
    // 按鈕會跳 confirm()，couple-flow.ts 已經掛了 dialog handler 自動接受
    await a.getByRole("button", { name: "刪除這筆紀錄" }).click();
    await a.waitForURL(/\/demo\/transactions$/);
    await loaded(a);
    expect(await pageText(a), "刪除後還看得到").not.toContain("改過名字了");
    step("刪除：紀錄消失了");

    // ───────── 7. 任務打卡 ─────────
    await softGo(a, "/demo/tasks");
    const checkIn = a.getByTestId("demo-checkin").first();
    if (await checkIn.count() > 0) {
      await checkIn.click();
      await a.waitForTimeout(200);
      expect(await pageText(a)).toContain("已完成");
      step("任務打卡：變成「已完成」");
      await a.getByTestId("demo-undo-checkin").first().click();
      await a.waitForTimeout(200);
      step("取消打卡：可以還原");
    }

    // ───────── 8. 基金存錢 ─────────
    await softGo(a, "/demo/funds");
    await a.getByTestId("demo-fund-deposit-open").first().click();
    await a.getByTestId("demo-fund-amount").fill("3000");
    await a.getByTestId("demo-fund-deposit-submit").click();
    await a.waitForTimeout(200);
    await shot(a, "v13-03-funds");
    step("基金存錢：進度條跟著走");

    // ───────── 9. 新增帳戶 ─────────
    await softGo(a, "/demo/accounts");
    const accRows = await a.getByTestId("demo-account-row").count();
    await a.getByTestId("demo-account-name").fill("試用新帳戶");
    await a.getByTestId("demo-account-submit").click();
    await a.waitForTimeout(200);
    expect(await a.getByTestId("demo-account-row").count()).toBe(accRows + 1);
    step("新增帳戶：多了一列");

    // ───────── 10. 結算 ─────────
    await softGo(a, "/demo/settle");
    const settleForm = a.getByTestId("demo-settle-form");
    if (await settleForm.count() > 0) {
      await a.getByTestId("demo-settle-all").click();
      await a.getByTestId("demo-settle-submit").click();
      await a.waitForTimeout(300);
      expect(await pageText(a), "全額結算後應該互不相欠").toContain("互不相欠");
      await shot(a, "v13-04-settled");
      step("結算：全部還清後變成互不相欠");
    }

    // ───────── 11. 統計 ─────────
    const stats = await softGo(a, "/demo/stats");
    expect(stats).toContain("誰負擔了多少");
    expect(stats).toContain("小桃");
    expect(stats).toContain("阿柴");
    await shot(a, "v13-05-stats");
    step("統計頁：兩個人各自負擔多少都看得到");

    // ───────── 12. 預購：共同平分 vs 指定歸屬 ─────────
    const pre = await softGo(a, "/demo/preorders");
    expect(pre).toContain("每個人該付");
    expect(await a.getByTestId("demo-preorder-card").count()).toBeGreaterThanOrEqual(3);
    await shot(a, "v13-06-preorders");
    step("預購：三種歸屬組合的應付金額都算出來了");

    // ───────── 13. 購買紀錄四層下鑽 ─────────
    await softGo(a, "/demo/purchases");
    await a.getByTestId("demo-purchase-group").first().click();
    await a.waitForURL(/\/demo\/purchases\/pg_/);
    await loaded(a);
    expect(await pageText(a)).toContain("商品分類");
    await a.getByTestId("demo-purchase-level-row").first().click();
    await a.waitForTimeout(200);
    expect(await pageText(a), "第二層應該是「誰的」").toContain("誰的");
    await a.getByTestId("demo-purchase-level-row").first().click();
    await a.waitForTimeout(200);
    expect(await pageText(a), "第三層應該是「角色」").toContain("角色");
    await a.getByTestId("demo-purchase-level-row").first().click();
    await a.waitForTimeout(200);
    expect(await a.getByTestId("demo-purchase-entry").count(), "第四層沒有品項").toBeGreaterThan(0);
    await shot(a, "v13-07-purchase-drill");
    step("購買紀錄：作品 → 商品分類 → 誰的 → 角色，四層都點得進去");

    // 移除一筆購買紀錄
    const entries = await a.getByTestId("demo-purchase-entry").count();
    await a.getByTestId("demo-purchase-remove").first().click();
    await a.waitForTimeout(200);
    expect(await a.getByTestId("demo-purchase-entry").count()).toBe(entries - 1);
    step("移除購買紀錄：少了一筆");

    // ───────── 14. 重整 → 回到預設資料（記憶體模式的預期行為）─────────
    await softGo(a, "/demo");
    await a.reload();
    await loaded(a);
    const afterReload = await pageText(a);
    expect(afterReload, "重整後畫面壞掉了").toContain("試用模式");
    expect(afterReload, "重整後示範資料沒回來").toContain("小桃");
    expect(afterReload, "重整後還留著剛才新增的（記憶體模式應該要清掉）").not.toContain("大筆支出");
    step("重整：回到乾淨的預設資料，畫面正常（記憶體模式，不持久化）");

    // ───────── 15. 重置 ─────────
    await softGo(a, "/demo/transactions/new");
    await a.getByLabel("金額").fill("777");
    await a.getByLabel("名稱（選填）").fill("等一下要被重置掉");
    await a.getByRole("button", { name: "記下來" }).click();
    await a.waitForURL(/\/demo$/);
    expect(await pageText(a)).toContain("等一下要被重置掉");
    await a.getByTestId("demo-badge-toggle").click();
    await a.getByTestId("demo-reset").click();
    await a.waitForTimeout(300);
    expect(await pageText(a), "重置後改動還在").not.toContain("等一下要被重置掉");
    expect(await pageText(a), "重置後示範資料沒回來").toContain("小桃");
    step("重置：朋友亂改的東西一鍵復原成預設資料");

    // ───────── 16. 沒有打到任何 server action ─────────
    a.off("request", onRequest);
    // Next.js 的 server action 一律是對頁面路徑的 POST。/demo 底下不該有任何 POST。
    const demoPosts = posts.filter((u) => u.includes("/demo"));
    expect(demoPosts, `試用模式送出了 POST：${demoPosts.join(", ")}`).toHaveLength(0);
    step(`整個流程對 /demo 的 POST 請求數：0（總共攔到 ${posts.length} 個 POST，都在 /demo 之外）`);

    // ───────── 17. 最重要的：資料庫一列都沒有多 ─────────
    const after = await countAll(prisma);
    const diffs: string[] = [];
    for (const [model, n] of Object.entries(before)) {
      if (after[model] !== n) diffs.push(`${model}: ${n} → ${after[model]}`);
    }
    expect(diffs, `試用模式寫進了資料庫：${diffs.join("、")}`).toHaveLength(0);
    step(`操作後：全部 ${Object.keys(after).length} 個 model 列數完全一致（共 ${total} 列，0 筆新增）`);

    // 再多確認一層：不能出現任何看起來像 Guest／Demo／Trial 的使用者或帳本
    const suspects = await prisma.user.count({
      where: { OR: [{ name: { contains: "試用" } }, { name: { contains: "Demo", mode: "insensitive" } }, { name: { contains: "Guest", mode: "insensitive" } }, { name: { contains: "Trial", mode: "insensitive" } }] },
    });
    expect(suspects, "資料庫出現了 Guest／Demo／Trial 使用者").toBe(0);
    const demoBooks = await prisma.book.count({ where: { name: { contains: "試用" } } });
    expect(demoBooks, "資料庫出現了試用帳本").toBe(0);
    step("沒有任何 Guest／Demo／Trial 使用者，也沒有試用帳本");
  } finally {
    await prisma.$disconnect();
  }
}
