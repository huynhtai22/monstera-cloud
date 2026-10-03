import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { syncGoogleAdsIntoWarehouse, syncTikTokIntoWarehouse } from "@/lib/ingestion/ad-platform-warehouse";
import { syncConnectionData } from "@/lib/sync-connection";
import { logger } from "@/lib/logger";
import { decrypt } from "@/lib/encryption";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { HistoricalBackfillPlanningError } from "@/lib/historical-backfill-plan";
import {
  assertExecutableWarehouseRange,
  getOversizedExecutionDetails,
  toOversizedExecutionResponse,
} from "@/lib/warehouse-execution-guard";

const WAREHOUSE_COLUMN_LIST = [
  "date",
  "platform",
  "accountId",
  "accountName",
  "campaignId",
  "campaignName",
  "impressions",
  "clicks",
  "spend",
  "cpc",
  "ctr",
  "conversions",
  "roas",
  "currency",
] as const;

/**
 * POST /api/data-explorer/warehouse/import
 * Body: { workspaceId, connectionId, since, until, adAccountId? }
 * Pulls provider metrics into CampaignMetric. Meta delegates to the same
 * fenced ad-day sync primitive used by scheduled and pipeline execution.
 */
export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    workspaceId?: string;
    connectionId?: string;
    since?: string;
    until?: string;
    adAccountId?: string; // meta
    accountId?: string; // google/tiktok
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workspaceId, connectionId, since, until, adAccountId, accountId } = body;
  if (!workspaceId || !connectionId || !since || !until) {
    return NextResponse.json(
      { error: "workspaceId, connectionId, since, until are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(since) || !dateRe.test(until)) {
    return NextResponse.json(
      { error: "since and until must be YYYY-MM-DD" },
      { status: 400 },
    );
  }

  try {
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member", operation: "import_warehouse" });
  } catch (err) {
    const rbacRes = toRbacResponse(err);
    if (rbacRes) return rbacRes;
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  const plan = workspace?.plan ?? "pilot";

  try {
    const conn = await prisma.connection.findFirst({
      where: { id: connectionId, workspaceId, type: "source" },
      select: { provider: true, credentials: true },
    });
    if (!conn) {
      return NextResponse.json({ error: "Connection not found in workspace" }, { status: 404 });
    }

    const provider = conn.provider;
    // Shared raw-range guard: evaluates the original caller range before any
    // plan clamp, job creation, worker dispatch, database write, or provider
    // contact. Meta/Google ranges over 30 inclusive days fail closed here.
    try {
      assertExecutableWarehouseRange({ provider, since, until });
    } catch (guardError) {
      const oversized = getOversizedExecutionDetails(guardError);
      if (oversized) {
        return NextResponse.json(
          toOversizedExecutionResponse(oversized.provider, oversized.requestedRange, oversized.maxExecutableDays),
          { status: 422 },
        );
      }
      if (guardError instanceof HistoricalBackfillPlanningError) {
        const status = guardError.code === "INVALID_DATE_RANGE" ? 400 : 422;
        // Preserve the canonical date-validation response for malformed or
        // reversed dates; unavailable ingestion remains a visible rejection
        // before any provider contact.
        if (guardError.code === "WAREHOUSE_INGESTION_UNAVAILABLE") {
          return NextResponse.json(
            { error: guardError.message, code: guardError.code },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { error: guardError.message, code: guardError.code },
          { status },
        );
      }
      throw guardError;
    }

    const credentials = JSON.parse(decrypt(conn.credentials));

    if (provider === "meta_ads") {
      const selectedCredentials = adAccountId
        ? {
          ...credentials,
          selectedAdAccountIds: [adAccountId],
          extraFields: { ...(credentials.extraFields ?? {}), selectedAdAccountIds: [adAccountId] },
        }
        : credentials;
      const result = await syncConnectionData({
        workspaceId,
        connectionId,
        provider,
        credentials: selectedCredentials,
        since,
        until,
        userPlan: plan,
      });
      if (!result.success) throw new Error(result.error ?? "Meta import did not complete");

      return NextResponse.json({
        success: true,
        provider,
        upserted: result.rowsIngested,
        accounts: result.children.length,
        columns: [...WAREHOUSE_COLUMN_LIST],
        message: `Imported ${result.rowsIngested} ad-day rows from ${result.children.length} ad account(s).`,
      });
    }

    if (provider === "google_ads") {
      const result = await syncGoogleAdsIntoWarehouse({
        workspaceId,
        connectionId,
        credentials,
        since,
        until,
        customerId: accountId || undefined,
      });

      return NextResponse.json({
        success: true,
        provider,
        upserted: result.upserted,
        accounts: result.accounts,
        failed: result.failed,
        columns: [...WAREHOUSE_COLUMN_LIST],
        message: `Imported ${result.upserted} campaign-day rows from ${result.accounts} customer account(s).`,
      });
    }

    if (provider === "tiktok_business") {
      const result = await syncTikTokIntoWarehouse({
        workspaceId,
        connectionId,
        credentials,
        since,
        until,
        advertiserId: accountId || undefined,
      });

      return NextResponse.json({
        success: true,
        provider,
        upserted: result.upserted,
        accounts: result.accounts,
        failed: result.failed,
        columns: [...WAREHOUSE_COLUMN_LIST],
        message: `Imported ${result.upserted} campaign-day rows from ${result.accounts} advertiser account(s).`,
      });
    }

    return NextResponse.json(
      { error: `Provider not supported for warehouse import: ${provider}` },
      { status: 400 },
    );
  } catch (e: any) {
    logger.error("[warehouse/import]", e);
    const msg =
      e instanceof Error ? e.message : typeof e === "string" ? e : "Import failed";
    const hint =
      msg.includes("credentials") || msg.includes("JSON") || msg.includes("parse")
        ? " If this persists, disconnect Meta under Sources and connect again."
        : "";
    return NextResponse.json({ error: `${msg}${hint}` }, { status: 500 });
  }
}
