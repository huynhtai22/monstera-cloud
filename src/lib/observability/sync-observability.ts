/**
 * OBSERVABILITY: Enhanced Sync Observability
 * Row-level logging, retry tracking, and performance metrics
 */

import prisma from "@/lib/prisma";

export type SyncStage = "extract" | "transform" | "load";
export type SyncDetailStatus = "success" | "warning" | "error";

interface SyncContext {
  syncLogId: string;
  pipelineId: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
}

interface StageResult {
  stage: SyncStage;
  status: SyncDetailStatus;
  rowsProcessed: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsFailed: number;
  durationMs: number;
  apiCalls: number;
  bytesTransferred: number;
  errorCode?: string;
  errorMessage?: string;
  errorDetails?: any;
  schemaVersion?: string;
}

/**
 * Track detailed sync stage completion
 */
export async function trackSyncStage(
  context: SyncContext,
  result: StageResult
): Promise<void> {
  await prisma.syncLogDetail.create({
    data: {
      syncLogId: context.syncLogId,
      stage: result.stage,
      status: result.status,
      rowsProcessed: result.rowsProcessed,
      rowsInserted: result.rowsInserted,
      rowsUpdated: result.rowsUpdated,
      rowsFailed: result.rowsFailed,
      durationMs: result.durationMs,
      apiCalls: result.apiCalls,
      bytesTransferred: result.bytesTransferred,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage?.slice(0, 500),
      errorDetails: result.errorDetails ? JSON.stringify(result.errorDetails).slice(0, 4000) : null,
      schemaVersion: result.schemaVersion,
    },
  });
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
  retryCount: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  const delay = baseDelayMs * Math.pow(2, retryCount);
  return Math.min(delay, maxDelayMs);
}

/**
 * Classify error for retry decision
 */
export function classifyError(error: any): {
  shouldRetry: boolean;
  errorCode: string;
  errorCategory: "auth" | "rate_limit" | "network" | "schema" | "unknown";
  userMessage: string;
} {
  const message = error?.message?.toLowerCase() || "";
  const code = error?.code || "";

  // Auth errors - don't retry
  if (
    message.includes("token expired") ||
    message.includes("unauthorized") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("invalid_credentials")
  ) {
    return {
      shouldRetry: false,
      errorCode: "AUTH_FAILED",
      errorCategory: "auth",
      userMessage: "Authentication failed. Please reconnect the source.",
    };
  }

  // Rate limit - retry with delay
  if (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("429") ||
    code === "RATE_LIMITED"
  ) {
    return {
      shouldRetry: true,
      errorCode: "RATE_LIMITED",
      errorCategory: "rate_limit",
      userMessage: "Rate limit hit. Retrying with backoff...",
    };
  }

  // Network errors - retry
  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up") ||
    message.includes("fetch failed")
  ) {
    return {
      shouldRetry: true,
      errorCode: "NETWORK_ERROR",
      errorCategory: "network",
      userMessage: "Network error. Retrying...",
    };
  }

  // Schema errors - don't retry, needs investigation
  if (
    message.includes("schema") ||
    message.includes("column") ||
    message.includes("field") ||
    message.includes("validation failed")
  ) {
    return {
      shouldRetry: false,
      errorCode: "SCHEMA_ERROR",
      errorCategory: "schema",
      userMessage: "Data schema has changed. Please contact support.",
    };
  }

  // Unknown errors - retry once
  return {
    shouldRetry: true,
    errorCode: "UNKNOWN_ERROR",
    errorCategory: "unknown",
    userMessage: "Sync failed. Retrying...",
  };
}

/**
 * Get sync summary for a pipeline
 */
