/**
 * OBSERVABILITY: Data Quality Rules Engine
 * Anomaly detection for pipeline syncs and warehouse imports.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";

export type DataQualityRuleType = "threshold" | "comparison" | "schema_check";
export type DataQualityMetric =
  | "revenue"
  | "orders"
  | "roas"
  | "row_count"
  | "spend"
  | "conversions"
  | "impressions"
  | "clicks";
export type DataQualityOperator = "gt" | "lt" | "eq" | "drop_pct" | "increase_pct" | "schema_check";
export type DataQualitySeverity = "warning" | "critical";

export interface DataQualityRule {
  id: string;
  name: string;
  ruleType: DataQualityRuleType;
  metric: DataQualityMetric;
  operator: DataQualityOperator;
  threshold?: number | null;
  pctThreshold?: number | null;
  pipelineId?: string | null;
  connectionId?: string | null;
  severity: DataQualitySeverity;
  notifyTelegram?: boolean;
  notifyEmail?: boolean;
}

export interface MetricSnapshot {
  metric: DataQualityMetric;
  current: number;
  previous?: number;
  schemaValid?: boolean;
  missingColumns?: string[];
  timestamp: Date;
}

// In-memory fallback cooldown map (used when Redis is unavailable)
const localAlertCooldownMap = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown per rule violation

/**
 * Check if alert is in cooldown to prevent notification fatigue.
 */
export async function isAlertInCooldown(workspaceId: string, ruleId: string): Promise<boolean> {
  const cooldownKey = `dq_alert_cooldown:${workspaceId}:${ruleId}`;
  try {
    const redis = getRedis();
    const exists = await redis.get(cooldownKey);
    if (exists) return true;
    await redis.set(cooldownKey, "1", { ex: 3600 });
    return false;
  } catch {
    const now = Date.now();
    const lastSent = localAlertCooldownMap.get(cooldownKey);
    if (lastSent && now - lastSent < ALERT_COOLDOWN_MS) {
      return true;
    }
    localAlertCooldownMap.set(cooldownKey, now);
    return false;
  }
}

/**
 * Evaluate a data quality rule against current metrics.
 */
export async function evaluateRule(
  rule: DataQualityRule,
  snapshot: MetricSnapshot
): Promise<{
  violated: boolean;
  expectedValue?: number;
  actualValue: number;
  pctChange?: number;
  message: string;
}> {
  const { metric, operator, threshold, pctThreshold } = rule;
  const actual = snapshot.current;
  const previous = snapshot.previous;

  switch (operator) {
    case "gt":
      if (threshold !== undefined && threshold !== null) {
        const violated = actual > threshold;
        return {
          violated,
          expectedValue: threshold,
          actualValue: actual,
          message: violated ? `${metric} (${actual}) exceeds threshold (${threshold})` : "OK",
        };
      }
      break;

    case "lt":
      if (threshold !== undefined && threshold !== null) {
        const violated = actual < threshold;
        return {
          violated,
          expectedValue: threshold,
          actualValue: actual,
          message: violated ? `${metric} (${actual}) below threshold (${threshold})` : "OK",
        };
      }
      break;

    case "eq":
      if (threshold !== undefined && threshold !== null) {
        const violated = actual === threshold;
        return {
          violated,
          expectedValue: threshold,
          actualValue: actual,
          message: violated ? `${metric} (${actual}) matches equality check (${threshold})` : "OK",
        };
      }
      break;

    case "drop_pct":
      if (previous !== undefined && pctThreshold !== undefined && pctThreshold !== null && previous > 0) {
        const pctChange = (actual - previous) / previous;
        const violated = pctChange < -pctThreshold;
        return {
          violated,
          expectedValue: previous,
          actualValue: actual,
          pctChange,
          message: violated
            ? `${metric} dropped ${(Math.abs(pctChange) * 100).toFixed(1)}% (threshold: ${pctThreshold * 100}%)`
            : "OK",
        };
      }
      break;

    case "increase_pct":
      if (previous !== undefined && pctThreshold !== undefined && pctThreshold !== null && previous > 0) {
        const pctChange = (actual - previous) / previous;
        const violated = pctChange > pctThreshold;
        return {
          violated,
          expectedValue: previous,
          actualValue: actual,
          pctChange,
          message: violated
            ? `${metric} increased ${(pctChange * 100).toFixed(1)}% (threshold: ${pctThreshold * 100}%)`
            : "OK",
        };
      }
      break;

    case "schema_check":
      if (snapshot.schemaValid === false) {
        return {
          violated: true,
          actualValue: 0,
          expectedValue: 1,
          message: `Schema drift detected: missing columns [${(snapshot.missingColumns || []).join(", ")}]`,
        };
      }
      return { violated: false, actualValue: 1, message: "Schema OK" };
  }

  return { violated: false, actualValue: actual, message: "Rule not applicable" };
}

