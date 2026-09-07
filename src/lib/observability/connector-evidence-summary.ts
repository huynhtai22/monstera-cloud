import crypto from "node:crypto";
import type {
  ConnectorTelemetryEvent,
  ConnectorProvider,
} from "./connector-telemetry";

export interface PercentileSummary {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
}

export interface WorkspaceFairnessMetrics {
  opaqueWorkspaceId: string;
  totalJobs: number;
  totalItems: number;
  totalDurationMs: number;
  avgJobDurationMs: number;
  maxJobDurationMs: number;
  throttledCalls: number;
  failedJobs: number;
}

export interface ConnectorEvidenceSummary {
  totalEvents: number;
  totalCallsByProvider: Record<ConnectorProvider, number>;
  throttleRateByProvider: Record<ConnectorProvider, { totalCalls: number; throttledCalls: number; throttleRatePct: number }>;
  retryAmplification: {
    totalRequests: number;
    initialRequests: number;
    retryAttempts: number;
    amplificationRatio: number;
  };
  permanentAuthFailures: number;
  queueWaitStats: PercentileSummary;
  processingDurationStats: PercentileSummary;
  itemCountDistribution: {
    percentiles: PercentileSummary;
    buckets: {
      singleItem: number;      // 1 item
      small: number;           // 2-5 items
      medium: number;          // 6-20 items
      heavy: number;           // 21-50 items
      extreme: number;         // >50 items
    };
  };
  leaseContention: {
    totalLeaseEvents: number;
    acquired: number;
    refusedActive: number;
    refusedContention: number;
    leaseLost: number;
  };
  jobRunOutcomes: {
    totalJobs: number;
    completedSuccess: number;
    completedPartial: number;
    failed: number;
    partialRatePct: number;
    failureRatePct: number;
  };
  freshnessAdvancement: {
    totalFreshnessEvents: number;
    advanced: number;
    unchanged: number;
    advancementRatePct: number;
  };
  workspaceFairness: WorkspaceFairnessMetrics[];
}

