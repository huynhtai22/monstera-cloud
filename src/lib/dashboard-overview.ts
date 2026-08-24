import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { logger } from "@/lib/logger";
import { aggregateCurrencySafe } from "@/lib/currency-safe-aggregation";

export interface DashboardSourceItem {
  id: string;
  provider: string;
  name: string;
  accountCount: number;
  accountTags: string[];
  state: "fresh" | "stale" | "error" | "syncing" | "pending" | "disconnected";
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface DashboardIssueItem {
  id: string;
  title: string;
  explanation: string;
  rawDetails?: string;
  actionType: "reconnect" | "retry" | "review";
  actionLabel: string;
  href?: string;
  connectionId?: string;
  provider?: string;
  timestamp: string;
}

export interface DashboardActivityItem {
  id: string;
  type: "sync_success" | "sync_error" | "warehouse_refresh" | "looker_query" | "connection_added";
  title: string;
  description: string;
  timestamp: string;
  status: "success" | "error" | "info" | "warning";
}

export interface DashboardDestinationItem {
  id: string;
  type: "sheets" | "looker" | "api";
  name: string;
  status:
    | "healthy"
    | "ready"
    | "active"
    | "syncing"
    | "partial"
    | "stale"
    | "error"
    | "unconfigured";
  subtext: string;
  href: string;
}

export interface DashboardOverviewDTO {
  workspace: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
  overallStatus: {
    state: "healthy" | "attention" | "syncing" | "onboarding";
    headline: string;
    supportingText: string;
  };
  summaryCards: {
    sources: {
      total: number;
      healthy: number;
      attention: number;
      accountsTotal: number;
      label: string;
      subtext: string;
    };
    warehouse: {
      status: "fresh" | "stale" | "refreshing" | "partial" | "failed" | "never";
      dataThroughDate: string | null;
      totalRows: number;
      rows7d: number;
      asOf: string | null;
    };
    syncs: {
      successful7d: number;
      failed7d: number;
      lastSyncTimeAgo: string | null;
    };
    destinations: {
      activeCount: number;
      list: string[];
    };
  };
  needsAttention: DashboardIssueItem[];
  sourcesList: DashboardSourceItem[];
  warehouseSnapshot: {
    hasData: boolean;
    dataThroughDate: string | null;
    lastRefreshAt: string | null;
    metrics7d: {
      impressions: number;
      clicks: number;
      conversions: number;
      mixedCurrency: boolean;
      byCurrency: Array<{
        currency: string;
        spend: number;
        revenue: number;
        roas: number;
      }>;
    };
  };
  destinationsList: DashboardDestinationItem[];
  recentActivity: DashboardActivityItem[];
}

const PROVIDER_NAMES: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  shopify: "Shopify",
  amazon: "Amazon",
  lazada: "Lazada",
};

type DashboardDestinationConnectionInput = {
  id: string;
  provider: string;
  status: string;
};

type DashboardDestinationPipelineInput = {
  destinationConnectionId: string;
  status: string;
  healthStatus: string;
  lastSyncedAt: Date | null;
  destinationConnection: {
    provider: string;
    status: string;
  };
};

export function resolveDashboardSourceState(input: {
  connectionStatus: string;
  lastError: string | null;
  lastSyncAt: Date | null;
  isSyncing: boolean;
  staleBefore: Date;
}): DashboardSourceItem["state"] {
  if (input.connectionStatus === "error" || input.lastError) return "error";
  if (input.connectionStatus !== "connected") return "disconnected";
  if (input.isSyncing) return "syncing";
  if (!input.lastSyncAt) return "pending";
  return input.lastSyncAt < input.staleBefore ? "stale" : "fresh";
}

