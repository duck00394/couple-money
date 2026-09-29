import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { $, rid, reset, setupCouple, prisma } from "./helpers";
import * as preorders from "../../src/server/services/preorders";
import * as ledger from "../../src/server/services/ledger";
import { payablePreorders } from "../../src/server/txFormData";
import { monthStats } from "../../src/server/services/stats";

const MONTH = "2026-09";
const D = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;

/**
 * 預購的預設分類：付款時自動帶入，統計才不會整包落在「未分類」。
 */
describe("V9：預購預設分類", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let shopping: string;

  const make = (categoryId: string | null) =>
    preorders.createPreorder(c.ctxA, {
      name: "預購", seller: "", emoji: "package", expectedOn: null,
      itemAmount: $(5000), shipping: 0, ownerId: c.aId, note: "", categoryId,
    });
  const pay = (id: string, amount: number, categoryId?: string | null) =>
    preorders.payPreorder(c.ctxA, id, {
      amount, accountId: c.accA, categoryId: categoryId as string | null, title: "預購付款", note: "",
      occurredOn: D(5), split: { method: "FULL", participants: [{ userId: c.aId }] },
      clientRequestId: rid(),
    });

  before(async () => {
    await reset();
    c = await setupCouple("po9");
    const cats = await ledger.listCategories(c.ctxA);
    shopping = cats.find((x) => x.name === "購物")!.id;
  });
  after(() => prisma.$disconnect());

  it("1. 建立時選的分類存得起來", async () => {
    const p = await make(shopping);
    assert.equal((await preorders.getPreorder(c.ctxA, p.id))!.categoryId, shopping);
  });

  it("2. 記錄付款沒指定分類時，自動帶預購的預設分類", async () => {
    const p = await make(shopping);
    const tx = await pay(p.id, $(2000), null);
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId, shopping);
  });

  it("3. 付款時自己選了分類，就用自己選的（預設只是預設）", async () => {
    const cats = await ledger.listCategories(c.ctxA);
    const other = cats.find((x) => x.name === "娛樂")!.id;
    const p = await make(shopping);
    const tx = await pay(p.id, $(1000), other);
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId, other);
  });

  it("4. 預購沒設分類時，行為跟以前一樣（不分類）", async () => {
    const p = await make(null);
    const tx = await pay(p.id, $(500), null);
    assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).categoryId, null);
  });

  it("5. 統計不再整包落在「未分類」", async () => {
    await reset();
    c = await setupCouple("po9b");
    const cats = await ledger.listCategories(c.ctxA);
    const id = cats.find((x) => x.name === "購物")!.id;
    const p = await make(id);
    await pay(p.id, $(3000), null);

    const stats = await monthStats(c.ctxA, MONTH);
    assert.ok(!stats.categories.some((x) => x.name === "未分類"), "沒有「未分類」那一塊");
    assert.equal(stats.categories.find((x) => x.categoryId === id)!.amount, $(3000));
  });

  it("6. 記帳頁的預購選單也帶著預設分類，好在選預購時自動填", async () => {
    const hit = (await payablePreorders(c.ctxA))[0];
    const cats = await ledger.listCategories(c.ctxA);
    assert.equal(hit.categoryId, cats.find((x) => x.name === "購物")!.id);
  });

  it("7. 分類被停用之後，預購仍然指得到它（不會壞掉）", async () => {
    const cats = await ledger.listCategories(c.ctxA);
    const id = cats.find((x) => x.name === "購物")!.id;
    await prisma.category.update({ where: { id }, data: { isArchived: true } });
    const list = await payablePreorders(c.ctxA);
    assert.equal(list[0].categoryId, id);
    await prisma.category.update({ where: { id }, data: { isArchived: false } });
  });
});