/**
 * Get active rules for a workspace/pipeline.
 */
export async function getActiveRules(
  workspaceId: string,
  pipelineId?: string,
  connectionId?: string
): Promise<DataQualityRule[]> {
  const rules = await prisma.dataQualityRule.findMany({
    where: {
      workspaceId,
      enabled: true,
      OR: [
        { pipelineId: null, connectionId: null }, // Global rules
        ...(pipelineId ? [{ pipelineId }] : []),
        ...(connectionId ? [{ connectionId }] : []),
      ],
    },
    orderBy: { severity: "desc" }, // Critical first
  });

  return rules as unknown as DataQualityRule[];
}

/**
 * Record a data quality violation and send deduplicated alert.
 */
export async function recordViolation(
  rule: DataQualityRule,
  workspaceId: string,
  details: {
    expectedValue?: number;
    actualValue: number;
    pctChange?: number;
    syncLogId?: string;
    sampleData?: unknown;
    pipelineId?: string;
    connectionId?: string;
  }
): Promise<void> {
  await prisma.dataQualityViolation.create({
    data: {
      ruleId: rule.id,
      workspaceId,
      pipelineId: details.pipelineId || null,
      connectionId: details.connectionId || null,
      expectedValue: details.expectedValue,
      actualValue: details.actualValue,
      pctChange: details.pctChange,
      syncLogId: details.syncLogId,
      sampleData: details.sampleData ? JSON.stringify(details.sampleData).slice(0, 4000) : null,
      status: "open",
    },
  });

  // Alert dispatch rules:
  // - Warnings are audit-only (violation recorded, no external alert dispatched)
  // - Critical violations trigger Telegram only when notifyTelegram is enabled and not in cooldown
  const inCooldown = await isAlertInCooldown(workspaceId, rule.id);
  const shouldNotifyTelegram = rule.severity === "critical" && (rule.notifyTelegram ?? true) && !inCooldown;

  if (shouldNotifyTelegram) {
    await sendDataQualityAlert(rule, workspaceId, details);
  }
}

/**
 * Get metrics for comparison (current vs previous period).
 */
export async function getMetricSnapshot(
  workspaceId: string,
  metric: DataQualityMetric,
  options: {
    pipelineId?: string;
    connectionId?: string;
    dateRange?: "day" | "week" | "month";
  }
): Promise<MetricSnapshot> {
  const now = new Date();
  const period = options.dateRange === "day" ? 1 : options.dateRange === "week" ? 7 : 30;

  const currentStart = new Date(now);
  currentStart.setDate(currentStart.getDate() - period);

  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - period);

  let current = 0;
  let previous = 0;

  switch (metric) {
    case "row_count": {
      const currentLogs = await prisma.syncLog.aggregate({
        where: {
          pipeline: { workspaceId, ...(options.pipelineId && { id: options.pipelineId }) },
          createdAt: { gte: currentStart },
        },
        _sum: { rowsSynced: true },
      });
      const previousLogs = await prisma.syncLog.aggregate({
        where: {
          pipeline: { workspaceId, ...(options.pipelineId && { id: options.pipelineId }) },
          createdAt: { gte: previousStart, lt: currentStart },
        },
        _sum: { rowsSynced: true },
      });
      current = currentLogs._sum.rowsSynced || 0;
      previous = previousLogs._sum.rowsSynced || 0;
      break;
    }

    case "revenue": {
      const currentOrders = await prisma.retailOrder.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          createdAt: { gte: currentStart },
        },
        _sum: { netRevenue: true },
      });
      const previousOrders = await prisma.retailOrder.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          createdAt: { gte: previousStart, lt: currentStart },
        },
        _sum: { netRevenue: true },
      });
      current = currentOrders._sum.netRevenue || 0;
      previous = previousOrders._sum.netRevenue || 0;
      break;
    }

    case "orders": {
      const currentOrdersCount = await prisma.retailOrder.count({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          createdAt: { gte: currentStart },
        },
      });
      const previousOrdersCount = await prisma.retailOrder.count({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          createdAt: { gte: previousStart, lt: currentStart },
        },
      });
      current = currentOrdersCount;
      previous = previousOrdersCount;
      break;
    }

    case "spend": {
      const currentSpend = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: currentStart },
        },
        _sum: { spend: true },
      });
      const previousSpend = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: previousStart, lt: currentStart },
        },
        _sum: { spend: true },
      });
      current = currentSpend._sum.spend || 0;
      previous = previousSpend._sum.spend || 0;
      break;
    }

    case "conversions": {
      const currentConversions = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: currentStart },
        },
        _sum: { conversions: true },
      });
      const previousConversions = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: previousStart, lt: currentStart },
        },
        _sum: { conversions: true },
      });
      current = currentConversions._sum.conversions || 0;
      previous = previousConversions._sum.conversions || 0;
      break;
    }

    case "impressions": {
      const currentImpressions = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: currentStart },
        },
        _sum: { impressions: true },
      });
      const previousImpressions = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: previousStart, lt: currentStart },
        },
        _sum: { impressions: true },
      });
      current = currentImpressions._sum.impressions || 0;
      previous = previousImpressions._sum.impressions || 0;
      break;
    }

    case "clicks": {
      const currentClicks = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: currentStart },
        },
        _sum: { clicks: true },
      });
      const previousClicks = await prisma.campaignMetric.aggregate({
        where: {
          workspaceId,
          ...(options.connectionId && { connectionId: options.connectionId }),
          date: { gte: previousStart, lt: currentStart },
        },
        _sum: { clicks: true },
      });
      current = currentClicks._sum.clicks || 0;
      previous = previousClicks._sum.clicks || 0;
      break;
    }

    case "roas": {
      const currentAttribution = await prisma.attributionSnapshot.aggregate({
        where: {
          workspaceId,
          date: { gte: currentStart },
        },
        _sum: { attributedRevenue: true, adSpend: true },
      });
      const previousAttribution = await prisma.attributionSnapshot.aggregate({
        where: {
          workspaceId,
          date: { gte: previousStart, lt: currentStart },
        },
        _sum: { attributedRevenue: true, adSpend: true },
      });
      const currentRevenue = currentAttribution._sum.attributedRevenue || 0;
      const currentAdSpend = currentAttribution._sum.adSpend || 1;
      const previousRevenue = previousAttribution._sum.attributedRevenue || 0;
      const previousAdSpend = previousAttribution._sum.adSpend || 1;
      current = currentRevenue / currentAdSpend;
      previous = previousRevenue / previousAdSpend;
      break;
    }
  }

  return {
    metric,
    current,
    previous: previous > 0 ? previous : undefined,
    timestamp: now,
  };
}

