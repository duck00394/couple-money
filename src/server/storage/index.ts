/**
 * 物件儲存層（唯一的檔案讀寫入口）。
 *
 * 頭貼、記帳收據、任務打卡照片全部共用這一層，上面的服務只看得到
 * 「storageKey」這個字串，不知道檔案實際上放在哪裡。
 *
 * 兩個 driver：
 *   - `local`：寫在 `UPLOAD_DIR`（預設專案下的 `.uploads/`）。本機開發用。
 *   - `blob` ：Vercel Blob，`access: "private"`，檔案只能由伺服器讀取。
 *
 * 選哪一個：`STORAGE_DRIVER` 明確指定；沒指定時，有 `BLOB_READ_WRITE_TOKEN`
 * 就用 Vercel Blob，否則用本機磁碟。所以本機什麼都不用設就能跑，
 * 部署到 Vercel 只要接上 Blob store（Vercel 會自動注入那個環境變數）。
 *
 * 兩個 driver 的 key 格式完全一樣（`<bookId>/<uuid>.<ext>`），
 * 所以換 driver 不需要 migration，資料庫裡存的東西也不用動。
 */
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ObjectStorage {
  /** driver 名稱，只給診斷與測試用 */
  readonly name: "local" | "blob";
  /** 資料是否會長期保留（Vercel 這種沒有持久硬碟的平台，local driver 會消失） */
  readonly durable: boolean;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  /** 刪不到就當作已經刪掉，不要讓呼叫端因此失敗 */
  del(key: string): Promise<void>;
}

// ───────────────────────── local ─────────────────────────

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), ".uploads"));

/** 擋住 `../` 這種跳出上傳目錄的 key。 */
function resolveLocal(key: string): string | null {
  const root = uploadRoot();
  const full = path.resolve(root, key);
  return full.startsWith(root + path.sep) ? full : null;
}

const localStorage: ObjectStorage = {
  name: "local",
  // 本機開發是持久的；部署到沒有硬碟的平台時要改用 blob（見 DEPLOY.md）
  durable: !process.env.VERCEL,
  async put(key, body) {
    const full = resolveLocal(key);
    if (!full) throw new Error("INVALID_STORAGE_KEY");
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  },
  async get(key) {
    const full = resolveLocal(key);
    if (!full) return null;
    return readFile(full).catch(() => null);
  },
  async del(key) {
    const full = resolveLocal(key);
    if (!full) return;
    await unlink(full).catch(() => {});
  },
};

// ───────────────────────── Vercel Blob ─────────────────────────

/**
 * 只在真的要用的時候才載入 `@vercel/blob`，本機開發不會多拉這個套件的程式碼。
 * 全部走 `access: "private"`：Blob 的網址不會外流，讀取一律經過 /api/files/[id] 的權限檢查。
 */
const blobStorage: ObjectStorage = {
  name: "blob",
  durable: true,
  async put(key, body, contentType) {
    const { put } = await import("@vercel/blob");
    await put(key, body, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
  },
  async get(key) {
    const { get } = await import("@vercel/blob");
    const r = await get(key, { access: "private" }).catch(() => null);
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of r.stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  },
  async del(key) {
    const { del } = await import("@vercel/blob");
    await del(key).catch(() => {});
  },
};

// ───────────────────────── 選擇 driver ─────────────────────────

function pick(): ObjectStorage {
  const explicit = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (explicit === "blob") return blobStorage;
  if (explicit === "local") return localStorage;
  return process.env.BLOB_READ_WRITE_TOKEN ? blobStorage : localStorage;
}

let cached: ObjectStorage | null = null;

/** 目前生效的儲存層。第一次呼叫才決定，測試可以先改環境變數再呼叫。 */
export function storage(): ObjectStorage {
  if (!cached) cached = pick();
  return cached;
}

/** 只給測試用：讓下一次 `storage()` 重新依環境變數決定 driver。 */
export function resetStorageForTests() {
  cached = null;
}
