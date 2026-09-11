/**
 * Operations Summary (Slice 1 of the Operations Hub Foundation).
 *
 * A tenant-safe, client-aware, READ-ONLY aggregation of operational evidence
 * that already exists in the warehouse. This module:
 *
 * - requires a workspace identity supplied by the caller (the route authorizes
 *   membership before calling in);
 * - reuses the authoritative client-context resolver so `clientId` can never
 *   widen scope;
 * - performs reads only — no Prisma mutation, no provider/destination contact,
 *   no telemetry/audit/notification emission;
 * - accepts an injected `now` so freshness evaluation is deterministic;
 * - returns bounded, deterministic, sanitized sections.
 *
 * It deliberately does NOT implement the Operations Hub UI.
 */

import { z } from "zod";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  assertQueryableClientContext,
  resolveClientDataScope,
  type ClientAssignmentTuple,
  type ClientDataScope,
} from "@/lib/client-context-server";
import {
  SOURCE_HEALTH_STALE_AFTER_MS,
  resolveSourceHealthState,
  type SourceHealthState,
} from "@/lib/source-health";
import { STALE_AFTER_MS as STALE_ESCALATION_MS } from "@/lib/ingestion/stale-health";
import {
  defaultReportingWindow,
  type ReadinessCode,
  type ReportReadinessStatus,
  type ReportingWindow,
} from "@/lib/report-readiness";
import { loadReportReadiness } from "@/lib/report-readiness-server";
import {
  detectMarketingAnomalies,
  type AnomalySeverity,
  type AnomalyType,
} from "@/lib/marketing-anomalies";
import type { MetricRowExport } from "@/lib/client-export";
import { QUARANTINE_THRESHOLD } from "@/lib/provider-account-health";

export const OPERATIONS_SUMMARY_VERSION = "operations-summary-v1";

/** Maximum rows returned by any single list in the summary. */
export const OPERATIONS_LIST_LIMIT = 25;
/** Maximum number of clients SHOWN in the readiness list. */
export const OPERATIONS_READINESS_CLIENT_LIMIT = 10;
/**
 * Maximum number of clients EVALUATED to derive the readiness state. The state
 * is authoritative only when the pager is exhausted within this ceiling; beyond
 * it the section fails closed. Readiness evaluation is per-client, so this
 * ceiling bounds the worst-case cost.
 */
export const OPERATIONS_READINESS_EVAL_LIMIT = 50;
/** Ingestion window for import-job totals and recent failures. */
export const OPERATIONS_INGESTION_WINDOW_DAYS = 7;
/** Metric window scanned for marketing anomalies. */
export const OPERATIONS_ANOMALY_WINDOW_DAYS = 14;
/** Hard bound on metric rows scanned for anomalies before truncation. */
export const OPERATIONS_ANOMALY_ROW_LIMIT = 2_000;
/** Delivery evidence older than this is reported as stale, never as current. */
export const OPERATIONS_DELIVERY_RECENCY_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard bound on delivery receipts scanned before truncation. */
export const OPERATIONS_DELIVERY_RECEIPT_LIMIT = 200;
/** Maximum stored length of any provider-supplied error text in the summary. */
export const OPERATIONS_EVIDENCE_TEXT_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (value: Date): string => value.toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/* Contract types                                                             */
/* -------------------------------------------------------------------------- */

export type OperationsSectionState = "ready" | "attention" | "unavailable" | "unsupported" | "empty";

/** Documented reasons a section carries no evidence. Never a silent zero. */
export type OperationsReason =
  | "import_jobs_not_client_attributable"
  | "operations_section_unavailable";

export type OperationsSection<T> =
  | {
      state: "ready" | "attention" | "empty";
      data: T;
      truncated: boolean;
      limit: number;
      reason: null;
      href: string;
    }
  | {
      state: "unavailable" | "unsupported";
      data: null;
      truncated: false;
      limit: 0;
      reason: OperationsReason;
      href: string;
    };

export type OperationsAccountHealthStatus =
  | "healthy"
  | "degraded"
  | "quarantined"
  | "reconnect_required"
  | "unknown";

export type ConnectorHealthAccount = {
  connectionId: string;
  provider: string;
  accountId: string;
  accountName: string | null;
  status: OperationsAccountHealthStatus;
  errorCategory: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastErrorSummary: string | null;
};

export type ConnectorHealthData = {
  quarantineThreshold: number;
  totals: {
    total: number;
    healthy: number;
    degraded: number;
    quarantined: number;
    reconnectRequired: number;
    unknown: number;
  };
  attention: ConnectorHealthAccount[];
};

export type FreshnessSource = {
  connectionId: string;
  provider: string;
  name: string;
  state: SourceHealthState;
  lastSyncAt: string | null;
  lastDataThrough: string | null;
};

export type FreshnessData = {
  /**
   * Connection freshness policy (24h). This is the Sources-page concept and is
   * NOT the same signal as `escalationHours`.
   */
  sourceFreshnessHours: number;
  /**
   * Pipeline/stale-health escalation window (26h). This summary only REPORTS
   * the escalation threshold; it never runs the escalation job, which mutates
   * pipeline rows.
   */
  escalationHours: number;
  totals: Record<SourceHealthState, number>;
  attention: FreshnessSource[];
};