/**
 * Send alert for data quality violation.
 */
async function sendDataQualityAlert(
  rule: DataQualityRule,
  workspaceId: string,
  details: { actualValue: number; expectedValue?: number; pctChange?: number }
): Promise<void> {
  logger.warn(`[Data Quality Alert] ${rule.name}: ${details.actualValue} (expected: ${details.expectedValue})`);

  try {
    const { sendAgencyAlert } = await import("@/lib/alerts");
    const changeText = details.pctChange !== undefined ? ` (${(details.pctChange * 100).toFixed(1)}% change)` : "";
    const msg = `⚠️ Data Quality Triggered: "${rule.name}"\nMetric: ${rule.metric} | Value: ${details.actualValue}${details.expectedValue !== undefined ? ` (expected: ${details.expectedValue})` : ""}${changeText}\nSeverity: ${rule.severity.toUpperCase()}`;
    await sendAgencyAlert({
      workspaceId,
      pipelineName: rule.name,
      errorMsg: msg,
    });
  } catch (e) {
    logger.error("[sendDataQualityAlert] Failed to dispatch alert", e);
  }
}

/**
 * Run data quality checks after a pipeline sync.
 */
export async function runPostSyncQualityChecks(
  workspaceId: string,
  syncLog: {
    id: string;
    pipelineId: string;
    rowsSynced: number;
    status: string;
  }
): Promise<void> {
  if (syncLog.status !== "success") return;

  const rules = await getActiveRules(workspaceId, syncLog.pipelineId);

  for (const rule of rules) {
    const snapshot = await getMetricSnapshot(workspaceId, rule.metric, {
      pipelineId: syncLog.pipelineId,
      dateRange: "day",
    });

    const result = await evaluateRule(rule, snapshot);

    if (result.violated) {
      await recordViolation(rule, workspaceId, {
        expectedValue: result.expectedValue,
        actualValue: result.actualValue,
        pctChange: result.pctChange,
        syncLogId: syncLog.id,
        pipelineId: syncLog.pipelineId,
      });
    }
  }
}

/**
 * Run data quality checks after a warehouse refresh or batch import.
 */
export async function runPostWarehouseRefreshQualityChecks(
  workspaceId: string,
  connectionId?: string
): Promise<void> {
  const rules = await getActiveRules(workspaceId, undefined, connectionId);

  for (const rule of rules) {
    const snapshot = await getMetricSnapshot(workspaceId, rule.metric, {
      connectionId,
      dateRange: "day",
    });

    const result = await evaluateRule(rule, snapshot);

    if (result.violated) {
      await recordViolation(rule, workspaceId, {
        expectedValue: result.expectedValue,
        actualValue: result.actualValue,
        pctChange: result.pctChange,
        connectionId,
      });
    }
  }
}