export function resolveDashboardWarehouseStatus(input: {
  latestImportStatus?: string | null;
  latestImportAt?: Date | null;
  latestSyncStatus?: string | null;
  lastPulledAt: Date | null;
  staleBefore: Date;
}): DashboardOverviewDTO["summaryCards"]["warehouse"]["status"] {
  if (input.latestImportStatus === "running" || input.latestSyncStatus === "running") {
    return "refreshing";
  }
  const importOutcomeIsCurrent = Boolean(
    input.latestImportAt &&
      (!input.lastPulledAt || input.latestImportAt >= input.lastPulledAt),
  );
  if (importOutcomeIsCurrent && input.latestImportStatus === "failed") return "failed";
  if (importOutcomeIsCurrent && input.latestImportStatus === "partial") return "partial";
  if (!input.lastPulledAt) return "never";
  return input.lastPulledAt >= input.staleBefore ? "fresh" : "stale";
}

export function latestValidDate(
  values: Array<Date | string | null | undefined>,
): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    const candidate = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(candidate.getTime())) continue;
    if (!latest || candidate > latest) latest = candidate;
  }
  return latest;
}

export function summarizeDashboardSyncCounts(
  groups: Array<{ status: string; _count: { _all: number } }>,
): { successful: number; failed: number } {
  return {
    successful: groups.find((group) => group.status === "success")?._count._all ?? 0,
    failed: groups.find((group) => group.status === "error")?._count._all ?? 0,
  };
}

export function buildDashboardDestinations(input: {
  destinationConnections: DashboardDestinationConnectionInput[];
  pipelines: DashboardDestinationPipelineInput[];
  apiKeysCount: number;
  latestLookerStatus?: string | null;
  hasCompletedLookerQuery?: boolean;
}): { list: DashboardDestinationItem[]; activeNames: string[] } {
  const sheetsConnections = input.destinationConnections.filter(
    (connection) => connection.provider === "google_sheets",
  );
  const sheetsConnectionIds = new Set(sheetsConnections.map((connection) => connection.id));
  const sheetsPipelines = input.pipelines.filter(
    (pipeline) =>
      pipeline.destinationConnection.provider === "google_sheets" ||
      sheetsConnectionIds.has(pipeline.destinationConnectionId),
  );

  const hasActiveSheetsPipeline = sheetsPipelines.some(
    (pipeline) =>
      pipeline.status === "active" &&
      pipeline.healthStatus === "healthy" &&
      pipeline.lastSyncedAt !== null &&
      pipeline.destinationConnection.status === "connected",
  );
  const hasSheetsError =
    sheetsConnections.some((connection) => connection.status !== "connected") ||
    sheetsPipelines.some((pipeline) => pipeline.healthStatus === "error");
  const hasStaleSheetsPipeline = sheetsPipelines.some(
    (pipeline) => pipeline.healthStatus === "stale",
  );
  const hasConfiguredSheets = sheetsConnections.some(
    (connection) => connection.status === "connected",
  );

  const sheetsStatus: DashboardDestinationItem["status"] =
    hasActiveSheetsPipeline && (hasSheetsError || hasStaleSheetsPipeline)
      ? "partial"
      : hasSheetsError
        ? "error"
        : hasStaleSheetsPipeline
          ? "stale"
          : hasActiveSheetsPipeline
            ? "healthy"
            : hasConfiguredSheets
              ? "ready"
              : "unconfigured";

  const latestLookerStatus = input.latestLookerStatus ?? null;
  const lookerStatus: DashboardDestinationItem["status"] =
    input.apiKeysCount === 0
      ? "unconfigured"
      : latestLookerStatus === "failed"
        ? "error"
        : latestLookerStatus === "queued" || latestLookerStatus === "running"
          ? "syncing"
        : latestLookerStatus === "done"
          ? "healthy"
          : input.hasCompletedLookerQuery
            ? "healthy"
          : "ready";
  const apiStatus: DashboardDestinationItem["status"] =
    input.apiKeysCount > 0 ? "active" : "unconfigured";

  const list: DashboardDestinationItem[] = [
    {
      id: "dest-sheets",
      type: "sheets",
      name: "Google Sheets",
      status: sheetsStatus,
      subtext:
        sheetsStatus === "healthy"
          ? "Scheduled export pipeline active"
          : sheetsStatus === "partial"
            ? "Some export pipelines need attention"
          : sheetsStatus === "error"
            ? "Export connection needs attention"
            : sheetsStatus === "stale"
              ? "Export pipeline has not synced recently"
              : sheetsStatus === "ready"
                ? "Connected; waiting for a successful export"
                : "Set up an export or use the Sheets add-on",
      href: "/exports",
    },
    {
      id: "dest-looker",
      type: "looker",
      name: "Looker Studio",
      status: lookerStatus,
      subtext:
        lookerStatus === "healthy"
          ? "Recent connector query completed"
          : lookerStatus === "syncing"
            ? latestLookerStatus === "queued"
              ? "Connector query queued"
              : "Connector query in progress"
          : lookerStatus === "error"
            ? "Latest connector query failed"
            : lookerStatus === "ready"
              ? "API key configured; awaiting first query"
              : "Create an API key to connect",
      href: "/looker-studio",
    },
    {
      id: "dest-api",
      type: "api",
      name: "REST API & CSV",
      status: apiStatus,
      subtext:
        apiStatus === "active"
          ? "Workspace API key configured"
          : "Create an API key to enable access",
      href: "/exports",
    },
  ];

  const activeNames = list
    .filter(
      (destination) =>
        destination.status === "healthy" ||
        destination.status === "active" ||
        destination.status === "syncing",
    )
    .map((destination) =>
      destination.type === "sheets"
        ? "Sheets"
        : destination.type === "looker"
          ? "Looker Studio"
          : "REST API",
    );

  return { list, activeNames };
}

