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
  expectedColumns?: string[];
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
const memoryCooldownMap = new Map<string, number>();
const COOLDOWN_SECONDS = 3600; // 1-hour alert deduplication cooldown

/**
 * Checks if an alert is in cooldown. If not in cooldown, sets the cooldown timestamp.
 * Note: Only critical Telegram-eligible alerts should invoke this function.
 */
export async function isAlertInCooldown(workspaceId: string, ruleId: string): Promise<boolean> {
  const cooldownKey = `monstera:dq_cooldown:${workspaceId}:${ruleId}`;
  const now = Date.now();

  try {
    const redis = getRedis();
    const existing = await redis.get(cooldownKey);
    if (existing) {
      return true;
    }
    // Set 1-hour cooldown key in Redis
    await redis.set(cooldownKey, now.toString(), { ex: COOLDOWN_SECONDS });
    return false;
  } catch {
    // In-memory fallback
    const lastSent = memoryCooldownMap.get(cooldownKey);
    if (lastSent && now - lastSent < COOLDOWN_SECONDS * 1000) {
      return true;
    }
    memoryCooldownMap.set(cooldownKey, now);
    return false;
  }
}

/**
 * Inspects real observed columns from warehouse tables (CampaignMetric, RetailOrder)
 * and compares against expectedColumns. Never defaults an error or empty state to passed.
 */
export async function inspectObservedSchema(
  workspaceId: string,
  connectionId?: string | null,
  expectedColumns?: string[]
): Promise<{ schemaValid: boolean; missingColumns: string[]; observedColumns: string[] }> {
  if (!expectedColumns || expectedColumns.length === 0) {
    return { schemaValid: true, missingColumns: [], observedColumns: [] };
  }

  try {
    const [latestCampaignMetric, latestRetailOrder] = await Promise.all([
      prisma.campaignMetric.findFirst({
        where: {
          workspaceId,
          ...(connectionId ? { connectionId } : {}),
        },
        orderBy: { date: "desc" },
      }),
      prisma.retailOrder.findFirst({
        where: {
          workspaceId,
          ...(connectionId ? { connectionId } : {}),
        },
        orderBy: { createdAtIso: "desc" },
      }),
    ]);

    const observedSet = new Set<string>();

    if (latestCampaignMetric) {
      Object.keys(latestCampaignMetric).forEach((k) => observedSet.add(k));
      if (latestCampaignMetric.rawData && typeof latestCampaignMetric.rawData === "object") {
        Object.keys(latestCampaignMetric.rawData as object).forEach((k) => observedSet.add(k));
      }
    }

    if (latestRetailOrder) {
      Object.keys(latestRetailOrder).forEach((k) => observedSet.add(k));
      if (latestRetailOrder.rawData && typeof latestRetailOrder.rawData === "object") {
        Object.keys(latestRetailOrder.rawData as object).forEach((k) => observedSet.add(k));
      }
    }

    if (observedSet.size === 0) {
      return {
        schemaValid: false,
        missingColumns: expectedColumns,
        observedColumns: [],
      };
    }

    const observedColumns = Array.from(observedSet);
    const missingColumns = expectedColumns.filter((col) => !observedSet.has(col));
    const schemaValid = missingColumns.length === 0;

    return { schemaValid, missingColumns, observedColumns };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[inspectObservedSchema] Error inspecting schema:", err);
    return {
      schemaValid: false,
      missingColumns: [`Inspection Error: ${errorMsg}`],
      observedColumns: [],
    };
  }
}

/**
 * Evaluate a single rule against a metric snapshot.
 */
export function evaluateRule(
  rule: DataQualityRule,
  snapshot: MetricSnapshot
): {
  violated: boolean;
  actualValue: number;
  expectedValue?: number;
  pctChange?: number;
  message: string;
} {
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
          message: violated
            ? `${metric} value (${actual}) exceeded maximum threshold (${threshold})`
            : "OK",
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
          message: violated
            ? `${metric} value (${actual}) dropped below minimum threshold (${threshold})`
            : "OK",
        };
      }
      break;

    case "eq":
      if (threshold !== undefined && threshold !== null) {
        const violated = actual !== threshold;
        return {
          violated,
          expectedValue: threshold,
          actualValue: actual,
          message: violated
            ? `${metric} value (${actual}) does not equal expected (${threshold})`
            : "OK",
        };
      }
      break;

    case "drop_pct":
      if (previous !== undefined && pctThreshold !== undefined && pctThreshold !== null && previous > 0) {
        const pctChange = (actual - previous) / previous;
        const violated = pctChange < -Math.abs(pctThreshold);
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
        const violated = pctChange > Math.abs(pctThreshold);
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
        { pipelineId: null, connectionId: null },
        ...(pipelineId ? [{ pipelineId }] : []),
        ...(connectionId ? [{ connectionId }] : []),
      ],
    },
  });

  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    ruleType: r.ruleType as DataQualityRuleType,
    metric: r.metric as DataQualityMetric,
    operator: r.operator as DataQualityOperator,
    threshold: r.threshold,
    pctThreshold: r.pctThreshold,
    pipelineId: r.pipelineId,
    connectionId: r.connectionId,
    severity: r.severity as DataQualitySeverity,
    notifyTelegram: r.notifyTelegram,
    notifyEmail: r.notifyEmail,
    expectedColumns: r.expectedColumns || [],
  }));
}