export async function getPipelineSyncSummary(
  pipelineId: string,
  days: number = 7
): Promise<{
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  avgRowsPerSync: number;
  avgDurationMs: number;
  lastSuccessfulSync: Date | null;
  errorBreakdown: Record<string, number>;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const logs = await prisma.syncLog.findMany({
    where: {
      pipelineId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalSyncs = logs.length;
  const successfulSyncs = logs.filter((l) => l.status === "success").length;
  const failedSyncs = logs.filter((l) => l.status === "error").length;

  const avgRows =
    logs.length > 0
      ? logs.reduce((sum, l) => sum + l.rowsSynced, 0) / logs.length
      : 0;

  const avgDuration =
    logs.length > 0
      ? logs.reduce((sum, l) => sum + l.durationMs, 0) / logs.length
      : 0;

  const lastSuccessful = logs.find((l) => l.status === "success")?.createdAt || null;

  // Error breakdown
  const errorBreakdown: Record<string, number> = {};
  for (const log of logs.filter((l) => l.status === "error")) {
    const errorKey = log.errorMsg?.slice(0, 50) || "Unknown";
    errorBreakdown[errorKey] = (errorBreakdown[errorKey] || 0) + 1;
  }

  return {
    totalSyncs,
    successfulSyncs,
    failedSyncs,
    avgRowsPerSync: Math.round(avgRows),
    avgDurationMs: Math.round(avgDuration),
    lastSuccessfulSync: lastSuccessful,
    errorBreakdown,
  };
}

/**
 * Get detailed sync logs with stage breakdown
 */
export async function getDetailedSyncLogs(
  pipelineId: string,
  limit: number = 10
): Promise<
  Array<{
    id: string;
    status: string;
    rowsSynced: number;
    durationMs: number;
    errorMsg: string | null;
    createdAt: Date;
    stages: Array<{
      stage: SyncStage;
      status: SyncDetailStatus;
      rowsProcessed: number;
      durationMs: number;
      errorMessage: string | null;
    }>;
  }>
> {
  const logs = await prisma.syncLog.findMany({
    where: { pipelineId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  // Fetch details separately (until Prisma migration adds the relation)
  const logIds = logs.map((log) => log.id);
  const details = await prisma.syncLogDetail.findMany({
    where: { syncLogId: { in: logIds } },
    orderBy: { createdAt: "asc" },
    select: {
      syncLogId: true,
      stage: true,
      status: true,
      rowsProcessed: true,
      durationMs: true,
      errorMessage: true,
    },
  });

  const detailsByLogId = new Map<string, typeof details>();
  for (const d of details) {
    if (!detailsByLogId.has(d.syncLogId)) {
      detailsByLogId.set(d.syncLogId, []);
    }
    detailsByLogId.get(d.syncLogId)!.push(d);
  }

  return logs.map((log) => ({
    id: log.id,
    status: log.status,
    rowsSynced: log.rowsSynced,
    durationMs: log.durationMs,
    errorMsg: log.errorMsg,
    createdAt: log.createdAt,
    stages: (detailsByLogId.get(log.id) || []).map((d) => ({
      stage: d.stage as SyncStage,
      status: d.status as SyncDetailStatus,
      rowsProcessed: d.rowsProcessed,
      durationMs: d.durationMs,
      errorMessage: d.errorMessage,
    })),
  }));
}

/**
 * Alert on sync anomaly (stale data, repeated failures)
 */
export async function checkSyncHealth(
  pipelineId: string,
  workspaceId: string
): Promise<{
  healthy: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Get last 5 sync attempts scoped to workspace
  const recentSyncs = await prisma.syncLog.findMany({
    where: {
      pipelineId,
      pipeline: { workspaceId },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (recentSyncs.length === 0) {
    return { healthy: true, issues: [] };
  }

  // Check for repeated failures
  const recentFailures = recentSyncs.filter((s) => s.status === "error").length;
  if (recentFailures >= 3) {
    issues.push(`Last ${recentFailures} syncs failed`);
  }

  // Check for stale data (no successful sync in 24 hours)
  const lastSuccess = recentSyncs.find((s) => s.status === "success");
  const hoursSinceSuccess = lastSuccess
    ? (Date.now() - new Date(lastSuccess.createdAt).getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursSinceSuccess > 24) {
    issues.push(`No successful sync in ${Math.round(hoursSinceSuccess)} hours`);
  }

  // Check for zero rows
  const lastSync = recentSyncs[0];
  if (lastSync.status === "success" && lastSync.rowsSynced === 0) {
    issues.push("Last sync returned 0 rows");
  }

  // Check for row count drop
  if (recentSyncs.length >= 2) {
    const current = recentSyncs[0].rowsSynced;
    const previous = recentSyncs[1].rowsSynced;
    if (previous > 0 && current < previous * 0.5) {
      issues.push(`Row count dropped ${Math.round((1 - current / previous) * 100)}%`);
    }
  }

  return {
    healthy: issues.length === 0,
    issues,
  };
}

/**
 * Create default data quality rules for a workspace
 */
export async function createDefaultQualityRules(workspaceId: string): Promise<void> {
  const defaultRules = [
    {
      name: "Revenue Drop Alert",
      description: "Alert when daily revenue drops more than 50% compared to previous day",
      ruleType: "comparison",
      metric: "revenue",
      operator: "drop_pct",
      pctThreshold: 0.5,
      severity: "critical",
    },
    {
      name: "Sync Row Count Drop",
      description: "Alert when sync returns significantly fewer rows than usual",
      ruleType: "comparison",
      metric: "row_count",
      operator: "drop_pct",
      pctThreshold: 0.3,
      severity: "warning",
    },
    {
      name: "ROAS Too Low",
      description: "Alert when ROAS drops below 1.0 (losing money)",
      ruleType: "threshold",
      metric: "roas",
      operator: "lt",
      threshold: 1.0,
      severity: "warning",
    },
    {
      name: "High Ad Spend",
      description: "Alert when daily ad spend exceeds $5000",
      ruleType: "threshold",
      metric: "spend",
      operator: "gt",
      threshold: 5000,
      severity: "warning",
    },
  ];

  for (const rule of defaultRules) {
    await prisma.dataQualityRule.create({
      data: {
        workspaceId,
        enabled: true,
        notifyTelegram: true,
        ...rule,
      },
    });
  }
}
