/** 在瀏覽器把照片縮到最長邊 1280px、JPEG 品質 0.8（通常 < 400KB）。失敗就用原檔。 */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * 頭貼：先從中間裁成正方形，再縮到 512×512、JPEG 品質 0.85（通常 < 100KB）。
 * 這樣不管使用者選的是直的還是橫的照片，存進去的都是正方形，圓形顯示才不會變形。
 * 失敗就退回原檔（伺服器那一側還會再驗一次格式與大小）。
 */
export async function cropSquare(file: File, size = 512): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - edge) / 2);
    const sy = Math.round((bitmap.height - edge) / 2);
    const out = Math.min(size, edge);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, edge, edge, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}
