import prisma from "@/lib/prisma";
import { upsertOpenTicket } from "@/lib/support-ticket";

export function normalizeMetaAdAccountIdForApi(adAccountId: string): string {
  return adAccountId.replace(/^act_/i, "");
}

export async function handleMetaRevocation(
  conn: { id: string; name?: string | null; remoteAccountId?: string | null },
  workspaceId: string,
  errorMsg: string,
) {
  await prisma.connection.update({
    where: { id: conn.id },
    data: { status: "disconnected" },
  });
  await upsertOpenTicket({
    workspaceId,
    reason: "auth",
    title: `Meta Ads authorization revoked (Account: ${conn.name || conn.remoteAccountId || conn.id})`,
    errorMsg,
    connectionId: conn.id,
    tag: "meta_ads_error_190",
  });
}
