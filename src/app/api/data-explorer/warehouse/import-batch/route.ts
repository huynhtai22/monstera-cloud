import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { syncMetaInsightsIntoWarehouse } from "@/lib/ingestion/meta-campaign-metrics";
import { syncConnectionData } from "@/lib/sync-connection";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { logger } from "@/lib/logger";

const AD_PROVIDERS = new Set([
  "meta_ads",
  "google_ads",
  "tiktok_business",
  "shopee",
  "lazada",
]);

/** One import job — Meta may repeat per ad account id */
export interface BatchImportItem {
  connectionId: string;
  /** Meta only: constrain to one ad account; omit = all accounts on connection */
  adAccountId?: string;
}

/**
 * POST /api/data-explorer/warehouse/import-batch
 * Runs warehouse refresh for selected connections (and optional Meta ad accounts).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    workspaceId?: string;
    since?: string;
    until?: string;
    items?: BatchImportItem[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, since, until, items } = body;
  if (!workspaceId || !since || !until || !items?.length) {
    return NextResponse.json(
      { error: "workspaceId, since, until, and non-empty items[] are required" },
      { status: 400 },
    );
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(since) || !dateRe.test(until)) {
    return NextResponse.json({ error: "since and until must be YYYY-MM-DD" }, { status: 400 });
  }

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
  });
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true },
  });
  const plan = user?.plan ?? "free";

  const results: Array<{
    connectionId: string;
    provider: string;
    adAccountId?: string;
    ok: boolean;
    upserted?: number;
    rowsIngested?: number;
    error?: string;
  }> = [];

  const processedNonMetaConnections = new Set<string>();

  for (const item of items) {
    const conn = await prisma.connection.findFirst({
      where: {
        id: item.connectionId,
        workspaceId,
        type: "source",
      },
      select: { id: true, provider: true },
    });

    if (!conn || !AD_PROVIDERS.has(conn.provider)) {
      results.push({
        connectionId: item.connectionId,
        provider: conn?.provider ?? "unknown",
        adAccountId: item.adAccountId,
        ok: false,
        error: "Connection not found or not a supported ad warehouse source.",
      });
      continue;
    }

    try {
      if (conn.provider === "meta_ads") {
        const r = await syncMetaInsightsIntoWarehouse({
          workspaceId,
          connectionId: conn.id,
          since,
          until,
          userPlan: plan,
          adAccountId: item.adAccountId || undefined,
        });
        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          adAccountId: item.adAccountId,
          ok: true,
          upserted: r.upserted,
        });
      } else {
        if (processedNonMetaConnections.has(conn.id)) {
          continue;
        }
        processedNonMetaConnections.add(conn.id);
        const raw = safeDecrypt(
          (
            await prisma.connection.findUniqueOrThrow({
              where: { id: conn.id },
              select: { credentials: true },
            })
          ).credentials,
        );
        const credentials = parseConnectionCredentialsJson(raw) as Record<string, unknown>;
        const sync = await syncConnectionData({
          connectionId: conn.id,
          provider: conn.provider,
          credentials,
          workspaceId,
          since,
          until,
          userPlan: plan,
        });
        results.push({
          connectionId: conn.id,
          provider: conn.provider,
          ok: sync.success,
          rowsIngested: sync.rowsIngested,
          error: sync.error,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Import failed";
      logger.error("[warehouse/import-batch]", { connectionId: conn.id }, e);
      results.push({
        connectionId: conn.id,
        provider: conn.provider,
        adAccountId: item.adAccountId,
        ok: false,
        error: msg,
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const totalUpserts = results.reduce((s, r) => s + (r.upserted ?? r.rowsIngested ?? 0), 0);

  return NextResponse.json({
    success: okCount > 0,
    okCount,
    totalJobs: results.length,
    approximateRows: totalUpserts,
    results,
    message:
      okCount === results.length
        ? `All ${results.length} import job(s) completed.`
        : `${okCount}/${results.length} job(s) completed; see results for detail.`,
  });
}
