import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { readAttachment } from "@/server/services/attachments";

/** 讀取上傳的照片：必須登入，而且是同一個帳本的成員。 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const file = await readAttachment(user.id, id).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.attachment.mimeType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