/**
 * Record a violation and send alerts.
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

  // - Warnings are audit-only (violation recorded, no external alert dispatched, no cooldown consumed)
  // - Critical violations trigger Telegram only when notifyTelegram is enabled and not in cooldown
  if (rule.severity === "critical" && (rule.notifyTelegram ?? true)) {
    const inCooldown = await isAlertInCooldown(workspaceId, rule.id);
    if (!inCooldown) {
      await sendDataQualityAlert(rule, workspaceId, details);
    }
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
    expectedColumns?: string[];
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

  // Schema check evaluation
  if (options.expectedColumns && options.expectedColumns.length > 0) {
    const schemaResult = await inspectObservedSchema(workspaceId, options.connectionId, options.expectedColumns);
    return {
      metric,
      current: schemaResult.schemaValid ? 1 : 0,
      schemaValid: schemaResult.schemaValid,
      missingColumns: schemaResult.missingColumns,
      timestamp: now,
    };
  }

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
      const [spendAgg, revAgg] = await Promise.all([
        prisma.campaignMetric.aggregate({
          where: {
            workspaceId,
            ...(options.connectionId && { connectionId: options.connectionId }),
            date: { gte: currentStart },
          },
          _sum: { spend: true },
        }),
        prisma.retailOrder.aggregate({
          where: {
            workspaceId,
            ...(options.connectionId && { connectionId: options.connectionId }),
            createdAt: { gte: currentStart },
          },
          _sum: { netRevenue: true },
        }),
      ]);
      const totalSpend = spendAgg._sum.spend || 0;
      const totalRev = revAgg._sum.netRevenue || 0;
      current = totalSpend > 0 ? totalRev / totalSpend : 0;
      break;
    }
  }

  return {
    metric,
    current,
    previous: previous || undefined,
    schemaValid: true,
    timestamp: now,
  };
}

/**
 * Send Telegram alert for data quality violation.
 */
export async function sendDataQualityAlert(
  rule: DataQualityRule,
  workspaceId: string,
  details: {
    expectedValue?: number;
    actualValue: number;
    pctChange?: number;
  }
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, telegramChatId: true },
  });

  const chatId = workspace?.telegramChatId || process.env.TELEGRAM_ALERT_CHAT_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!chatId || !botToken) {
    logger.info("[sendDataQualityAlert] Telegram not configured for workspace", { workspaceId });
    return;
  }

  const emoji = rule.severity === "critical" ? "🚨" : "⚠️";
  const lines = [
    `${emoji} <b>Data Quality Alert</b>`,
    `<b>Workspace:</b> ${workspace?.name || workspaceId}`,
    `<b>Rule:</b> ${rule.name}`,
    `<b>Severity:</b> ${rule.severity.toUpperCase()}`,
    `<b>Metric:</b> ${rule.metric}`,
    `<b>Actual:</b> ${details.actualValue.toLocaleString()}`,
  ];

  if (details.expectedValue !== undefined) {
    lines.push(`<b>Expected:</b> ${details.expectedValue.toLocaleString()}`);
  }
  if (details.pctChange !== undefined) {
    lines.push(`<b>Change:</b> ${(details.pctChange * 100).toFixed(1)}%`);
  }

  const message = lines.join("\n");

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    logger.error("[sendDataQualityAlert] Failed to send Telegram alert:", err);
  }
}

/**
 * Run all active quality checks after a pipeline sync.
 */
export async function runPostSyncQualityChecks(
  workspaceId: string,
  syncLog: { id: string; pipelineId: string; rowsSynced: number }
): Promise<void> {
  try {
    const rules = await getActiveRules(workspaceId, syncLog.pipelineId);
    for (const rule of rules) {
      const snapshot = await getMetricSnapshot(workspaceId, rule.metric, {
        pipelineId: syncLog.pipelineId,
        expectedColumns: rule.expectedColumns,
      });
      const result = evaluateRule(rule, snapshot);
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
  } catch (err) {
    logger.error("[runPostSyncQualityChecks] Error evaluating rules:", err);
  }
}

/**
 * Run quality checks after a warehouse refresh.
 */
export async function runPostWarehouseRefreshQualityChecks(
  workspaceId: string,
  connectionId?: string
): Promise<void> {
  try {
    const rules = await getActiveRules(workspaceId, undefined, connectionId);
    for (const rule of rules) {
      const snapshot = await getMetricSnapshot(workspaceId, rule.metric, {
        connectionId,
        expectedColumns: rule.expectedColumns,
      });
      const result = evaluateRule(rule, snapshot);
      if (result.violated) {
        await recordViolation(rule, workspaceId, {
          expectedValue: result.expectedValue,
          actualValue: result.actualValue,
          pctChange: result.pctChange,
          connectionId,
        });
      }
    }
  } catch (err) {
    logger.error("[runPostWarehouseRefreshQualityChecks] Error evaluating rules:", err);
  }
}
