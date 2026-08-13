import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { requireCronSecret } from "@/lib/request-auth";
import { syncConnectionData } from "@/lib/sync-connection";

const PILOT_PROVIDERS = new Set(["meta_ads", "google_ads", "tiktok_business", "shopee"]);

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

/** Nightly warehouse-only refresh. It does not execute destination pipelines. */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const workspaces = await prisma.workspace.findMany({
    where: { status: { in: ["PILOT", "ACTIVE"] } },
    select: {
      id: true,
      plan: true,
      providerAccess: { where: { enabled: true }, select: { provider: true } },
      connections: {
        where: { type: "source", status: "connected" },
        select: { id: true, provider: true, credentials: true },
      },
    },
  });

  const jobs = workspaces.flatMap((workspace) => {
    const enabled = new Set(workspace.providerAccess.map((access) => access.provider));
    return workspace.connections
      .filter((connection) => PILOT_PROVIDERS.has(connection.provider) && enabled.has(connection.provider))
      .map((connection) => ({ workspace, connection }));
  });

  const results: Array<{ workspaceId: string; connectionId: string; provider: string; ok: boolean; rows: number; error?: string }> = [];
  for (let index = 0; index < jobs.length; index += 3) {
    const batch = jobs.slice(index, index + 3);
    const settled = await Promise.all(batch.map(async ({ workspace, connection }) => {
      try {
        const credentials = parseConnectionCredentialsJson(safeDecrypt(connection.credentials)) as Record<string, unknown>;
        const result = await syncConnectionData({
          workspaceId: workspace.id,
          connectionId: connection.id,
          provider: connection.provider,
          credentials,
          userPlan: workspace.plan,
          since: isoDate(-29),
          until: isoDate(),
        });
        if (result.success) {
          await prisma.connection.updateMany({
            where: { id: connection.id, workspaceId: workspace.id },
            data: { lastSyncAt: new Date(), lastError: null },
          });
        }
        return {
          workspaceId: workspace.id,
          connectionId: connection.id,
          provider: connection.provider,
          ok: result.success,
          rows: result.rowsIngested,
          ...(result.error ? { error: result.error } : {}),
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Refresh failed";
        logger.error("[NIGHTLY_WAREHOUSE_REFRESH]", { workspaceId: workspace.id, connectionId: connection.id, provider: connection.provider }, error);
        await prisma.connection.updateMany({
          where: { id: connection.id, workspaceId: workspace.id },
          data: { lastError: message },
        });
        return { workspaceId: workspace.id, connectionId: connection.id, provider: connection.provider, ok: false, rows: 0, error: message };
      }
    }));
    results.push(...settled);
  }

  const succeeded = results.filter((result) => result.ok).length;
  logger.info("[NIGHTLY_WAREHOUSE_REFRESH_COMPLETE]", { total: results.length, succeeded, failed: results.length - succeeded });
  return NextResponse.json({ total: results.length, succeeded, failed: results.length - succeeded, results });
}