/**
 * Sanitize known raw technical/engineering errors into clean user-facing language.
 * Internal operator notes (e.g. "Run encrypt-connection-credentials before deployment")
 * are completely omitted from the user-facing explanation.
 */
function sanitizeUserFacingError(
  raw: string | null,
  providerName: string
): { title: string; explanation: string; actionType: "reconnect" | "retry" | "review"; actionLabel: string } {
  if (!raw) {
    return {
      title: `${providerName} needs attention`,
      explanation: "Connection encountered an unexpected issue.",
      actionType: "review",
      actionLabel: "Review",
    };
  }

  const m = raw.toLowerCase();

  if (
    m.includes("token") ||
    m.includes("expired") ||
    m.includes("oauth") ||
    m.includes("error 190") ||
    m.includes("401") ||
    m.includes("unauthorized") ||
    m.includes("revoked") ||
    m.includes("session has expired")
  ) {
    return {
      title: `${providerName} needs reconnecting`,
      explanation: "Authorization expired. Re-authenticate to resume syncing.",
      actionType: "reconnect",
      actionLabel: "Reconnect",
    };
  }

  if (
    m.includes("encrypt") ||
    m.includes("credential") ||
    m.includes("payload") ||
    m.includes("corrupt") ||
    m.includes("syntax") ||
    m.includes("json")
  ) {
    return {
      title: `${providerName} needs attention`,
      explanation: "Connection configuration requires updating.",
      actionType: "review",
      actionLabel: "Review",
    };
  }

  if (m.includes("permission") || m.includes("access denied") || m.includes("forbidden") || m.includes("403")) {
    return {
      title: `${providerName} access denied`,
      explanation: "Account lacks required read permissions.",
      actionType: "reconnect",
      actionLabel: "Update access",
    };
  }

  if (m.includes("rate limit") || m.includes("throttle") || m.includes("429") || m.includes("80004")) {
    return {
      title: `${providerName} rate-limited`,
      explanation: "API request limit reached. Automatic retry scheduled.",
      actionType: "review",
      actionLabel: "View details",
    };
  }

  return {
    title: `${providerName} needs attention`,
    explanation: "Sync encountered an issue that needs review.",
    actionType: "review",
    actionLabel: "Review",
  };
}

function formatRelativeTime(date: Date | string | null): string | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

