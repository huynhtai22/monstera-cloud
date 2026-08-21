import prisma from "@/lib/prisma";
import {
  metaAdsClient,
  metaReportClient,
  MetaOAuthRevokedError,
  type MetaInsightsRow,
  type MetaAction,
} from "@/lib/meta-ads";
import { getValidOAuthToken } from "@/lib/oauth-framework/token-refresh";
import { getPlanLimits } from "@/lib/plan-config";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { upsertCampaignMetric } from "@/lib/ad-platform-ingest";
import { upsertOpenTicket } from "@/lib/support-ticket";

/** Campaign-level daily insights fields mapped into CampaignMetric */
const META_WAREHOUSE_FIELDS = [
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "cpc",
  "ctr",
  "actions",
  "action_values",
  "purchase_roas",
  "date_start",
  "date_stop",
];

export function normalizeMetaAdAccountIdForApi(adAccountId: string): string {
  return adAccountId.replace(/^act_/i, "");
}

function utcDay(dateYmd: string): Date {
  return new Date(`${dateYmd}T00:00:00.000Z`);
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseConversions(actions: unknown): number | null {
  if (!Array.isArray(actions)) return null;
  let sum = 0;
  let any = false;
  for (const raw of actions) {
    if (typeof raw !== "object" || !raw) continue;
    const a = raw as MetaAction;
    const t = a.action_type;
    if (
      t === "purchase" ||
      t === "offsite_conversion.fb_pixel_purchase" ||
      t === "omni_purchase" ||
      t === "web_in_store_purchase" ||
      t === "lead" ||
      t === "offsite_conversion.fb_pixel_lead"
    ) {
      sum += num(a.value);
      any = true;
    }
  }
  return any ? sum : null;
}

function parseRevenue(actionValues: unknown): number {
  if (!Array.isArray(actionValues)) return 0;
  for (const raw of actionValues) {
    if (typeof raw !== "object" || !raw) continue;
    const a = raw as MetaAction;
    const t = a.action_type;
    if (
      t === "purchase" ||
      t === "offsite_conversion.fb_pixel_purchase" ||
      t === "omni_purchase" ||
      t === "web_in_store_purchase"
    ) {
      const v = num(a.value);
      if (v > 0) return v;
    }
  }
  return 0;
}

function parseRoas(purchaseRoas: unknown): number | null {
  if (!Array.isArray(purchaseRoas) || purchaseRoas.length === 0) return null;
  const first = purchaseRoas[0] as { value?: string };
  return nullableFloat(first?.value);
}

function accountCurrency(
  creds: { adAccounts?: Array<{ id: string; currency?: string }> },
  actId: string,
): string | undefined {
  const idNorm = actId.startsWith("act_") ? actId : `act_${actId}`;
  const hit = creds.adAccounts?.find((a) => a.id === idNorm || a.id === actId);
  return hit?.currency?.trim() || undefined;
}

export interface SyncMetaWarehouseParams {
  workspaceId: string;
  connectionId: string;
  since: string;
  until: string;
  userPlan: string;
  /** When omitted, ingests every ad account stored on the connection */
  adAccountId?: string;
}

/**
 * Pulls Meta Insights (campaign × day) and upserts into CampaignMetric.
 * This Powers Data Explorer, Looker exports, and pipeline ETL reads.
 */
export async function syncMetaInsightsIntoWarehouse(
  params: SyncMetaWarehouseParams,
): Promise<{ upserted: number; accounts: number }> {
  const conn = await prisma.connection.findFirst({
    where: {
      id: params.connectionId,
      workspaceId: params.workspaceId,
      provider: "meta_ads",
      status: "connected",
    },
  });
  if (!conn) {
    throw new Error("Meta Ads connection not found for workspace");
  }

  const creds = parseConnectionCredentialsJson(safeDecrypt(conn.credentials)) as {
    adAccountIds?: string[];
    adAccounts?: Array<{ id: string; name?: string; currency?: string }>;
  };

  let accountIds =
    params.adAccountId != null && params.adAccountId !== ""
      ? [params.adAccountId]
      : (creds.adAccountIds ?? []);

  if (accountIds.length === 0 && creds.adAccounts?.length) {
    accountIds = creds.adAccounts.map((a) => a.id);
  }

  if (accountIds.length === 0 && conn.remoteAccountId && conn.remoteAccountId.trim().length > 0) {
    accountIds = [conn.remoteAccountId];
  }

  const range = { since: params.since, until: params.until };
  let accessToken: string;
  try {
    accessToken = await getValidOAuthToken(conn);
  } catch (err: any) {
    if (err instanceof MetaOAuthRevokedError || err?.message?.includes("190")) {
      await handleMetaRevocation(conn, params.workspaceId, err.message);
    }
    throw err;
  }

  if (accountIds.length === 0 && accessToken) {
    try {
      const apiAccounts = await metaAdsClient.getAdAccounts(accessToken);
      if (apiAccounts && apiAccounts.length > 0) {
        accountIds = apiAccounts.map((a) => a.id);
      }
    } catch (err: any) {
      if (err instanceof MetaOAuthRevokedError || err?.message?.includes("190")) {
        await handleMetaRevocation(conn, params.workspaceId, err.message);
        throw err;
      }
    }
  }

  if (accountIds.length === 0) {
    throw new Error("No Meta ad accounts on this connection. Reconnect Meta Ads.");
  }

  let total = 0;
  let acctCount = 0;

  for (const rawAct of accountIds) {
    acctCount += 1;
    const apiId = normalizeMetaAdAccountIdForApi(rawAct);
    let rows: MetaInsightsRow[] = [];
    try {
      rows = await metaReportClient.getInsights(accessToken, {
        adAccountId: apiId,
        fields: [...META_WAREHOUSE_FIELDS],
        level: "campaign",
        timeRange: { since: range.since, until: range.until },
        timeIncrement: 1,
      });
    } catch (err: any) {
      if (err instanceof MetaOAuthRevokedError || err?.message?.includes("190")) {
        await handleMetaRevocation(conn, params.workspaceId, err.message);
      }
      throw err;
    }

    const currency = accountCurrency(creds, rawAct);
    const accountIdStored = rawAct.startsWith("act_")
      ? rawAct
      : `act_${apiId}`;
    const accountName =
      creds.adAccounts?.find(
        (a) => a.id === accountIdStored || a.id === rawAct,
      )?.name ?? null;

    for (const row of rows) {
      const ok = await upsertOneRow({
        row,
        workspaceId: params.workspaceId,
        connectionId: conn.id,
        platform: "meta_ads",
        accountId: accountIdStored,
        accountName,
        currency,
      });
      if (ok) total += 1;
    }
  }

  return { upserted: total, accounts: acctCount };
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

async function upsertOneRow(opts: {
  row: MetaInsightsRow;
  workspaceId: string;
  connectionId: string;
  platform: string;
  accountId: string;
  accountName: string | null;
  currency?: string;
}): Promise<boolean> {
  const { row } = opts;
  const dateStr = row.date_start ?? row.date_stop;
  if (!dateStr || typeof dateStr !== "string") return false;

  const campaignId =
    row.campaign_id != null && String(row.campaign_id).trim() !== ""
      ? String(row.campaign_id)
      : null;
  if (!campaignId) return false;

  const campaignName =
    typeof row.campaign_name === "string" && row.campaign_name.trim() !== ""
      ? row.campaign_name
      : "Unknown campaign";

  const day = utcDay(dateStr.slice(0, 10));

  const impressions = Math.round(num(row.impressions));
  const clicks = Math.round(num(row.clicks));
  const spend = num(row.spend);
  const reach =
    row.reach !== undefined && row.reach !== ""
      ? Math.round(num(row.reach))
      : 0;
  const cpc = nullableFloat(row.cpc) ?? 0;
  const ctr = nullableFloat(row.ctr) ?? 0;
  const conversions = parseConversions(row.actions) ?? 0;
  const revenue = parseRevenue(row.action_values);
  const roas = parseRoas(row.purchase_roas) ?? 0;

  const rawPayload = {
    date_start: row.date_start,
    date_stop: row.date_stop,
  };

  await upsertCampaignMetric({
    workspaceId: opts.workspaceId,
    connectionId: opts.connectionId,
    platform: opts.platform,
    accountId: opts.accountId,
    accountName: opts.accountName ?? undefined,
    level: "campaign",
    entityId: campaignId,
    campaignId,
    campaignName,
    date: day,
    breakdownHash: "none",
    impressions,
    clicks,
    spend,
    reach,
    cpc,
    ctr,
    conversions,
    revenue,
    roas,
    currency: opts.currency,
    rawData: rawPayload,
  });

  return true;
}

/**
 * Rolling backfill window for scheduled pipelines: paid tiers use 90d when unlimited.
 */
export function metaWarehouseDefaultRange(
  userPlan: string,
): { since: string; until: string } {
  const limits = getPlanLimits(userPlan);
  const untilD = new Date();
  const until = untilD.toISOString().slice(0, 10);
  const daysBack = limits.maxHistoryDays ?? 90;
  const sinceD = new Date(untilD.getTime() - daysBack * 86400000);
  const since = sinceD.toISOString().slice(0, 10);
  return { since, until };
}

/**
 * Before reading CampaignMetric for Meta pipelines, refresh insights from Meta for the plan window.
 */
export async function refreshMetaWarehouseForPipeline(opts: {
  workspaceId: string;
  connectionId: string;
  userPlan: string;
}): Promise<void> {
  const { since, until } = metaWarehouseDefaultRange(opts.userPlan);
  await syncMetaInsightsIntoWarehouse({
    workspaceId: opts.workspaceId,
    connectionId: opts.connectionId,
    since,
    until,
    userPlan: opts.userPlan,
  });
}