export type IngestionFailure = {
  id: string;
  status: "partial" | "failed";
  errorSummary: string | null;
  finishedAt: string | null;
  since: string;
  until: string;
};

export type IngestionSyncLogError = {
  id: string;
  pipelineId: string;
  status: string;
  errorSummary: string | null;
  createdAt: string;
};

export type IngestionData = {
  windowDays: number;
  totals: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    partial: number;
    failed: number;
  };
  recentFailures: IngestionFailure[];
  syncLogErrors: IngestionSyncLogError[];
};

export type ReadinessClient = {
  clientId: string;
  clientName: string;
  status: ReportReadinessStatus;
  blockers: ReadinessCode[];
  warnings: ReadinessCode[];
};

export type ReadinessData = {
  window: ReportingWindow;
  evaluatedClients: number;
  totals: {
    ready: number;
    notReady: number;
    warning: number;
    unknown: number;
  };
  clients: ReadinessClient[];
};

export type DeliveryEntry = {
  clientId: string;
  destination: string;
  windowStart: string;
  windowEnd: string;
  dataThroughDate: string;
  rowCount: number;
  retrievedAt: string;
  stale: boolean;
};

export type DeliveryData = {
  recencyHours: number;
  totals: {
    receipts: number;
    stale: number;
    clients: number;
  };
  latest: DeliveryEntry[];
};

export type AnomalyEntry = {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  platform: string;
  campaignName: string;
  accountName: string | null;
  clientId: string | null;
};

export type AnomaliesData = {
  windowDays: number;
  totals: {
    total: number;
    critical: number;
    warning: number;
  };
  items: AnomalyEntry[];
};

export type OperationsNavigationTargets = {
  sources: string;
  reports: string;
  clients: string;
  explorer: string;
  exports: string;
};

export type OperationsSummary = {
  version: typeof OPERATIONS_SUMMARY_VERSION;
  workspaceId: string;
  generatedAt: string;
  clientContext: {
    status: "none" | "all" | "unassigned" | "resolved";
    client: { id: string; name: string } | null;
    scope: "workspace" | "unassigned" | "explicit" | "legacy";
  };
  navigation: OperationsNavigationTargets;
  sections: {
    connectorHealth: OperationsSection<ConnectorHealthData>;
    freshness: OperationsSection<FreshnessData>;
    ingestion: OperationsSection<IngestionData>;
    readiness: OperationsSection<ReadinessData>;
    delivery: OperationsSection<DeliveryData>;
    anomalies: OperationsSection<AnomaliesData>;
  };
};

export type LoadOperationsSummaryInput = {
  workspaceId: string;
  /**
   * Raw requested client context. `null`/`undefined` and the `all` sentinel
   * both mean workspace-wide. The `unassigned` sentinel is rejected by the
   * operations surface policy (see CLIENT_CONTEXT_SURFACE_POLICY).
   */
  requestedClientId?: string | null;
  /** Injected clock. Freshness/window evaluation never reads the wall clock. */
  now?: Date;
};

/** Query contract for `GET /api/operations/summary`. */
export const operationsSummaryQuerySchema = z
  .object({
    workspaceId: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/),
    clientId: z.string().max(160).optional(),
  })
  .strict();

/* -------------------------------------------------------------------------- */
/* Sanitization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Bounded, credential-safe representation of provider-supplied error text.
 * Control characters are removed, long opaque tokens are redacted, and the
 * result is truncated. Returns null rather than an empty string.
 */
