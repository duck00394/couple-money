import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { rejects, reset, setupCouple, prisma } from "./helpers";
import * as avatars from "../../src/server/services/avatars";
import * as books from "../../src/server/services/books";
import { AVATARS, avatarKeyOf, avatarSrc } from "../../src/lib/avatars";

const avatarUrlOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarUrl: true } })).avatarUrl;

/**
 * 頭貼：只能從專案內固定的圖片裡挑一張，不能上傳。
 * 存的是 `public/assets/avatars/` 下那張圖的路徑，沒有新增欄位、沒有 storage、
 * 也不會有任何使用者上傳的檔案。
 */
describe("V2：使用者頭貼（固定素材，不可上傳）", () => {
  let c: Awaited<ReturnType<typeof setupCouple>>;

  before(async () => {
    await reset();
    c = await setupCouple("av");
  });
  after(() => prisma.$disconnect());

  it("1. 一開始沒有頭貼，畫面會退回色塊 + 名字首字", async () => {
    assert.equal(await avatarUrlOf(c.aId), null);
  });

  it("2. 選一個固定頭貼 → avatarUrl 存的是 public 底下那張圖的路徑", async () => {
    await avatars.setMyAvatar(c.ctxA, "avatar-03");
    const url = await avatarUrlOf(c.aId);
    assert.equal(url, "/assets/avatars/avatar-03.png");
    assert.equal(avatarKeyOf(url), "avatar-03", "讀回來對得到同一個 key");
    assert.ok(!url!.startsWith("/api/files/"), "不是上傳的檔案");
    assert.ok(!url!.startsWith("data:"), "不是 base64");
  });

  it("3. 換一個 → 直接換掉，不會留下舊的", async () => {
    await avatars.setMyAvatar(c.ctxA, "avatar-07");
    assert.equal(await avatarUrlOf(c.aId), "/assets/avatars/avatar-07.png");
    assert.equal(
      await prisma.attachment.count({ where: { ownerType: avatars.AVATAR_OWNER_TYPE, ownerId: c.aId, deletedAt: null } }),
      0,
      "沒有任何頭貼附件（頭貼不走 Attachment）",
    );
  });

  it("4. 不認識的 key 會被擋下來，原本的頭貼不受影響", async () => {
    await rejects(avatars.setMyAvatar(c.ctxA, "avatar-99"), "AVATAR_UNKNOWN");
    await rejects(avatars.setMyAvatar(c.ctxA, "../../etc/passwd"), "AVATAR_UNKNOWN");
    await rejects(avatars.setMyAvatar(c.ctxA, ""), "AVATAR_UNKNOWN");
    assert.equal(await avatarUrlOf(c.aId), "/assets/avatars/avatar-07.png", "選失敗不會弄壞原本的頭貼");
  });

  it("5. 另一半看得到我換好的頭貼", async () => {
    const ctxB = await books.loadContext(c.bId, c.ctxA.book.id);
    const me = ctxB.members.find((m) => m.userId === c.aId)!;
    assert.equal(me.avatarUrl, "/assets/avatars/avatar-07.png");
  });

  it("6. 只會動到自己的：另一半換頭貼不影響我", async () => {
    await avatars.setMyAvatar(c.ctxB, "avatar-01");
    assert.equal(await avatarUrlOf(c.bId), "/assets/avatars/avatar-01.png");
    assert.equal(await avatarUrlOf(c.aId), "/assets/avatars/avatar-07.png");
  });

  it("7. 移除後回到預設，重複移除也不會出錯", async () => {
    await avatars.removeMyAvatar(c.ctxA);
    assert.equal(await avatarUrlOf(c.aId), null);
    await avatars.removeMyAvatar(c.ctxA);
    assert.equal(await avatarUrlOf(c.aId), null);
  });

  it("8. 清單裡每一個 key 都設得起來，而且圖檔真的存在", async () => {
    const { existsSync } = await import("node:fs");
    for (const a of AVATARS) {
      await avatars.setMyAvatar(c.ctxA, a.key);
      assert.equal(await avatarUrlOf(c.aId), avatarSrc(a.key));
      assert.ok(existsSync(`public${avatarSrc(a.key)}`), `public${avatarSrc(a.key)} 不存在`);
    }
    assert.ok(AVATARS.length >= 8 && AVATARS.length <= 12, "數量維持在好挑的範圍");
  });
});
