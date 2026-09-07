import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { logger } from "@/lib/logger";

export type ConnectorEventCategory =
  | "provider_request"
  | "job_lifecycle"
  | "lease_event"
  | "freshness_event";

export type ConnectorProvider =
  | "meta_ads"
  | "google_ads"
  | "tiktok_business"
  | "shopee"
  | "lazada"
  | "warehouse_queue";

export type TelemetryOutcome =
  | "success"
  | "partial"
  | "retryable_failure"
  | "permanent_failure"
  | "throttled"
  | "lease_lost"
  | "skipped";

export type TelemetryErrorCategory =
  | "auth_revoked"
  | "rate_limited"
  | "provider_unavailable"
  | "quota_exhausted"
  | "timeout"
  | "network_error"
  | "schema_drift"
  | "lease_lost"
  | "internal_error";

export type LeaseOutcome =
  | "acquired"
  | "refused_active"
  | "refused_contention"
  | "renewed"
  | "stolen"
  | "released"
  | "lost";

export type FreshnessOutcome = "advanced" | "unchanged" | "degraded";

export type TelemetryContextStatus = "tenant_scoped" | "unbound";

export interface ConnectorTelemetryEvent {
  schemaVersion: "1.0.0";
  eventName: "connector_telemetry";
  eventCategory: ConnectorEventCategory;
  provider: ConnectorProvider;
  operation: string;
  workspaceId: string;
  contextStatus: TelemetryContextStatus;
  connectionId?: string;
  opaqueAccountId?: string;
  jobId?: string;
  attempt: number;
  maxAttempts?: number;
  outcome: TelemetryOutcome;
  errorCategory?: TelemetryErrorCategory;
  httpStatus?: number;
  durationMs: number;
  retryDelayMs?: number;
  queueWaitMs?: number;
  itemCount?: number;
  completedItemCount?: number;
  dataWindowDays?: number;
  throttleUtilizationPct?: number;
  retryAfterSupplied?: boolean;
  retryAfterHonored?: boolean;
  leaseOutcome?: LeaseOutcome;
  freshnessOutcome?: FreshnessOutcome;
  timestamp: string;
}

export interface ConnectorTelemetryContext {
  workspaceId: string;
  connectionId?: string;
  opaqueAccountId?: string;
  jobId?: string;
  provider?: ConnectorProvider;
  dataWindowDays?: number;
}

const contextStorage = new AsyncLocalStorage<ConnectorTelemetryContext>();

/**
 * Runs a function within an active connector telemetry context.
 * Low-level HTTP/API client methods will automatically inherit context fields.
 */
export function runWithConnectorContext<T>(
  ctx: ConnectorTelemetryContext,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return contextStorage.run(ctx, fn);
}

/**
 * Returns the current active connector telemetry context, if any.
 */
export function getConnectorContext(): ConnectorTelemetryContext | undefined {
  return contextStorage.getStore();
}

/**
 * Creates a pseudonymous operational identifier for accounts to protect privacy in logs and metrics.
 * Note: Unsalted SHA-256 prefixes are pseudonymous surrogate keys, not cryptographically irreversible commitments.
 */
export function toOpaqueAccountId(rawId?: string | null): string | undefined {
  if (!rawId) return undefined;
  const trimmed = String(rawId).trim();
  if (!trimmed) return undefined;
  return `acct_${crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 12)}`;
}

/**
 * Strictly sanitizes telemetry event fields:
 * - Rejects empty/blank tenant identities, marking unscoped events explicitly as 'unbound'
 * - Clamps percentage values to [0, 100]
 * - Strips unauthorized/unknown keys
 * - Never includes tokens, headers, body payloads or PII
 */