export function sanitizeEvidenceText(
  value: string | null | undefined,
  maxLength = OPERATIONS_EVIDENCE_TEXT_LIMIT,
): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed) return null;
  const redacted = collapsed.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, Math.max(1, maxLength - 1))}…`;
}

const iso = (value: Date | null | undefined): string | null =>
  value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;

const byId = <T extends { id: string }>(a: T, b: T): number => a.id.localeCompare(b.id);

/* -------------------------------------------------------------------------- */
/* Pure summarizers (deterministic; unit-testable without a database)          */
/* -------------------------------------------------------------------------- */

export type ConnectorHealthRow = {
  connectionId: string;
  provider: string;
  accountId: string;
  accountName: string | null;
  status: string;
  errorCategory: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastSuccessAt: Date | null;
};

function normalizeAccountHealthStatus(status: string): OperationsAccountHealthStatus {
  return status === "healthy" || status === "degraded" || status === "quarantined" || status === "reconnect_required"
    ? status
    : "unknown";
}

export function summarizeConnectorHealth(
  rows: readonly ConnectorHealthRow[],
  options: { limit?: number } = {},
): ConnectorHealthData {
  const limit = options.limit ?? OPERATIONS_LIST_LIMIT;
  const totals = { total: rows.length, healthy: 0, degraded: 0, quarantined: 0, reconnectRequired: 0, unknown: 0 };
  const attention: ConnectorHealthAccount[] = [];

  for (const row of rows) {
    const status = normalizeAccountHealthStatus(row.status);
    if (status === "healthy") totals.healthy += 1;
    else if (status === "degraded") totals.degraded += 1;
    else if (status === "quarantined") totals.quarantined += 1;
    else if (status === "reconnect_required") totals.reconnectRequired += 1;
    else totals.unknown += 1;

    if (status === "healthy") continue;
    attention.push({
      connectionId: row.connectionId,
      provider: row.provider,
      accountId: row.accountId,
      accountName: row.accountName ?? null,
      status,
      errorCategory: row.errorCategory ?? null,
      consecutiveFailures: Number.isFinite(row.consecutiveFailures) ? row.consecutiveFailures : 0,
      lastSuccessAt: iso(row.lastSuccessAt),
      lastErrorSummary: sanitizeEvidenceText(row.lastError),
    });
  }

  attention.sort(
    (a, b) =>
      a.status.localeCompare(b.status) ||
      a.provider.localeCompare(b.provider) ||
      a.accountId.localeCompare(b.accountId) ||
      a.connectionId.localeCompare(b.connectionId),
  );

  return {
    quarantineThreshold: QUARANTINE_THRESHOLD,
    totals,
    attention: attention.slice(0, limit),
  };
}

export type FreshnessRow = {
  id: string;
  provider: string;
  name: string;
  status: string;
  lastError: string | null;
  lastSyncAt: Date | null;
  lastDataThrough: Date | null;
  isSyncing?: boolean;
};

const SOURCE_HEALTH_STATES: SourceHealthState[] = [
  "fresh",
  "stale",
  "error",
  "partial",
  "syncing",
  "pending",
  "disconnected",
  "unknown",
];

export function summarizeFreshness(
  rows: readonly FreshnessRow[],
  options: { now: Date; limit?: number },
): FreshnessData {
  const limit = options.limit ?? OPERATIONS_LIST_LIMIT;
  const staleBefore = new Date(options.now.getTime() - SOURCE_HEALTH_STALE_AFTER_MS);
  const totals = SOURCE_HEALTH_STATES.reduce(
    (acc, state) => ({ ...acc, [state]: 0 }),
    {} as Record<SourceHealthState, number>,
  );
  const attention: FreshnessSource[] = [];

  for (const row of rows) {
    const state = resolveSourceHealthState({
      connectionStatus: row.status,
      lastError: row.lastError,
      lastSyncAt: row.lastSyncAt,
      isSyncing: row.isSyncing,
      staleBefore,
    });
    totals[state] += 1;
    if (state === "fresh") continue;
    attention.push({
      connectionId: row.id,
      provider: row.provider,
      name: row.name,
      state,
      lastSyncAt: iso(row.lastSyncAt),
      lastDataThrough: iso(row.lastDataThrough),
    });
  }

  attention.sort(
    (a, b) =>
      a.state.localeCompare(b.state) ||
      a.provider.localeCompare(b.provider) ||
      a.connectionId.localeCompare(b.connectionId),
  );

  return {
    sourceFreshnessHours: SOURCE_HEALTH_STALE_AFTER_MS / (60 * 60 * 1000),
    escalationHours: STALE_ESCALATION_MS / (60 * 60 * 1000),
    totals,
    attention: attention.slice(0, limit),
  };
}

export type IngestionJobRow = {
  id: string;
  status: string;
  errorMsg: string | null;
  finishedAt: Date | null;
  since: string;
  until: string;
};

export type SyncLogErrorRow = {
  id: string;
  pipelineId: string;
  status: string;
  errorMsg: string | null;
  createdAt: Date;
};

export function summarizeIngestion(
  jobs: readonly IngestionJobRow[],
  syncLogErrors: readonly SyncLogErrorRow[],
  options: { limit?: number; windowDays?: number } = {},
): IngestionData {
  const limit = options.limit ?? OPERATIONS_LIST_LIMIT;
  const totals = { total: jobs.length, queued: 0, running: 0, completed: 0, partial: 0, failed: 0 };

  for (const job of jobs) {
    if (job.status === "queued") totals.queued += 1;
    else if (job.status === "running") totals.running += 1;
    else if (job.status === "completed") totals.completed += 1;
    else if (job.status === "partial") totals.partial += 1;
    else if (job.status === "failed") totals.failed += 1;
  }

  const recentFailures: IngestionFailure[] = jobs
    .filter((job) => job.status === "partial" || job.status === "failed")
    .map((job) => ({
      id: job.id,
      status: job.status as "partial" | "failed",
      errorSummary: sanitizeEvidenceText(job.errorMsg),
      finishedAt: iso(job.finishedAt),
      since: job.since,
      until: job.until,
    }))
    .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? "") || byId(a, b))
    .slice(0, limit);

  const errors: IngestionSyncLogError[] = [...syncLogErrors]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byId(a, b))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      pipelineId: row.pipelineId,
      status: row.status,
      errorSummary: sanitizeEvidenceText(row.errorMsg),
      createdAt: row.createdAt.toISOString(),
    }));

  return {
    windowDays: options.windowDays ?? OPERATIONS_INGESTION_WINDOW_DAYS,
    totals,
    recentFailures,
    syncLogErrors: errors,
  };
}

export type ReadinessEvaluationRow = {
  clientId: string;
  status: ReportReadinessStatus;
  blockers: ReadonlyArray<{ code: ReadinessCode }>;
  warnings: ReadonlyArray<{ code: ReadinessCode }>;
};

export function summarizeReadiness(
  evaluations: readonly ReadinessEvaluationRow[],
  options: { window: ReportingWindow; clientNames?: ReadonlyMap<string, string>; limit?: number },
): ReadinessData {
  const limit = options.limit ?? OPERATIONS_READINESS_CLIENT_LIMIT;
  const totals = { ready: 0, notReady: 0, warning: 0, unknown: 0 };

  for (const evaluation of evaluations) {
    if (evaluation.status === "READY") totals.ready += 1;
    else if (evaluation.status === "NOT_READY") totals.notReady += 1;
    else if (evaluation.status === "WARNING") totals.warning += 1;
    else totals.unknown += 1;
  }

  const clients: ReadinessClient[] = [...evaluations]
    .sort((a, b) => a.clientId.localeCompare(b.clientId))
    .slice(0, limit)
    .map((evaluation) => ({
      clientId: evaluation.clientId,
      clientName: options.clientNames?.get(evaluation.clientId) ?? evaluation.clientId,
      status: evaluation.status,
      blockers: [...new Set(evaluation.blockers.map((issue) => issue.code))].sort(),
      warnings: [...new Set(evaluation.warnings.map((issue) => issue.code))].sort(),
    }));

  return {
    window: options.window,
    evaluatedClients: evaluations.length,
    totals,
    clients,
  };
}

export type DeliveryReceiptRow = {
  id: string;
  clientId: string;
  destination: string;
  windowStart: string;
  windowEnd: string;
  dataThroughDate: string;
  rowCount: number;
  retrievedAt: Date;
};

export function summarizeDelivery(
  receipts: readonly DeliveryReceiptRow[],
  options: { now: Date; limit?: number },
): DeliveryData {
  const limit = options.limit ?? OPERATIONS_LIST_LIMIT;
  const latestByKey = new Map<string, DeliveryReceiptRow>();

  for (const receipt of receipts) {
    const key = `${receipt.clientId}::${receipt.destination}`;
    const current = latestByKey.get(key);
    if (
      !current ||
      receipt.retrievedAt.getTime() > current.retrievedAt.getTime() ||
      (receipt.retrievedAt.getTime() === current.retrievedAt.getTime() && receipt.id.localeCompare(current.id) > 0)
    ) {
      latestByKey.set(key, receipt);
    }
  }

  const all = [...latestByKey.values()].sort(
    (a, b) =>
      a.clientId.localeCompare(b.clientId) ||
      a.destination.localeCompare(b.destination) ||
      a.id.localeCompare(b.id),
  );
  const cutoff = options.now.getTime() - OPERATIONS_DELIVERY_RECENCY_MS;
  const latest: DeliveryEntry[] = all.slice(0, limit).map((receipt) => ({
    clientId: receipt.clientId,
    destination: receipt.destination,
    windowStart: receipt.windowStart,
    windowEnd: receipt.windowEnd,
    dataThroughDate: receipt.dataThroughDate,
    rowCount: receipt.rowCount,
    retrievedAt: receipt.retrievedAt.toISOString(),
    stale: receipt.retrievedAt.getTime() < cutoff,
  }));

  return {
    recencyHours: OPERATIONS_DELIVERY_RECENCY_MS / (60 * 60 * 1000),
    totals: {
      receipts: all.length,
      stale: all.filter((receipt) => receipt.retrievedAt.getTime() < cutoff).length,
      clients: new Set(all.map((receipt) => receipt.clientId)).size,
    },
    latest,
  };
}

export function summarizeAnomalies(
  anomalies: ReadonlyArray<{
    id: string;
    type: AnomalyType;
    severity: AnomalySeverity;
    platform: string;
    campaignName: string;
    accountName?: string;
    clientId?: string;
  }>,
  options: { limit?: number; windowDays?: number } = {},
): AnomaliesData {
  const limit = options.limit ?? OPERATIONS_LIST_LIMIT;
  const items: AnomalyEntry[] = [...anomalies]
    .sort(
      (a, b) =>
        (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1) ||
        a.platform.localeCompare(b.platform) ||
        a.campaignName.localeCompare(b.campaignName) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit)
    .map((anomaly) => ({
      id: anomaly.id,
      type: anomaly.type,
      severity: anomaly.severity,
      platform: anomaly.platform,
      campaignName: anomaly.campaignName,
      accountName: anomaly.accountName ?? null,
      clientId: anomaly.clientId ?? null,
    }));

  return {
    windowDays: options.windowDays ?? OPERATIONS_ANOMALY_WINDOW_DAYS,
    totals: {
      total: anomalies.length,
      critical: anomalies.filter((anomaly) => anomaly.severity === "critical").length,
      warning: anomalies.filter((anomaly) => anomaly.severity === "warning").length,
    },
    items,
  };
}

/* -------------------------------------------------------------------------- */
/* Section state helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Build a section that carries evidence. `empty` is deliberately distinct from
 * `ready`: "no applicable records" must never be rendered as "all healthy".
 */
export function operationsSection<T>(
  data: T,
  options: {
    attention: boolean;
    empty: boolean;
    truncated: boolean;
    limit: number;
    href: string;
    /**
     * Whether `attention`/`empty` were derived from evidence covering the WHOLE
     * population rather than the bounded slice. When true, `truncated` is a
     * display-only disclosure (a capped list) and does not affect the state.
     *
     * Defaults to false, which fails closed: a truncated section whose state
     * came from the bounded slice can never report `ready` or `empty`, because
     * rows beyond the bound may be attention-worthy.
     */
    stateAuthoritative?: boolean;
  },
): OperationsSection<T> {
  const failsClosed = options.truncated && options.stateAuthoritative !== true;
  if (options.empty && !failsClosed) {
    return { state: "empty", data, truncated: options.truncated, limit: options.limit, reason: null, href: options.href };
  }
  return {
    state: options.attention || failsClosed ? "attention" : "ready",
    data,
    truncated: options.truncated,
    limit: options.limit,
    reason: null,
    href: options.href,
  };
}

/** A section whose evidence cannot be produced for this scope. Carries no data. */
export function operationsUnsupportedSection<T>(reason: OperationsReason, href: string): OperationsSection<T> {
  return { state: "unsupported", data: null, truncated: false, limit: 0, reason, href };
}

/** A section whose read failed. Carries no data and no error detail. */
export function operationsUnavailableSection<T>(href: string): OperationsSection<T> {
  return { state: "unavailable", data: null, truncated: false, limit: 0, reason: "operations_section_unavailable", href };
}

/** Internal application paths to already-authorized surfaces. Never external. */
const NAVIGATION: OperationsNavigationTargets = {
  sources: "/sources",
  reports: "/reports",
  clients: "/clients",
  explorer: "/explorer",
  exports: "/exports",
};

/* -------------------------------------------------------------------------- */
/* Client scope                                                               */
/* -------------------------------------------------------------------------- */

type OperationsScope = {
  mode: "workspace" | "unassigned" | "explicit" | "legacy";
  clientId: string | null;
  connectionIds: string[];
  assignments: ClientAssignmentTuple[];
};

function scopeFromDataScope(dataScope: ClientDataScope): OperationsScope {
  const resolution = dataScope.resolution;
  if (resolution.status === "resolved") {
    return {
      mode: dataScope.ownershipMode === "explicit" ? "explicit" : "legacy",
      clientId: resolution.client.id,
      connectionIds: dataScope.connectionIds,
      assignments: dataScope.assignments,
    };
  }
  if (resolution.status === "unassigned") {
    return { mode: "unassigned", clientId: null, connectionIds: [], assignments: [] };
  }
  return { mode: "workspace", clientId: null, connectionIds: [], assignments: [] };
}

/**
 * Root ownership predicate. A client with an explicit-empty assignment set (or
 * a legacy client with no source connections) must resolve to NO rows — never
 * to workspace-wide data, and never inferred from connection membership alone.
 */
function accountScopeWhere(scope: OperationsScope): Prisma.ProviderAccountHealthWhereInput {
  if (scope.mode === "explicit") {
    if (scope.assignments.length === 0) return { id: { in: [] } };
    return {
      OR: scope.assignments.map((assignment) => ({
        connectionId: assignment.connectionId,
        provider: assignment.provider,
        accountId: assignment.accountId,
      })),
    };
  }
  if (scope.mode === "legacy") {
    if (scope.connectionIds.length === 0) return { id: { in: [] } };
    return { connectionId: { in: scope.connectionIds } };
  }
  if (scope.mode === "unassigned") return { id: { in: [] } };
  return {};
}

function connectionScopeWhere(scope: OperationsScope): Prisma.ConnectionWhereInput {
  if (scope.mode === "workspace") return {};
  if (scope.connectionIds.length === 0) return { id: { in: [] } };
  return { id: { in: scope.connectionIds } };
}

function metricScopeWhere(scope: OperationsScope, workspaceId: string): Prisma.CampaignMetricWhereInput {
  if (scope.mode === "explicit") {
    if (scope.assignments.length === 0) return { workspaceId, id: { in: [] } };
    return {
      workspaceId,
      OR: scope.assignments.map((assignment) => ({
        connectionId: assignment.connectionId,
        platform: assignment.provider,
        accountId: assignment.accountId,
      })),
    };
  }
  if (scope.mode === "legacy") {
    if (scope.connectionIds.length === 0) return { workspaceId, id: { in: [] } };
    return { workspaceId, connectionId: { in: scope.connectionIds } };
  }
  if (scope.mode === "unassigned") return { workspaceId, id: { in: [] } };
  return { workspaceId };
}

/* -------------------------------------------------------------------------- */
/* Section loaders                                                            */
/* -------------------------------------------------------------------------- */

async function loadConnectorHealth(
  workspaceId: string,
  scope: OperationsScope,
): Promise<OperationsSection<ConnectorHealthData>> {
  const href = NAVIGATION.sources;
  const scopeWhere = { workspaceId, ...accountScopeWhere(scope) };
  try {
    // The state is derived from an authoritative groupBy over the WHOLE scoped
    // population, never from the bounded display list: a workspace with more
    // accounts than the list bound must not be reported `ready` merely because
    // the retained slice happens to be healthy. `normalizeAccountHealthStatus`
    // maps only the literal "healthy" to healthy, so `status !== "healthy"` is
    // an exact SQL predicate for attention.
    const [grouped, attentionRows] = await Promise.all([
      prisma.providerAccountHealth.groupBy({
        by: ["status"],
        where: scopeWhere,
        _count: { _all: true },
      }),
      prisma.providerAccountHealth.findMany({
        where: { ...scopeWhere, status: { not: "healthy" } },
        orderBy: [{ connectionId: "asc" }, { accountId: "asc" }],
        take: OPERATIONS_LIST_LIMIT,
        select: {
          connectionId: true,
          provider: true,
          accountId: true,
          accountName: true,
          status: true,
          errorCategory: true,
          consecutiveFailures: true,
          lastError: true,
          lastSuccessAt: true,
        },
      }),
    ]);

    const totals: ConnectorHealthData["totals"] = {
      total: 0,
      healthy: 0,
      degraded: 0,
      quarantined: 0,
      reconnectRequired: 0,
      unknown: 0,
    };
    for (const entry of grouped) {
      const count = entry._count._all;
      const status = normalizeAccountHealthStatus(entry.status);
      totals.total += count;
      if (status === "healthy") totals.healthy += count;
      else if (status === "degraded") totals.degraded += count;
      else if (status === "quarantined") totals.quarantined += count;
      else if (status === "reconnect_required") totals.reconnectRequired += count;
      else totals.unknown += count;
    }

    const attentionCount = totals.total - totals.healthy;
    const data = summarizeConnectorHealth(attentionRows, { limit: OPERATIONS_LIST_LIMIT });
    // Totals describe the whole population, not the bounded display list.
    data.totals = totals;
    return operationsSection(data, {
      attention: attentionCount > 0,
      empty: totals.total === 0,
      // Display-only disclosure: the attention list is capped, not the evidence.
      truncated: attentionCount > OPERATIONS_LIST_LIMIT,
      limit: OPERATIONS_LIST_LIMIT,
      href,
      stateAuthoritative: true,
    });
  } catch {
    return operationsUnavailableSection<ConnectorHealthData>(href);
  }
}

async function loadFreshness(
  workspaceId: string,
  scope: OperationsScope,
  now: Date,
): Promise<OperationsSection<FreshnessData>> {
  const href = NAVIGATION.sources;
  try {
    // Source connections are a small per-tenant table (each row is an OAuth
    // link), so the WHOLE population is read and the state is derived from all
    // of it; only the displayed attention list is capped. Bounding the scan
    // would let a stale or errored connection outside the bound be reported as
    // `ready`.
    const rows = await prisma.connection.findMany({
      where: { workspaceId, type: "source", ...connectionScopeWhere(scope) },
      orderBy: { id: "asc" },
      select: {
        id: true,
        provider: true,
        name: true,
        status: true,
        lastError: true,
        lastSyncAt: true,
        lastDataThrough: true,
      },
    });
    const full = summarizeFreshness(rows, { now, limit: rows.length });
    const attentionCount = full.attention.length;
    const data: FreshnessData = {
      ...full,
      attention: full.attention.slice(0, OPERATIONS_LIST_LIMIT),
    };
    return operationsSection(data, {
      attention: attentionCount > 0,
      empty: rows.length === 0,
      // Display-only disclosure: the attention list is capped, not the evidence.
      truncated: attentionCount > OPERATIONS_LIST_LIMIT,
      limit: OPERATIONS_LIST_LIMIT,
      href,
      stateAuthoritative: true,
    });
  } catch {
    return operationsUnavailableSection<FreshnessData>(href);
  }
}

async function loadIngestion(
  workspaceId: string,
  scope: OperationsScope,
  now: Date,
): Promise<OperationsSection<IngestionData>> {
  const href = NAVIGATION.reports;
  // WarehouseImportJob carries JSON children, not a client/connection FK, and
  // client attribution from `items[].connectionId` would infer ownership from
  // connection membership. The section is therefore workspace-scoped only.
  if (scope.mode !== "workspace") {
    return operationsUnsupportedSection<IngestionData>("import_jobs_not_client_attributable", href);
  }
  try {
    const since = new Date(now.getTime() - OPERATIONS_INGESTION_WINDOW_DAYS * DAY_MS);
    const syncLogErrorWhere: Prisma.SyncLogWhereInput = {
      pipeline: { workspaceId },
      status: { in: ["error", "failed"] },
    };
    const [grouped, jobs, syncLogErrors, syncLogErrorTotal] = await Promise.all([
      prisma.warehouseImportJob.groupBy({
        by: ["status"],
        where: { workspaceId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.warehouseImportJob.findMany({
        where: { workspaceId, createdAt: { gte: since } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: OPERATIONS_LIST_LIMIT + 1,
        select: { id: true, status: true, errorMsg: true, finishedAt: true, since: true, until: true },
      }),
      prisma.syncLog.findMany({
        where: syncLogErrorWhere,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: OPERATIONS_LIST_LIMIT + 1,
        select: { id: true, pipelineId: true, status: true, errorMsg: true, createdAt: true },
      }),
      // Authoritative count: the bounded scan above can miss an older failure,
      // so the state must not be derived from the slice alone.
      prisma.syncLog.count({ where: syncLogErrorWhere }),
    ]);

    const truncated = jobs.length > OPERATIONS_LIST_LIMIT || syncLogErrors.length > OPERATIONS_LIST_LIMIT;
    const data = summarizeIngestion(
      jobs.slice(0, OPERATIONS_LIST_LIMIT),
      syncLogErrors.slice(0, OPERATIONS_LIST_LIMIT),
      { limit: OPERATIONS_LIST_LIMIT, windowDays: OPERATIONS_INGESTION_WINDOW_DAYS },
    );
    // The grouped counts are authoritative for the whole window, so they drive
    // BOTH the total and the per-status breakdown. Deriving the breakdown from
    // the bounded job scan instead would make `sum(status) !== total` and would
    // let `attention` miss failures outside the newest OPERATIONS_LIST_LIMIT jobs.
    const totals: IngestionData["totals"] = {
      total: 0,
      queued: 0,
      running: 0,
      completed: 0,
      partial: 0,
      failed: 0,
    };
    for (const entry of grouped) {
      const count = entry._count._all;
      totals.total += count;
      if (entry.status === "queued") totals.queued += count;
      else if (entry.status === "running") totals.running += count;
      else if (entry.status === "completed") totals.completed += count;
      else if (entry.status === "partial") totals.partial += count;
      else if (entry.status === "failed") totals.failed += count;
    }
    data.totals = totals;

    return operationsSection(data, {
      attention: totals.failed > 0 || totals.partial > 0 || syncLogErrorTotal > 0,
      empty: totals.total === 0 && syncLogErrorTotal === 0,
      // Display-only disclosure: the lists are capped, not the evidence.
      truncated,
      limit: OPERATIONS_LIST_LIMIT,
      href,
      stateAuthoritative: true,
    });
  } catch {
    return operationsUnavailableSection<IngestionData>(href);
  }
}

async function loadReadiness(
  workspaceId: string,
  scope: OperationsScope,
  now: Date,
): Promise<OperationsSection<ReadinessData>> {
  const href = NAVIGATION.reports;
  try {
    const window = defaultReportingWindow(now);
    // Evaluate up to the (larger) evaluation ceiling so the state covers every
    // client in a normal workspace, while the displayed list stays at the
    // smaller display limit. If the pager is not exhausted within the ceiling
    // the section fails closed instead of certifying a sampled state.
    const result = await loadReportReadiness(workspaceId, window, {
      clientId: scope.mode === "explicit" || scope.mode === "legacy" ? scope.clientId ?? undefined : undefined,
      limit: OPERATIONS_READINESS_EVAL_LIMIT,
    });
    const evaluations = result.evaluations;
    const clientIds = [...new Set(evaluations.map((evaluation) => evaluation.clientId))].sort();
    const clients = clientIds.length
      ? await prisma.client.findMany({
          where: { workspaceId, id: { in: clientIds } },
          select: { id: true, name: true },
        })
      : [];
    const data = summarizeReadiness(evaluations, {
      window,
      clientNames: new Map(clients.map((client) => [client.id, client.name])),
      limit: OPERATIONS_READINESS_CLIENT_LIMIT,
    });
    const exhaustive = !result.nextCursor;
    return operationsSection(data, {
      attention: data.totals.notReady > 0 || data.totals.warning > 0 || data.totals.unknown > 0,
      empty: evaluations.length === 0,
      // Two distinct disclosures. `!exhaustive` means the evaluation ceiling was
      // hit, so the state is no longer authoritative. The length check means the
      // DISPLAY list is capped while the state still covers every evaluated
      // client - the list must still be disclosed as capped.
      truncated: !exhaustive || evaluations.length > OPERATIONS_READINESS_CLIENT_LIMIT,
      limit: OPERATIONS_READINESS_CLIENT_LIMIT,
      href,
      stateAuthoritative: exhaustive,
    });
  } catch {
    return operationsUnavailableSection<ReadinessData>(href);
  }
}

async function loadDelivery(
  workspaceId: string,
  scope: OperationsScope,
  now: Date,
): Promise<OperationsSection<DeliveryData>> {
  const href = NAVIGATION.exports;
  const scopeWhere: Prisma.DestinationDeliveryReceiptWhereInput = {
    workspaceId,
    ...(scope.clientId ? { clientId: scope.clientId } : scope.mode === "workspace" ? {} : { id: { in: [] } }),
  };
  try {
    // Authoritative per-(client, destination) recency over the WHOLE population.
    // The bounded receipt scan is ordered `retrievedAt desc`, so it
    // systematically drops the OLDEST receipts - exactly the stale ones - and
    // therefore cannot certify staleness on its own.
    const [pairs, receipts] = await Promise.all([
      prisma.destinationDeliveryReceipt.groupBy({
        by: ["clientId", "destination"],
        where: scopeWhere,
        _max: { retrievedAt: true },
      }),
      prisma.destinationDeliveryReceipt.findMany({
        where: scopeWhere,
        orderBy: [{ retrievedAt: "desc" }, { id: "desc" }],
        take: OPERATIONS_DELIVERY_RECEIPT_LIMIT + 1,
        select: {
          id: true,
          clientId: true,
          destination: true,
          windowStart: true,
          windowEnd: true,
          dataThroughDate: true,
          rowCount: true,
          retrievedAt: true,
        },
      }),
    ]);

    const cutoff = now.getTime() - OPERATIONS_DELIVERY_RECENCY_MS;
    const stalePairs = pairs.filter((pair) => (pair._max.retrievedAt?.getTime() ?? 0) < cutoff).length;
    // Display-only disclosure: both the receipt scan and the pair list are capped.
    const truncated =
      receipts.length > OPERATIONS_DELIVERY_RECEIPT_LIMIT || pairs.length > OPERATIONS_LIST_LIMIT;

    const data = summarizeDelivery(receipts.slice(0, OPERATIONS_DELIVERY_RECEIPT_LIMIT), {
      now,
      limit: OPERATIONS_LIST_LIMIT,
    });
    // Totals describe the whole population, not the bounded display scan.
    data.totals = {
      receipts: pairs.length,
      stale: stalePairs,
      clients: new Set(pairs.map((pair) => pair.clientId)).size,
    };
    return operationsSection(data, {
      attention: stalePairs > 0,
      empty: pairs.length === 0,
      truncated,
      limit: OPERATIONS_LIST_LIMIT,
      href,
      stateAuthoritative: true,
    });
  } catch {
    return operationsUnavailableSection<DeliveryData>(href);
  }
}

async function loadAnomalies(
  workspaceId: string,
  scope: OperationsScope,
  now: Date,
): Promise<OperationsSection<AnomaliesData>> {
  const href = NAVIGATION.clients;
  try {
    const since = new Date(now.getTime() - OPERATIONS_ANOMALY_WINDOW_DAYS * DAY_MS);
    const metrics = await prisma.campaignMetric.findMany({
      where: { ...metricScopeWhere(scope, workspaceId), date: { gte: since } },
      // Scan newest-first so a truncated scan retains the recent rows anomaly
      // detection anchors to; oldest-first would drop them and suppress alerts.
      orderBy: [{ date: "desc" }, { connectionId: "asc" }, { accountId: "asc" }, { campaignId: "asc" }],
      take: OPERATIONS_ANOMALY_ROW_LIMIT + 1,
      select: {
        connectionId: true,
        platform: true,
        accountId: true,
        accountName: true,
        campaignId: true,
        campaignName: true,
        date: true,
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
        revenue: true,
        currency: true,
      },
    });
    const truncated = metrics.length > OPERATIONS_ANOMALY_ROW_LIMIT;
    const rows: MetricRowExport[] = metrics.slice(0, OPERATIONS_ANOMALY_ROW_LIMIT).map((metric) => ({
      platform: metric.platform,
      accountId: metric.accountId,
      accountName: metric.accountName,
      campaignId: metric.campaignId,
      campaignName: metric.campaignName,
      connectionId: metric.connectionId,
      date: ymd(metric.date),
      spend: Number(metric.spend) || 0,
      impressions: Number(metric.impressions) || 0,
      clicks: Number(metric.clicks) || 0,
      conversions: Number(metric.conversions) || 0,
      revenue: Number(metric.revenue) || 0,
      currency: metric.currency || "USD",
    }));
    const detected = detectMarketingAnomalies(rows, { referenceDate: ymd(now), maxStaleDays: 4 });
    const data = summarizeAnomalies(detected, {
      limit: OPERATIONS_LIST_LIMIT,
      windowDays: OPERATIONS_ANOMALY_WINDOW_DAYS,
    });
    // Client attribution is only authoritative for a concrete client scope.
    if (scope.clientId) {
      for (const item of data.items) item.clientId = scope.clientId;
    }
    return operationsSection(data, {
      attention: data.totals.total > 0,
      empty: data.totals.total === 0,
      truncated,
      limit: OPERATIONS_LIST_LIMIT,
      href,
      // Deliberately NOT stateAuthoritative: detection is row-based, so the
      // state cannot be derived from an aggregate. A truncated scan fails
      // closed, and the scan is newest-first so it retains the recent rows
      // that detection anchors to.
    });
  } catch {
    return operationsUnavailableSection<AnomaliesData>(href);
  }
}

/* -------------------------------------------------------------------------- */
/* Loader                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Load a bounded, tenant-safe, client-aware operations summary.
 *
 * The caller MUST have authorized workspace membership first. Client context is
 * resolved through the authoritative resolver, so malformed, rival, deleted and
 * unsupported values throw before any section is read.
 */
export async function loadOperationsSummary(input: LoadOperationsSummaryInput): Promise<OperationsSummary> {
  const now = input.now ?? new Date();
  const workspaceId = input.workspaceId;

  const dataScope = await resolveClientDataScope({
    workspaceId,
    requestedClientId: input.requestedClientId ?? null,
    surface: "operations",
  });
  assertQueryableClientContext(dataScope.resolution);
  const scope = scopeFromDataScope(dataScope);

  const [connectorHealth, freshness, ingestion, readiness, delivery, anomalies] = await Promise.all([
    loadConnectorHealth(workspaceId, scope),
    loadFreshness(workspaceId, scope, now),
    loadIngestion(workspaceId, scope, now),
    loadReadiness(workspaceId, scope, now),
    loadDelivery(workspaceId, scope, now),
    loadAnomalies(workspaceId, scope, now),
  ]);

  const resolution = dataScope.resolution;
  return {
    version: OPERATIONS_SUMMARY_VERSION,
    workspaceId,
    generatedAt: now.toISOString(),
    clientContext: {
      status: resolution.status === "resolved" ? "resolved" : resolution.status === "all" ? "all" : resolution.status === "unassigned" ? "unassigned" : "none",
      client: resolution.status === "resolved" ? { id: resolution.client.id, name: resolution.client.name } : null,
      scope: scope.mode,
    },
    navigation: { ...NAVIGATION },
    sections: { connectorHealth, freshness, ingestion, readiness, delivery, anomalies },
  };
}