function formatDateCoverage(date: Date | null): string | null {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Server-side unified Dashboard overview service.
 * Gathers workspace-fenced truth across connections, warehouse metrics, sync history, and destinations.
 */
export async function getWorkspaceDashboardOverview(
  workspaceId: string
): Promise<DashboardOverviewDTO | null> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true, plan: true },
  });

  if (!workspace) return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 26 * 60 * 60 * 1000);

  // Parallel data fetching
  const [
    connections,
    pipelines,
    warehouseAgg,
    warehouse7dByCurrency,
    retailOrdersAgg,
    latestSyncJob,
    latestImportJob,
    recentSyncLogs,
    syncLogCounts7d,
    apiKeysCount,
    lookerJobs,
  ] = await Promise.all([
    // 1. All Connections in workspace
    prisma.connection.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    }),

    // 2. Pipelines
    prisma.pipeline.findMany({
      where: { workspaceId },
      include: {
        sourceConnection: { select: { id: true, name: true, provider: true } },
        destinationConnection: {
          select: { id: true, name: true, provider: true, type: true, status: true },
        },
      },
    }),

    // 3. Overall Warehouse Metrics (CampaignMetric)
    prisma.campaignMetric.aggregate({
      where: { workspaceId },
      _max: { pulledAt: true, date: true },
      _count: { id: true },
    }),

    // 4. 7-day Warehouse Metrics
    prisma.campaignMetric.groupBy({
      where: { workspaceId, date: { gte: sevenDaysAgo } },
      by: ["currency"],
      _sum: {
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
        revenue: true,
      },
      _count: { _all: true },
    }),

    // 5. Retail Orders
    prisma.retailOrder.aggregate({
      where: { workspaceId },
      _count: { _all: true },
      _max: { pulledAt: true, createdAtIso: true },
    }),

    // 6. Latest Sync Job
    prisma.syncJob.findFirst({
      where: { pipeline: { workspaceId } },
      orderBy: { createdAt: "desc" },
      include: {
        pipeline: {
          select: {
            name: true,
            sourceConnection: { select: { id: true, name: true, provider: true } },
          },
        },
      },
    }),

    // 7. Latest Warehouse Import Job
    prisma.warehouseImportJob.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    }),

    // 8. Recent 7-day Sync Logs (activity feed only)
    prisma.syncLog.findMany({
      where: {
        pipeline: { workspaceId },
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        pipeline: { select: { name: true } },
      },
    }),

    // 9. Complete 7-day Sync Log counts (not capped by the activity feed)
    prisma.syncLog.groupBy({
      where: {
        pipeline: { workspaceId },
        createdAt: { gte: sevenDaysAgo },
      },
      by: ["status"],
      _count: { _all: true },
    }),

    // 10. API Keys
    prisma.apiKey.count({
      where: { workspaceId, revokedAt: null },
    }),

    // 11. Looker Jobs
    prisma.lookerJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  // Parse Sources
  const sourceConnections = connections.filter((c) => c.type === "source");
  const destinationConnections = connections.filter((c) => c.type === "destination");
  const runningSourceConnectionId =
    latestSyncJob?.status === "running"
      ? latestSyncJob.pipeline?.sourceConnection?.id ?? null
      : null;
  let totalConnectedAccounts = 0;
  const needsAttention: DashboardIssueItem[] = [];

  const sourcesList: DashboardSourceItem[] = sourceConnections.map((conn) => {
    let accountTags: string[] = [];
    let accountCount = 1;

    try {
      let creds: Record<string, unknown> = {};
      try {
        creds = parseConnectionCredentialsJson(safeDecrypt(conn.credentials));
      } catch {
        if (typeof conn.credentials === "string" && conn.credentials.startsWith("{")) {
          creds = JSON.parse(conn.credentials);
        }
      }

      if (conn.provider === "meta_ads") {
        const list = (creds.adAccounts ?? creds.adAccountIds ?? []) as Array<
          { id: string; name?: string } | string
        >;
        if (Array.isArray(list) && list.length > 0) {
          accountTags = list.map((a) =>
            typeof a === "object" && a.name ? a.name : String(a).replace(/^act_/, "")
          );
          accountCount = list.length;
        }
      } else if (conn.provider === "google_ads") {
        const customers = (creds.customerIds ??
          (creds.extraFields as Record<string, unknown>)?.customerIds ??
          []) as string[];
        if (Array.isArray(customers) && customers.length > 0) {
          accountTags = customers;
          accountCount = customers.length;
        }
      } else if (conn.provider === "tiktok_business") {
        const advs = (creds.advertiserIds ??
          (creds.extraFields as Record<string, unknown>)?.advertiserIds ??
          []) as string[];
        if (Array.isArray(advs) && advs.length > 0) {
          accountTags = advs;
          accountCount = advs.length;
        }
      } else if (conn.provider === "shopee") {
        const shopId = creds.shop_id || creds.shopId;
        if (shopId) {
          accountTags = [`Shop ${shopId}`];
          accountCount = 1;
        }
      }
    } catch (e) {
      logger.warn("[DashboardOverview] credentials parse error for connection:", conn.id, e);
    }

    totalConnectedAccounts += accountCount;

    const providerLabel = conn.name || PROVIDER_NAMES[conn.provider] || conn.provider;

    const state = resolveDashboardSourceState({
      connectionStatus: conn.status,
      lastError: conn.lastError,
      lastSyncAt: conn.lastSyncAt,
      isSyncing: runningSourceConnectionId === conn.id,
      staleBefore: oneDayAgo,
    });
    let safeLastError: string | null = null;

    if (state === "error") {
      const sanitized = sanitizeUserFacingError(conn.lastError, providerLabel);
      safeLastError = sanitized.explanation;
      needsAttention.push({
        id: `conn-err-${conn.id}`,
        title: sanitized.title,
        explanation: sanitized.explanation,
        actionType: sanitized.actionType,
        actionLabel: sanitized.actionLabel,
        connectionId: conn.id,
        provider: conn.provider,
        timestamp: (conn.updatedAt || conn.createdAt).toISOString(),
      });
    } else if (state === "disconnected") {
      safeLastError = "This source is disconnected and cannot sync until it is reauthorized.";
      needsAttention.push({
        id: `conn-disconnected-${conn.id}`,
        title: `${providerLabel} is disconnected`,
        explanation: safeLastError,
        actionType: "reconnect",
        actionLabel: "Reconnect",
        connectionId: conn.id,
        provider: conn.provider,
        timestamp: (conn.updatedAt || conn.createdAt).toISOString(),
      });
    }

    return {
      id: conn.id,
      provider: conn.provider,
      name: providerLabel,
      accountCount,
      accountTags,
      state,
      lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.toISOString() : null,
      lastError: safeLastError,
    };
  });

  // Check for failed jobs
  if (latestSyncJob && latestSyncJob.status === "failed") {
    const jobSource = latestSyncJob.pipeline?.sourceConnection?.name || "Pipeline";
    const sanitized = sanitizeUserFacingError(latestSyncJob.errorMsg, jobSource);
    needsAttention.push({
      id: `job-err-${latestSyncJob.id}`,
      title: `${jobSource} sync failed`,
      explanation: sanitized.explanation,
      actionType: "retry",
      actionLabel: "Review",
      href: "/reports",
      timestamp: (latestSyncJob.finishedAt || latestSyncJob.createdAt).toISOString(),
    });
  }

  if (latestImportJob?.status === "failed" || latestImportJob?.status === "partial") {
    const partial = latestImportJob.status === "partial";
    needsAttention.push({
      id: `import-${latestImportJob.status}-${latestImportJob.id}`,
      title: partial ? "Warehouse refresh partially completed" : "Warehouse refresh failed",
      explanation: partial
        ? "Some selected sources did not finish. Review the import results before treating this refresh as complete."
        : "The latest warehouse refresh did not complete. Existing warehouse rows remain available.",
      actionType: "review",
      actionLabel: "Review warehouse",
      href: "/explorer",
      timestamp: (latestImportJob.finishedAt || latestImportJob.createdAt).toISOString(),
    });
  }

  // Warehouse Freshness
  const latestWarehouseDataDate = latestValidDate([
    warehouseAgg._max.date,
    retailOrdersAgg._max.createdAtIso,
  ]);
  const latestWarehousePullAt = latestValidDate([
    warehouseAgg._max.pulledAt,
    retailOrdersAgg._max.pulledAt,
  ]);
  const totalWarehouseRows = warehouseAgg._count.id + retailOrdersAgg._count._all;
  const rows7d = warehouse7dByCurrency.reduce((sum, row) => sum + (row._count._all ?? 0), 0);

  const warehouseStatus = resolveDashboardWarehouseStatus({
    latestImportStatus: latestImportJob?.status,
    latestImportAt: latestImportJob
      ? latestImportJob.finishedAt || latestImportJob.updatedAt || latestImportJob.createdAt
      : null,
    latestSyncStatus: latestSyncJob?.status,
    lastPulledAt: latestWarehousePullAt,
    staleBefore: oneDayAgo,
  });

  // Sync Stats
  const syncCounts7d = summarizeDashboardSyncCounts(syncLogCounts7d);
  const successful7d = syncCounts7d.successful;
  const failed7d = syncCounts7d.failed;
  const latestActivityDate = latestValidDate([
    latestWarehousePullAt,
    latestSyncJob?.status === "done" ? latestSyncJob.finishedAt : null,
    ...sourceConnections.map((connection) => connection.lastSyncAt),
  ]);

  // Destinations List
  const destinationOverview = buildDashboardDestinations({
    destinationConnections,
    pipelines,
    apiKeysCount,
    latestLookerStatus: lookerJobs[0]?.status,
    hasCompletedLookerQuery: lookerJobs.some((job) => job.status === "done"),
  });
  const destinationsList = destinationOverview.list;
  const activeDestinations = destinationOverview.activeNames;

  // 7-day KPI snapshot — currency-safe: never blend monetary values across currencies
  const metrics7dRows = warehouse7dByCurrency.map((g) => ({
    currency: g.currency,
    spend: g._sum.spend ?? 0,
    revenue: g._sum.revenue ?? 0,
    impressions: g._sum.impressions ?? 0,
    clicks: g._sum.clicks ?? 0,
    conversions: g._sum.conversions ?? 0,
  }));
  const kpi7d = aggregateCurrencySafe(metrics7dRows);
  const sumImpressions = kpi7d.impressions;
  const sumClicks = kpi7d.clicks;
  const sumConversions = kpi7d.conversions;

  // Recent Activity Feed
  const recentActivity: DashboardActivityItem[] = [];

  for (const log of recentSyncLogs.slice(0, 4)) {
    recentActivity.push({
      id: `log-${log.id}`,
      type: log.status === "success" ? "sync_success" : "sync_error",
      title: log.pipeline.name,
      description: log.status === "success" ? "Sync completed" : "Sync failed",
      timestamp: log.createdAt.toISOString(),
      status: log.status === "success" ? "success" : "error",
    });
  }

  if (latestImportJob) {
    const importPresentation: Pick<DashboardActivityItem, "description" | "status"> = (() => {
      switch (latestImportJob.status) {
        case "completed":
          return { description: "Refresh completed", status: "success" };
        case "partial":
          return { description: "Refresh partially completed", status: "warning" };
        case "failed":
          return { description: "Refresh failed", status: "error" };
        case "running":
          return { description: "Refresh in progress", status: "info" };
        default:
          return { description: "Refresh queued", status: "info" };
      }
    })();
    recentActivity.push({
      id: `import-${latestImportJob.id}`,
      type: "warehouse_refresh",
      title: "Warehouse batch refresh",
      description: importPresentation.description,
      timestamp: (latestImportJob.finishedAt || latestImportJob.createdAt).toISOString(),
      status: importPresentation.status,
    });
  }

  for (const lJob of lookerJobs) {
    const lookerPresentation: Pick<DashboardActivityItem, "description" | "status"> = (() => {
      switch (lJob.status) {
        case "done":
          return { description: "Query served", status: "success" };
        case "failed":
          return { description: "Query failed", status: "error" };
        case "running":
          return { description: "Query in progress", status: "info" };
        default:
          return { description: "Query queued", status: "info" };
      }
    })();
    recentActivity.push({
      id: `looker-${lJob.id}`,
      type: "looker_query",
      title: "Looker Studio query",
      description: lookerPresentation.description,
      timestamp: (lJob.finishedAt || lJob.createdAt).toISOString(),
      status: lookerPresentation.status,
    });
  }

  // Sort activity descending
  recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Overall workspace status
  let overallState: DashboardOverviewDTO["overallStatus"]["state"] = "healthy";
  let overallHeadline = "Workspace healthy";
  let overallSupportingText = "All connected sources are syncing and warehouse data is current.";

  if (sourceConnections.length === 0 && totalWarehouseRows === 0) {
    overallState = "onboarding";
    overallHeadline = "No sources connected";
    overallSupportingText = "Connect your advertising and commerce sources to begin syncing warehouse data.";
  } else if (needsAttention.length > 0) {
    overallState = "attention";
    overallHeadline = "Attention needed";
    overallSupportingText = needsAttention[0].title + " — " + needsAttention[0].explanation;
  } else if (warehouseStatus === "refreshing") {
    overallState = "syncing";
    overallHeadline = "Warehouse syncing";
    overallSupportingText = "A scheduled warehouse refresh is currently in progress.";
  } else if (warehouseStatus === "stale") {
    overallState = "attention";
    overallHeadline = "Warehouse data is stale";
    overallSupportingText = "The last successful warehouse refresh is more than a day old.";
  } else if (sourcesList.some((source) => source.state === "stale")) {
    overallState = "attention";
    overallHeadline = "A source is stale";
    overallSupportingText = "At least one source has not completed a successful sync in more than a day.";
  } else if (sourcesList.some((source) => source.state === "pending" || source.state === "syncing")) {
    overallState = "syncing";
    overallHeadline = "Source setup in progress";
    overallSupportingText = "At least one connected source is awaiting its first successful sync.";
  }

  const healthySources = sourcesList.filter((source) => source.state === "fresh").length;
  const sourceAttentionCount = sourcesList.filter(
    (source) => source.state === "error" || source.state === "stale" || source.state === "disconnected",
  ).length;
  const pendingSources = sourcesList.filter(
    (source) => source.state === "pending" || source.state === "syncing",
  ).length;
  const accountSummary = `${totalConnectedAccounts} account${totalConnectedAccounts === 1 ? "" : "s"}`;

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      plan: workspace.plan,
    },
    overallStatus: {
      state: overallState,
      headline: overallHeadline,
      supportingText: overallSupportingText,
    },
    summaryCards: {
      sources: {
        total: sourceConnections.length,
        healthy: healthySources,
        attention: sourceAttentionCount,
        accountsTotal: totalConnectedAccounts,
        label: `${sourceConnections.length} configured`,
        subtext:
          sourceAttentionCount > 0
            ? `${accountSummary} · ${sourceAttentionCount} need attention`
            : pendingSources > 0
              ? `${accountSummary} · ${pendingSources} awaiting a successful sync`
              : `${accountSummary} · All current`,
      },
      warehouse: {
        status: warehouseStatus,
        dataThroughDate: formatDateCoverage(latestWarehouseDataDate),
        totalRows: totalWarehouseRows,
        rows7d,
        asOf: formatRelativeTime(latestWarehousePullAt),
      },
      syncs: {
        successful7d,
        failed7d,
        lastSyncTimeAgo: formatRelativeTime(latestActivityDate),
      },
      destinations: {
        activeCount: activeDestinations.length,
        list: activeDestinations,
      },
    },
    needsAttention: needsAttention.slice(0, 4),
    sourcesList,
    warehouseSnapshot: {
      hasData: totalWarehouseRows > 0,
      dataThroughDate: formatDateCoverage(latestWarehouseDataDate),
      lastRefreshAt: formatRelativeTime(latestWarehousePullAt),
      metrics7d: {
        impressions: sumImpressions,
        clicks: sumClicks,
        conversions: sumConversions,
        mixedCurrency: kpi7d.mixedCurrency,
        byCurrency: kpi7d.byCurrency.map((b) => ({
          currency: b.currency,
          spend: b.spend,
          revenue: b.revenue,
          roas: b.roas,
        })),
      },
    },
    destinationsList,
    recentActivity: recentActivity.slice(0, 5),
  };
}