export function sanitizeTelemetryEvent(
  raw: Partial<ConnectorTelemetryEvent>
): ConnectorTelemetryEvent {
  const currentCtx = getConnectorContext();
  const rawWs = typeof raw.workspaceId === "string" ? raw.workspaceId.trim() : "";
  const ctxWs = typeof currentCtx?.workspaceId === "string" ? currentCtx.workspaceId.trim() : "";
  const resolvedWorkspaceId = rawWs || ctxWs;

  const isTenantScoped = Boolean(resolvedWorkspaceId);
  const workspaceId = isTenantScoped ? resolvedWorkspaceId : "ws_unspecified";
  const contextStatus: TelemetryContextStatus = raw.contextStatus ?? (isTenantScoped ? "tenant_scoped" : "unbound");

  const sanitized: ConnectorTelemetryEvent = {
    schemaVersion: "1.0.0",
    eventName: "connector_telemetry",
    eventCategory: raw.eventCategory ?? "provider_request",
    provider: (raw.provider || currentCtx?.provider || "warehouse_queue") as ConnectorProvider,
    operation: String(raw.operation || "unknown_op").slice(0, 64),
    workspaceId,
    contextStatus,
    timestamp: raw.timestamp || new Date().toISOString(),
    attempt: Number.isFinite(raw.attempt) ? Math.max(1, Math.floor(raw.attempt!)) : 1,
    outcome: raw.outcome ?? "success",
    durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, Math.round(raw.durationMs!)) : 0,
  };

  if (raw.connectionId || currentCtx?.connectionId) {
    sanitized.connectionId = String(raw.connectionId || currentCtx?.connectionId);
  }

  const opaqueAcct = raw.opaqueAccountId || (currentCtx?.opaqueAccountId ? currentCtx.opaqueAccountId : undefined);
  if (opaqueAcct) {
    sanitized.opaqueAccountId = opaqueAcct;
  }

  if (raw.jobId || currentCtx?.jobId) {
    sanitized.jobId = String(raw.jobId || currentCtx?.jobId);
  }

  if (Number.isFinite(raw.maxAttempts)) {
    sanitized.maxAttempts = Math.max(1, Math.floor(raw.maxAttempts!));
  }

  if (raw.errorCategory) {
    sanitized.errorCategory = raw.errorCategory;
  }

  if (Number.isFinite(raw.httpStatus)) {
    sanitized.httpStatus = Math.floor(raw.httpStatus!);
  }

  if (Number.isFinite(raw.retryDelayMs)) {
    sanitized.retryDelayMs = Math.max(0, Math.round(raw.retryDelayMs!));
  }

  if (Number.isFinite(raw.queueWaitMs)) {
    sanitized.queueWaitMs = Math.max(0, Math.round(raw.queueWaitMs!));
  }

  if (Number.isFinite(raw.itemCount)) {
    sanitized.itemCount = Math.max(0, Math.floor(raw.itemCount!));
  }

  if (Number.isFinite(raw.completedItemCount)) {
    sanitized.completedItemCount = Math.max(0, Math.floor(raw.completedItemCount!));
  }

  const windowDays = Number.isFinite(raw.dataWindowDays) ? raw.dataWindowDays : currentCtx?.dataWindowDays;
  if (Number.isFinite(windowDays)) {
    sanitized.dataWindowDays = Math.max(0, Math.floor(windowDays!));
  }

  if (Number.isFinite(raw.throttleUtilizationPct)) {
    sanitized.throttleUtilizationPct = Math.max(0, Math.min(100, Math.round(raw.throttleUtilizationPct!)));
  }

  if (typeof raw.retryAfterSupplied === "boolean") {
    sanitized.retryAfterSupplied = raw.retryAfterSupplied;
  }

  if (typeof raw.retryAfterHonored === "boolean") {
    sanitized.retryAfterHonored = raw.retryAfterHonored;
  }

  if (raw.leaseOutcome) {
    sanitized.leaseOutcome = raw.leaseOutcome;
  }

  if (raw.freshnessOutcome) {
    sanitized.freshnessOutcome = raw.freshnessOutcome;
  }

  return sanitized;
}

export type TelemetrySink = (event: ConnectorTelemetryEvent) => void;

let globalSink: TelemetrySink | null = null;

export function setTelemetrySink(sink: TelemetrySink | null): void {
  globalSink = sink;
}

export function getTelemetrySink(): TelemetrySink | null {
  return globalSink;
}

/**
 * Default production/runtime logging sink: outputs structured JSON via logger.warn.
 * Using warn ensures Vercel runtime logs capture it in production without being suppressed.
 */
function defaultSink(event: ConnectorTelemetryEvent): void {
  logger.warn(`[CONNECTOR_TELEMETRY] ${event.provider}:${event.operation} outcome=${event.outcome}`, event);
}

/**
 * Emits a structured telemetry event safely.
 * Any errors thrown by the sink or sanitizer are caught and suppressed so business operations never fail.
 */
export function emitConnectorTelemetry(event: Partial<ConnectorTelemetryEvent>): void {
  try {
    const sanitized = sanitizeTelemetryEvent(event);
    if (globalSink) {
      globalSink(sanitized);
    } else {
      defaultSink(sanitized);
    }
  } catch {
    // Best-effort / fail-open with respect to telemetry: telemetry failure MUST NEVER crash provider sync
  }
}

/**
 * Testing helper: Captures all emitted telemetry events during a test block.
 */
export function captureTelemetryForTest(): {
  events: ConnectorTelemetryEvent[];
  restore: () => void;
} {
  const events: ConnectorTelemetryEvent[] = [];
  const previousSink = globalSink;
  setTelemetrySink((event) => {
    events.push(event);
  });
  return {
    events,
    restore: () => {
      setTelemetrySink(previousSink);
    },
  };
}