function calculatePercentiles(values: number[]): PercentileSummary {
  if (values.length === 0) {
    return { p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / sorted.length);

  const getPercentile = (p: number) => {
    const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[idx];
  };

  return {
    p50: getPercentile(50),
    p90: getPercentile(90),
    p95: getPercentile(95),
    p99: getPercentile(99),
    min,
    max,
    avg,
  };
}

/**
 * Creates a pseudonymous operational identifier for a workspace.
 * Guards against empty/unspecified workspace identities to prevent
 * hash collisions on empty strings (e.g. sha256("") => e3b0c442).
 *
 * Note: Unsalted SHA-256 prefixes are pseudonymous surrogate keys,
 * not cryptographically irreversible commitments.
 */
export function hashWorkspace(wsId?: string | null): string {
  if (!wsId || typeof wsId !== "string") {
    return "ws_opaque_unspecified";
  }
  const trimmed = wsId.trim();
  if (!trimmed || trimmed === "ws_unspecified" || trimmed === "unknown_workspace") {
    return "ws_opaque_unspecified";
  }
  if (trimmed.startsWith("ws_opaque_")) return trimmed;
  return `ws_opaque_${crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 8)}`;
}

/**
 * Aggregates raw connector telemetry events into actionable operational metrics.
 *
 * Note: Summary thresholds (e.g. retry amplification, throttle rates, queue wait times)
 * are provisional operating hypotheses for pilot observability, not validated production SLOs
 * or capacity limits.
 */
export function summarizeConnectorEvidence(
  events: ConnectorTelemetryEvent[]
): ConnectorEvidenceSummary {
  const providers: ConnectorProvider[] = [
    "meta_ads",
    "google_ads",
    "tiktok_business",
    "shopee",
    "lazada",
    "warehouse_queue",
  ];

  const totalCallsByProvider: Record<ConnectorProvider, number> = {
    meta_ads: 0,
    google_ads: 0,
    tiktok_business: 0,
    shopee: 0,
    lazada: 0,
    warehouse_queue: 0,
  };

  const throttledCallsByProvider: Record<ConnectorProvider, number> = {
    meta_ads: 0,
    google_ads: 0,
    tiktok_business: 0,
    shopee: 0,
    lazada: 0,
    warehouse_queue: 0,
  };

  let totalRequests = 0;
  let initialRequests = 0;
  let retryAttempts = 0;
  let permanentAuthFailures = 0;

  const queueWaits: number[] = [];
  const processingDurations: number[] = [];
  const itemCounts: number[] = [];

  const buckets = {
    singleItem: 0,
    small: 0,
    medium: 0,
    heavy: 0,
    extreme: 0,
  };

  const leaseContention = {
    totalLeaseEvents: 0,
    acquired: 0,
    refusedActive: 0,
    refusedContention: 0,
    leaseLost: 0,
  };

  const jobOutcomes = {
    totalJobs: 0,
    completedSuccess: 0,
    completedPartial: 0,
    failed: 0,
  };

  const freshness = {
    totalFreshnessEvents: 0,
    advanced: 0,
    unchanged: 0,
  };

  const workspaceMap = new Map<string, {
    totalJobs: number;
    totalItems: number;
    durations: number[];
    throttled: number;
    failed: number;
  }>();

  for (const ev of events) {
    const isTenantScoped = ev.contextStatus !== "unbound" && Boolean(ev.workspaceId) && ev.workspaceId !== "ws_unspecified" && ev.workspaceId.trim() !== "";
    const wsKey = isTenantScoped ? hashWorkspace(ev.workspaceId) : null;
    let wsEntry: {
      totalJobs: number;
      totalItems: number;
      durations: number[];
      throttled: number;
      failed: number;
    } | null = null;

    if (wsKey && wsKey !== "ws_opaque_unspecified") {
      if (!workspaceMap.has(wsKey)) {
        workspaceMap.set(wsKey, {
          totalJobs: 0,
          totalItems: 0,
          durations: [],
          throttled: 0,
          failed: 0,
        });
      }
      wsEntry = workspaceMap.get(wsKey)!;
    }

    // Provider requests
    if (ev.eventCategory === "provider_request") {
      totalCallsByProvider[ev.provider] = (totalCallsByProvider[ev.provider] || 0) + 1;
      totalRequests++;

      if (ev.attempt === 1) {
        initialRequests++;
      } else if (ev.attempt > 1) {
        retryAttempts++;
      }

      if (
        ev.httpStatus === 429 ||
        ev.outcome === "throttled" ||
        ev.errorCategory === "rate_limited" ||
        ev.errorCategory === "quota_exhausted"
      ) {
        throttledCallsByProvider[ev.provider] = (throttledCallsByProvider[ev.provider] || 0) + 1;
        if (wsEntry) wsEntry.throttled++;
      }

      if (ev.outcome === "permanent_failure" || ev.errorCategory === "auth_revoked") {
        permanentAuthFailures++;
      }
    }

    // Job Lifecycle
    if (ev.eventCategory === "job_lifecycle") {
      if (typeof ev.queueWaitMs === "number") {
        queueWaits.push(ev.queueWaitMs);
      }
      if (typeof ev.durationMs === "number" && ev.durationMs > 0) {
        processingDurations.push(ev.durationMs);
        if (wsEntry) wsEntry.durations.push(ev.durationMs);
      }

      if (ev.operation === "job_completed" || ev.operation === "job_failed" || ev.operation === "job_terminal") {
        jobOutcomes.totalJobs++;
        if (wsEntry) wsEntry.totalJobs++;
        if (ev.outcome === "success") jobOutcomes.completedSuccess++;
        else if (ev.outcome === "partial") jobOutcomes.completedPartial++;
        else if (ev.outcome === "permanent_failure" || ev.outcome === "retryable_failure") {
          jobOutcomes.failed++;
          if (wsEntry) wsEntry.failed++;
        }

        if (typeof ev.itemCount === "number") {
          itemCounts.push(ev.itemCount);
          if (wsEntry) wsEntry.totalItems += ev.itemCount;

          if (ev.itemCount === 1) buckets.singleItem++;
          else if (ev.itemCount <= 5) buckets.small++;
          else if (ev.itemCount <= 20) buckets.medium++;
          else if (ev.itemCount <= 50) buckets.heavy++;
          else buckets.extreme++;
        }
      }
    }

    // Lease events
    if (ev.eventCategory === "lease_event" || ev.leaseOutcome) {
      leaseContention.totalLeaseEvents++;
      if (ev.leaseOutcome === "acquired") leaseContention.acquired++;
      else if (ev.leaseOutcome === "refused_active") leaseContention.refusedActive++;
      else if (ev.leaseOutcome === "refused_contention") leaseContention.refusedContention++;
      else if (ev.leaseOutcome === "lost" || ev.outcome === "lease_lost") leaseContention.leaseLost++;
    }

    // Freshness events
    if (ev.eventCategory === "freshness_event" || ev.freshnessOutcome) {
      freshness.totalFreshnessEvents++;
      if (ev.freshnessOutcome === "advanced") freshness.advanced++;
      else freshness.unchanged++;
    }
  }

  const throttleRateByProvider = {} as Record<ConnectorProvider, { totalCalls: number; throttledCalls: number; throttleRatePct: number }>;
  for (const p of providers) {
    const total = totalCallsByProvider[p] || 0;
    const throttled = throttledCallsByProvider[p] || 0;
    throttleRateByProvider[p] = {
      totalCalls: total,
      throttledCalls: throttled,
      throttleRatePct: total > 0 ? Math.round((throttled / total) * 1000) / 10 : 0,
    };
  }

  const workspaceFairness: WorkspaceFairnessMetrics[] = Array.from(workspaceMap.entries()).map(
    ([opaqueWorkspaceId, data]) => {
      const totalDurationMs = data.durations.reduce((acc, v) => acc + v, 0);
      const avgJobDurationMs = data.durations.length > 0 ? Math.round(totalDurationMs / data.durations.length) : 0;
      const maxJobDurationMs = data.durations.length > 0 ? Math.max(...data.durations) : 0;
      return {
        opaqueWorkspaceId,
        totalJobs: data.totalJobs,
        totalItems: data.totalItems,
        totalDurationMs,
        avgJobDurationMs,
        maxJobDurationMs,
        throttledCalls: data.throttled,
        failedJobs: data.failed,
      };
    }
  );

  const totalFinishedJobs = jobOutcomes.totalJobs;
  const partialRatePct = totalFinishedJobs > 0 ? Math.round((jobOutcomes.completedPartial / totalFinishedJobs) * 1000) / 10 : 0;
  const failureRatePct = totalFinishedJobs > 0 ? Math.round((jobOutcomes.failed / totalFinishedJobs) * 1000) / 10 : 0;

  const totalFreshness = freshness.totalFreshnessEvents;
  const advancementRatePct = totalFreshness > 0 ? Math.round((freshness.advanced / totalFreshness) * 1000) / 10 : 0;

  const amplificationRatio = initialRequests > 0
    ? Math.round(((initialRequests + retryAttempts) / initialRequests) * 100) / 100
    : 1;

  return {
    totalEvents: events.length,
    totalCallsByProvider,
    throttleRateByProvider,
    retryAmplification: {
      totalRequests,
      initialRequests,
      retryAttempts,
      amplificationRatio,
    },
    permanentAuthFailures,
    queueWaitStats: calculatePercentiles(queueWaits),
    processingDurationStats: calculatePercentiles(processingDurations),
    itemCountDistribution: {
      percentiles: calculatePercentiles(itemCounts),
      buckets,
    },
    leaseContention,
    jobRunOutcomes: {
      totalJobs: jobOutcomes.totalJobs,
      completedSuccess: jobOutcomes.completedSuccess,
      completedPartial: jobOutcomes.completedPartial,
      failed: jobOutcomes.failed,
      partialRatePct,
      failureRatePct,
    },
    freshnessAdvancement: {
      totalFreshnessEvents: totalFreshness,
      advanced: freshness.advanced,
      unchanged: freshness.unchanged,
      advancementRatePct,
    },
    workspaceFairness,
  };
}
