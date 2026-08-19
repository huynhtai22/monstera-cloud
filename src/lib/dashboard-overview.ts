import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";
import { parseConnectionCredentialsJson } from "@/lib/parse-connection-credentials";
import { logger } from "@/lib/logger";

export interface DashboardSourceItem {
  id: string;
  provider: string;
  name: string;
  accountCount: number;
  accountTags: string[];
  state: "fresh" | "stale" | "error" | "syncing" | "pending";
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
  status: "healthy" | "ready" | "active" | "error" | "unconfigured";
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
      status: "fresh" | "stale" | "refreshing" | "failed" | "never";
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
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
      roas: number;
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
    _pipelines,
    warehouseAgg,
    warehouse7dAgg,
    retailOrdersCount,
    latestSyncJob,
    latestImportJob,
    syncLogs7d,
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
        destinationConnection: { select: { id: true, name: true, provider: true, type: true } },
      },
    }),

    // 3. Overall Warehouse Metrics (CampaignMetric)
    prisma.campaignMetric.aggregate({
      where: { workspaceId },
      _max: { pulledAt: true, date: true },
      _count: { id: true },
    }),

    // 4. 7-day Warehouse Metrics
    prisma.campaignMetric.aggregate({
      where: { workspaceId, date: { gte: sevenDaysAgo } },
      _sum: {
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
        revenue: true,
      },
      _count: { id: true },
    }),

    // 5. Retail Orders
    prisma.retailOrder.count({
      where: { workspaceId },
    }),

    // 6. Latest Sync Job
    prisma.syncJob.findFirst({
      where: { pipeline: { workspaceId } },
      orderBy: { createdAt: "desc" },
      include: {
        pipeline: {
          select: {
            name: true,
            sourceConnection: { select: { name: true, provider: true } },
          },
        },
      },
    }),

    // 7. Latest Warehouse Import Job
    prisma.warehouseImportJob.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    }),

    // 8. 7-day Sync Logs
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

    // 9. API Keys
    prisma.apiKey.count({
      where: { workspaceId, revokedAt: null },
    }),

    // 10. Looker Jobs
    prisma.lookerJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  // Parse Sources
  const sourceConnections = connections.filter((c) => c.type === "source");
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

    // Determine state
    let state: DashboardSourceItem["state"] = "fresh";
    if (conn.status === "error" || conn.lastError) {
      state = "error";
      const sanitized = sanitizeUserFacingError(conn.lastError, providerLabel);
      needsAttention.push({
        id: `conn-err-${conn.id}`,
        title: sanitized.title,
        explanation: sanitized.explanation,
        rawDetails: conn.lastError || undefined,
        actionType: sanitized.actionType,
        actionLabel: sanitized.actionLabel,
        connectionId: conn.id,
        provider: conn.provider,
        timestamp: (conn.updatedAt || conn.createdAt).toISOString(),
      });
    } else if (!conn.lastSyncAt) {
      state = "pending";
    } else if (new Date(conn.lastSyncAt) < oneDayAgo) {
      state = "stale";
    }

    return {
      id: conn.id,
      provider: conn.provider,
      name: providerLabel,
      accountCount,
      accountTags,
      state,
      lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.toISOString() : null,
      lastError: conn.lastError,
    };
  });

  // Check for failed jobs
  if (latestSyncJob && latestSyncJob.status === "failed" && latestSyncJob.errorMsg) {
    const jobSource = latestSyncJob.pipeline?.sourceConnection?.name || "Pipeline";
    const sanitized = sanitizeUserFacingError(latestSyncJob.errorMsg, jobSource);
    needsAttention.push({
      id: `job-err-${latestSyncJob.id}`,
      title: `${jobSource} sync failed`,
      explanation: sanitized.explanation,
      rawDetails: latestSyncJob.errorMsg,
      actionType: "retry",
      actionLabel: "Review",
      href: "/reports",
      timestamp: (latestSyncJob.finishedAt || latestSyncJob.createdAt).toISOString(),
    });
  }

  // Warehouse Freshness
  const maxMetricDate = warehouseAgg._max.date;
  const maxPulledAt = warehouseAgg._max.pulledAt;
  const totalWarehouseRows = warehouseAgg._count.id + retailOrdersCount;
  const rows7d = warehouse7dAgg._count.id;

  let warehouseStatus: DashboardOverviewDTO["summaryCards"]["warehouse"]["status"] = "never";
  if (latestImportJob?.status === "running" || latestSyncJob?.status === "running") {
    warehouseStatus = "refreshing";
  } else if (latestImportJob?.status === "failed" && !maxPulledAt) {
    warehouseStatus = "failed";
  } else if (maxPulledAt && new Date(maxPulledAt) >= oneDayAgo) {
    warehouseStatus = "fresh";
  } else if (maxPulledAt) {
    warehouseStatus = "stale";
  }

  // Sync Stats
  const successful7d = syncLogs7d.filter((l) => l.status === "success").length;
  const failed7d = syncLogs7d.filter((l) => l.status === "error").length;
  const latestActivityDate =
    maxPulledAt ||
    (latestSyncJob?.finishedAt ? latestSyncJob.finishedAt : null) ||
    (sourceConnections[0]?.lastSyncAt ? sourceConnections[0].lastSyncAt : null);

  // Destinations List
  const destinationsList: DashboardDestinationItem[] = [
    {
      id: "dest-sheets",
      type: "sheets",
      name: "Google Sheets",
      status: "ready",
      subtext: "Live add-on & scheduled exports",
      href: "/exports",
    },
    {
      id: "dest-looker",
      type: "looker",
      name: "Looker Studio",
      status: apiKeysCount > 0 ? "healthy" : "ready",
      subtext: apiKeysCount > 0 ? "Community connector active" : "API key required to connect",
      href: "/looker-studio",
    },
    {
      id: "dest-api",
      type: "api",
      name: "REST API & CSV",
      status: "active",
      subtext: "Programmatic warehouse queries",
      href: "/exports",
    },
  ];

  const activeDestinations = ["Sheets", "Looker Studio", "REST API"];

  // 7-day KPI snapshot
  const sumSpend = warehouse7dAgg._sum.spend ?? 0;
  const sumImpressions = warehouse7dAgg._sum.impressions ?? 0;
  const sumClicks = warehouse7dAgg._sum.clicks ?? 0;
  const sumConversions = warehouse7dAgg._sum.conversions ?? 0;
  const sumRevenue = warehouse7dAgg._sum.revenue ?? 0;
  const roas7d = sumSpend > 0 ? sumRevenue / sumSpend : 0;

  // Recent Activity Feed
  const recentActivity: DashboardActivityItem[] = [];

  for (const log of syncLogs7d.slice(0, 4)) {
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
    recentActivity.push({
      id: `import-${latestImportJob.id}`,
      type: "warehouse_refresh",
      title: "Warehouse batch refresh",
      description: latestImportJob.status === "completed" ? "Refresh completed" : "Refresh in progress",
      timestamp: (latestImportJob.finishedAt || latestImportJob.createdAt).toISOString(),
      status: latestImportJob.status === "completed" ? "success" : "info",
    });
  }

  for (const lJob of lookerJobs) {
    recentActivity.push({
      id: `looker-${lJob.id}`,
      type: "looker_query",
      title: "Looker Studio query",
      description: "Query served",
      timestamp: (lJob.finishedAt || lJob.createdAt).toISOString(),
      status: lJob.status === "done" ? "success" : "info",
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
  }

  const healthySources = sourcesList.filter((s) => s.state === "fresh" || s.state === "pending").length;

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
        attention: sourceConnections.length - healthySources,
        accountsTotal: totalConnectedAccounts,
        label: `${sourceConnections.length} connected`,
        subtext:
          needsAttention.length > 0
            ? `${totalConnectedAccounts} accounts · ${needsAttention.length} need attention`
            : `${totalConnectedAccounts} accounts · All healthy`,
      },
      warehouse: {
        status: warehouseStatus,
        dataThroughDate: formatDateCoverage(maxMetricDate),
        totalRows: totalWarehouseRows,
        rows7d,
        asOf: formatRelativeTime(maxPulledAt),
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
      dataThroughDate: formatDateCoverage(maxMetricDate),
      lastRefreshAt: formatRelativeTime(maxPulledAt),
      metrics7d: {
        spend: sumSpend,
        impressions: sumImpressions,
        clicks: sumClicks,
        conversions: sumConversions,
        revenue: sumRevenue,
        roas: roas7d,
      },
    },
    destinationsList,
    recentActivity: recentActivity.slice(0, 5),
  };
}
