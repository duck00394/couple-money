import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertImage, IMAGE_TYPES, MAX_RECEIPTS, MAX_UPLOAD_BYTES, sniffImage } from "../../src/server/domain/receipt";
import { DomainError } from "../../src/server/domain/errors";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const PDF = Buffer.from("%PDF-1.7\n%aaa");

const fails = (fn: () => unknown, code: string) =>
  assert.throws(fn, (e: unknown) => e instanceof DomainError && e.code === code);

describe("Phase 3-4 E：收據照片（純邏輯）", () => {
  it("認得 JPG／PNG／WebP 的檔頭", () => {
    assert.equal(sniffImage(PNG), "png");
    assert.equal(sniffImage(JPEG), "jpg");
    assert.equal(sniffImage(WEBP), "webp");
  });

  it("不是圖片的檔案認不出來", () => {
    assert.equal(sniffImage(PDF), null);
    assert.equal(sniffImage(Buffer.alloc(0)), null);
    assert.equal(sniffImage(Buffer.from("<html>hello</html>")), null);
  });

  it("只接受三種圖片格式", () => {
    assert.deepEqual(Object.keys(IMAGE_TYPES).sort(), ["image/jpeg", "image/png", "image/webp"]);
    assert.equal(assertImage({ type: "image/png", size: PNG.length }, PNG), "png");
    assert.equal(assertImage({ type: "image/jpeg", size: JPEG.length }, JPEG), "jpg");
    assert.equal(assertImage({ type: "image/webp", size: WEBP.length }, WEBP), "webp");
    fails(() => assertImage({ type: "application/pdf", size: PDF.length }, PDF), "UPLOAD_TYPE");
    fails(() => assertImage({ type: "image/gif", size: 10 }, PNG), "UPLOAD_TYPE");
    fails(() => assertImage({ type: "text/html", size: 10 }, PNG), "UPLOAD_TYPE");
  });

  it("副檔名對但內容不是圖片會被擋下（client 端驗證繞不過去）", () => {
    fails(() => assertImage({ type: "image/png", size: PDF.length }, PDF), "UPLOAD_TYPE");
    fails(() => assertImage({ type: "image/jpeg", size: PNG.length }, PNG), "UPLOAD_TYPE");
    fails(() => assertImage({ type: "image/webp", size: JPEG.length }, JPEG), "UPLOAD_TYPE");
  });

  it("大小限制：0 位元組與超過 4MB 都不行", () => {
    assert.equal(MAX_UPLOAD_BYTES, 4 * 1024 * 1024);
    fails(() => assertImage({ type: "image/png", size: 0 }, PNG), "UPLOAD_SIZE");
    fails(() => assertImage({ type: "image/png", size: MAX_UPLOAD_BYTES + 1 }, PNG), "UPLOAD_SIZE");
    assert.equal(assertImage({ type: "image/png", size: MAX_UPLOAD_BYTES }, PNG), "png", "剛好 4MB 可以");
  });

  it("每筆記帳的收據張數上限是私人 App 的規模", () => {
    assert.equal(MAX_RECEIPTS, 3);
  });
});
