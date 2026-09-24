import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rejects, reset, setupCouple, prisma } from "./helpers";
import * as avatars from "../../src/server/services/avatars";
import * as books from "../../src/server/services/books";
import { readAttachment } from "../../src/server/services/attachments";
import { MAX_AVATAR_BYTES } from "../../src/server/domain/receipt";
import { storage } from "../../src/server/storage";

/** 一張最小但合法的 PNG。 */
function png(name = "me.png", bytes = 64): File {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 7)])], name, { type: "image/png" });
}
function jpg(name = "me.jpg", bytes = 64): File {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  return new File([Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 3)])], name, { type: "image/jpeg" });
}
function webp(name = "me.webp"): File {
  const b = Buffer.alloc(64, 0);
  Buffer.from("RIFF").copy(b, 0);
  Buffer.from("WEBP").copy(b, 8);
  return new File([b], name, { type: "image/webp" });
}
const gif = () => new File([Buffer.from("GIF89a....")], "me.gif", { type: "image/gif" });
const fakePng = () => new File([Buffer.from("%PDF-1.7 not an image")], "me.png", { type: "image/png" });

const avatarUrlOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarUrl: true } })).avatarUrl;

describe("V2：使用者頭貼", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;
  let other: Awaited<ReturnType<typeof setupCouple>>;

  before(async () => {
    await reset();
    c = await setupCouple("av");
    other = await setupCouple("ov");
  });
  after(() => prisma.$disconnect());

  // ───────── 1：上傳 ─────────

  it("上傳頭貼後，User.avatarUrl 指向 /api/files/<attachmentId>，而且檔案讀得到", async () => {
    assert.equal(await avatarUrlOf(c.aId), null, "一開始沒有頭貼");
    const r = await avatars.setMyAvatar(c.ctxA, png());

    assert.equal(r.avatarUrl, `/api/files/${r.attachmentId}`);
    assert.equal(await avatarUrlOf(c.aId), r.avatarUrl);

    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: r.attachmentId } });
    assert.equal(att.ownerType, "AVATAR");
    assert.equal(att.ownerId, c.aId, "掛在自己身上");
    assert.equal(att.bookId, c.ctxA.book.id);

    const file = await readAttachment(c.aId, r.attachmentId);
    assert.ok(file, "自己讀得到");
    assert.equal(file.attachment.mimeType, "image/png");
    assert.ok(file.data.length > 0);
  });

  // ───────── 2：格式 ─────────

  it("只收 JPG／PNG／WebP，其他格式與假圖片都會被擋下來", async () => {
    await avatars.setMyAvatar(c.ctxB, jpg());
    assert.equal((await avatarUrlOf(c.bId))?.startsWith("/api/files/"), true, "JPG 可以");
    await avatars.setMyAvatar(c.ctxB, webp());
    assert.ok(await avatarUrlOf(c.bId), "WebP 可以");

    const before = await avatarUrlOf(c.bId);
    await rejects(avatars.setMyAvatar(c.ctxB, gif()), "UPLOAD_TYPE");
    await rejects(avatars.setMyAvatar(c.ctxB, fakePng()), "UPLOAD_TYPE"); // 副檔名對、內容不是圖
    assert.equal(await avatarUrlOf(c.bId), before, "被擋下來的不會動到原本的頭貼");
  });

  // ───────── 3：大小 ─────────

  it("超過 2MB 會被擋下來，剛好 2MB 可以", async () => {
    assert.equal(MAX_AVATAR_BYTES, 2 * 1024 * 1024);
    await rejects(avatars.setMyAvatar(c.ctxA, png("big.png", MAX_AVATAR_BYTES + 1)), "UPLOAD_SIZE");
    const ok = await avatars.setMyAvatar(c.ctxA, png("exact.png", MAX_AVATAR_BYTES));
    assert.ok(ok.avatarUrl);
    await avatars.setMyAvatar(c.ctxA, png()); // 換回小張的，後面的測試比較好讀
  });

  // ───────── 4：更換 ─────────

  it("換新頭貼會把舊的一起清掉（資料庫與實體檔案都不留垃圾）", async () => {
    const oldUrl = await avatarUrlOf(c.aId);
    const oldAtt = await avatars.currentAvatar(c.aId);
    assert.ok(oldAtt);

    const r = await avatars.setMyAvatar(c.ctxA, jpg("new.jpg"));
    assert.notEqual(r.avatarUrl, oldUrl, "網址換了");
    assert.equal(await avatarUrlOf(c.aId), r.avatarUrl);

    const gone = await prisma.attachment.findUniqueOrThrow({ where: { id: oldAtt.id } });
    assert.ok(gone.deletedAt, "舊的標記成已刪除");
    assert.equal(await storage().get(oldAtt.storageKey), null, "舊的實體檔案也刪掉了");
    assert.equal(await readAttachment(c.aId, oldAtt.id), null, "舊網址讀不到了");

    const live = await prisma.attachment.count({
      where: { ownerType: "AVATAR", ownerId: c.aId, deletedAt: null },
    });
    assert.equal(live, 1, "同一個人永遠只有一張有效頭貼");
  });

  // ───────── 5：移除 ─────────

  it("移除頭貼後回到預設（avatarUrl = null），而且可以再傳一次", async () => {
    const att = await avatars.currentAvatar(c.aId);
    assert.ok(att);

    const r = await avatars.removeMyAvatar(c.ctxA);
    assert.equal(r.removed, 1);
    assert.equal(await avatarUrlOf(c.aId), null, "回到預設的色塊 + 名字首字");
    assert.equal(await readAttachment(c.aId, att.id), null);
    assert.equal(await storage().get(att.storageKey), null);

    await avatars.removeMyAvatar(c.ctxA); // 已經沒有頭貼了，再移除一次也不能出錯
    assert.equal(await avatarUrlOf(c.aId), null);

    const again = await avatars.setMyAvatar(c.ctxA, png("again.png"));
    assert.equal(await avatarUrlOf(c.aId), again.avatarUrl, "移除之後還能再傳");
  });

  // ───────── 6：只能改自己的 ─────────

  it("換頭貼只會動到自己：A 換了 B 完全不受影響，而且沒有任何地方可以指定別人", async () => {
    const bBefore = await avatarUrlOf(c.bId);
    await avatars.setMyAvatar(c.ctxA, jpg("a-again.jpg"));
    assert.equal(await avatarUrlOf(c.bId), bBefore, "B 的頭貼沒被動到");

    await avatars.removeMyAvatar(c.ctxA);
    assert.equal(await avatarUrlOf(c.bId), bBefore, "A 移除自己的也不會動到 B");
    await avatars.setMyAvatar(c.ctxA, png());

    // setMyAvatar / removeMyAvatar 都只吃 ctx，沒有 userId 參數可以帶
    assert.equal(avatars.setMyAvatar.length, 2, "(ctx, file)");
    assert.equal(avatars.removeMyAvatar.length, 1, "(ctx)");
  });

  // ───────── 7：另一半看得到、外人看不到 ─────────

  it("另一半看得到頭貼，別的帳本的人讀不到", async () => {
    const att = await avatars.currentAvatar(c.aId);
    assert.ok(att);
    assert.ok(await readAttachment(c.bId, att.id), "同帳本的另一半看得到");
    assert.equal(await readAttachment(other.aId, att.id), null, "別的帳本讀不到");

    const ctx = await books.loadContext(c.bId, c.ctxA.book.id);
    const me = ctx.members.find((m) => m.userId === c.aId)!;
    assert.equal(me.avatarUrl, await avatarUrlOf(c.aId), "帳本 context 會帶出頭貼網址");
    assert.ok(ctx.me.avatarColor, "沒有頭貼時要用的預設顏色一直都在");
  });

  // ───────── 8：不影響任何財務資料 ─────────

  it("頭貼完全不碰交易、分帳、餘額，唯讀成員也能改自己的頭貼", async () => {
    const snapshot = async () => ({
      tx: await prisma.transaction.count(),
      splits: await prisma.transactionSplit.count(),
      payments: await prisma.transactionPayment.count(),
      accounts: await prisma.account.count(),
    });
    const before = await snapshot();
    await avatars.setMyAvatar(c.ctxA, jpg("x.jpg"));
    await avatars.removeMyAvatar(c.ctxA);
    await avatars.setMyAvatar(c.ctxA, png());
    assert.deepEqual(await snapshot(), before, "財務資料一筆都沒動");

    // 帳本轉為唯讀之後，仍然可以換自己的頭貼（那是使用者自己的資料）
    const readOnly = { ...c.ctxA, canWrite: false };
    const r = await avatars.setMyAvatar(readOnly, jpg("readonly.jpg"));
    assert.ok(r.avatarUrl);
  });

  // ───────── 儲存層 ─────────

  it("附件全部走同一層 object storage：頭貼寫進去讀得回來，刪掉就沒了", async () => {
    const s = storage();
    assert.ok(["local", "blob"].includes(s.name), "driver 只有這兩種");

    const att = await avatars.currentAvatar(c.aId);
    assert.ok(att);
    const data = await s.get(att.storageKey);
    assert.ok(data && data.length > 0, "同一個 storageKey 讀得回內容");
    assert.match(att.storageKey, new RegExp(`^${c.ctxA.book.id}/`), "key 以帳本 id 開頭，收據與打卡照片同一套規則");

    assert.equal(await s.get("../../etc/passwd"), null, "跳不出上傳目錄");
    await s.del(att.storageKey);
    assert.equal(await s.get(att.storageKey), null);
  });
});
