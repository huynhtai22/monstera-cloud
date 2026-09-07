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
  contextStatus: TelemetryContextStatus;
  workspaceId?: string;
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

const VALID_EVENT_CATEGORIES = new Set<ConnectorEventCategory>([
  "provider_request",
  "job_lifecycle",
  "lease_event",
  "freshness_event",
]);

const VALID_PROVIDERS = new Set<ConnectorProvider>([
  "meta_ads",
  "google_ads",
  "tiktok_business",
  "shopee",
  "lazada",
  "warehouse_queue",
]);

const VALID_OUTCOMES = new Set<TelemetryOutcome>([
  "success",
  "partial",
  "retryable_failure",
  "permanent_failure",
  "throttled",
  "lease_lost",
  "skipped",
]);

const VALID_ERROR_CATEGORIES = new Set<TelemetryErrorCategory>([
  "auth_revoked",
  "rate_limited",
  "provider_unavailable",
  "quota_exhausted",
  "timeout",
  "network_error",
  "schema_drift",
  "lease_lost",
  "internal_error",
]);

const VALID_LEASE_OUTCOMES = new Set<LeaseOutcome>([
  "acquired",
  "refused_active",
  "refused_contention",
  "renewed",
  "stolen",
  "released",
  "lost",
]);

const VALID_FRESHNESS_OUTCOMES = new Set<FreshnessOutcome>([
  "advanced",
  "unchanged",
  "degraded",
]);

export const RESERVED_UNSPECIFIED_SENTINELS = new Set<string>([
  "ws_unspecified",
  "unknown_workspace",
  "ws_opaque_unspecified",
  "ws_opaque_e3b0c442",
]);

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_.-]{1,128}$/;
const OPERATION_REGEX = /^[a-zA-Z0-9_.-]{1,64}$/;
const OPAQUE_ACCOUNT_REGEX = /^acct_[0-9a-f]{12}$/;

/**
 * Strictly sanitizes and validates telemetry event fields from unknown input:
 * - Constructs a new object from an explicit allowlist; never spreads arbitrary caller objects
 * - Derives contextStatus internally; never trusts caller-supplied contextStatus
 * - Validates enums, finite numbers, ranges and string shapes
 * - Rejects prototype pollution, tokens, secrets, bodies, and invalid types
 * - Drops invalid events safely (returns null) without throwing
 */
export function sanitizeTelemetryEvent(input: unknown): ConnectorTelemetryEvent | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return null;
    }
    const raw = input as Record<string, unknown>;

    // Reject prototype pollution or objects with non-standard prototype
    const proto = Object.getPrototypeOf(raw);
    if (proto !== Object.prototype && proto !== null) {
      return null;
    }

  // Operation validation
  let operation = "unknown_op";
  if (raw.operation !== undefined) {
    if (typeof raw.operation !== "string") {
      return null;
    }
    const trimmedOp = raw.operation.trim();
    if (!OPERATION_REGEX.test(trimmedOp)) {
      return null;
    }
    operation = trimmedOp;
  }

  // Schema version & event name (exact values only)
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== "1.0.0") {
    return null;
  }
  if (raw.eventName !== undefined && raw.eventName !== "connector_telemetry") {
    return null;
  }

  // Event category
  let eventCategory: ConnectorEventCategory = "provider_request";
  if (raw.eventCategory !== undefined) {
    if (typeof raw.eventCategory !== "string" || !VALID_EVENT_CATEGORIES.has(raw.eventCategory as ConnectorEventCategory)) {
      return null;
    }
    eventCategory = raw.eventCategory as ConnectorEventCategory;
  }

  // Provider
  const currentCtx = getConnectorContext();
  let provider: ConnectorProvider | undefined = undefined;
  if (typeof raw.provider === "string" && VALID_PROVIDERS.has(raw.provider as ConnectorProvider)) {
    provider = raw.provider as ConnectorProvider;
  } else if (raw.provider === undefined && currentCtx?.provider && VALID_PROVIDERS.has(currentCtx.provider)) {
    provider = currentCtx.provider;
  } else if (raw.provider === undefined) {
    provider = "warehouse_queue";
  } else {
    return null;
  }

  // Context derivation & workspace identity
  const ctxWs = currentCtx?.workspaceId && typeof currentCtx.workspaceId === "string"
    ? currentCtx.workspaceId.trim()
    : undefined;

  let workspaceId: string | undefined = undefined;
  let contextStatus: TelemetryContextStatus = "unbound";

  if (Object.prototype.hasOwnProperty.call(raw, "workspaceId")) {
    const rawWs = raw.workspaceId;
    if (typeof rawWs !== "string") {
      // Explicit non-string workspace -> reject event
      return null;
    }
    const trimmedWs = rawWs.trim();
    if (trimmedWs === "" || !IDENTIFIER_REGEX.test(trimmedWs) || RESERVED_UNSPECIFIED_SENTINELS.has(trimmedWs)) {
      // Explicitly blank, invalid or reserved sentinel -> reject event; do NOT fall back to context
      return null;
    }
    if (ctxWs && trimmedWs !== ctxWs) {
      // Explicit workspace conflicts with enclosing context -> fail closed for that event
      return null;
    }
    workspaceId = trimmedWs;
    contextStatus = "tenant_scoped";
  } else {
    // Workspace field omitted from input: may inherit valid enclosing context
    if (ctxWs && IDENTIFIER_REGEX.test(ctxWs) && !RESERVED_UNSPECIFIED_SENTINELS.has(ctxWs)) {
      workspaceId = ctxWs;
      contextStatus = "tenant_scoped";
    } else {
      // No explicit or contextual workspace -> cleanly unbound, workspaceId omitted
      contextStatus = "unbound";
      workspaceId = undefined;
    }
  }

  // Outcome
  let outcome: TelemetryOutcome = "success";
  if (raw.outcome !== undefined) {
    if (typeof raw.outcome !== "string" || !VALID_OUTCOMES.has(raw.outcome as TelemetryOutcome)) {
      return null;
    }
    outcome = raw.outcome as TelemetryOutcome;
  }

  // Attempt & maxAttempts
  let attempt = 1;
  if (raw.attempt !== undefined) {
    if (typeof raw.attempt !== "number" || !Number.isInteger(raw.attempt) || raw.attempt < 1 || raw.attempt > 100) {
      return null;
    }
    attempt = raw.attempt;
  }

  let maxAttempts: number | undefined = undefined;
  if (raw.maxAttempts !== undefined) {
    if (typeof raw.maxAttempts !== "number" || !Number.isInteger(raw.maxAttempts) || raw.maxAttempts < attempt || raw.maxAttempts > 100) {
      return null;
    }
    maxAttempts = raw.maxAttempts;
  }

  // Duration
  let durationMs = 0;
  if (raw.durationMs !== undefined) {
    if (typeof raw.durationMs !== "number" || !Number.isFinite(raw.durationMs) || raw.durationMs < 0 || raw.durationMs > 86_400_000) {
      return null;
    }
    durationMs = Math.round(raw.durationMs);
  }

  // Timestamp
  let timestamp: string;
  if (raw.timestamp !== undefined) {
    if (typeof raw.timestamp !== "string") return null;
    const parsed = Date.parse(raw.timestamp);
    if (!Number.isFinite(parsed)) return null;
    const year = new Date(parsed).getUTCFullYear();
    if (year < 2020 || year > 2035) return null;
    timestamp = new Date(parsed).toISOString();
  } else {
    timestamp = new Date().toISOString();
  }

  // Optional connectionId & jobId
  let connectionId: string | undefined = undefined;
  const rawConnId = raw.connectionId ?? currentCtx?.connectionId;
  if (rawConnId !== undefined) {
    if (typeof rawConnId !== "string") return null;
    const trimmed = rawConnId.trim();
    if (!IDENTIFIER_REGEX.test(trimmed)) return null;
    connectionId = trimmed;
  }

  let jobId: string | undefined = undefined;
  const rawJobId = raw.jobId ?? currentCtx?.jobId;
  if (rawJobId !== undefined) {
    if (typeof rawJobId !== "string") return null;
    const trimmed = rawJobId.trim();
    if (!IDENTIFIER_REGEX.test(trimmed)) return null;
    jobId = trimmed;
  }

  // Optional opaqueAccountId
  let opaqueAccountId: string | undefined = undefined;
  const rawOpaque = raw.opaqueAccountId ?? currentCtx?.opaqueAccountId;
  if (rawOpaque !== undefined) {
    if (typeof rawOpaque !== "string") return null;
    const trimmed = rawOpaque.trim();
    if (!OPAQUE_ACCOUNT_REGEX.test(trimmed)) return null;
    opaqueAccountId = trimmed;
  }

  // Optional errorCategory
  let errorCategory: TelemetryErrorCategory | undefined = undefined;
  if (raw.errorCategory !== undefined) {
    if (typeof raw.errorCategory !== "string" || !VALID_ERROR_CATEGORIES.has(raw.errorCategory as TelemetryErrorCategory)) {
      return null;
    }
    errorCategory = raw.errorCategory as TelemetryErrorCategory;
  }

  // Optional httpStatus
  let httpStatus: number | undefined = undefined;
  if (raw.httpStatus !== undefined) {
    if (typeof raw.httpStatus !== "number" || !Number.isInteger(raw.httpStatus) || raw.httpStatus < 100 || raw.httpStatus > 599) {
      return null;
    }
    httpStatus = raw.httpStatus;
  }

  // Optional delays and wait times
  let retryDelayMs: number | undefined = undefined;
  if (raw.retryDelayMs !== undefined) {
    if (typeof raw.retryDelayMs !== "number" || !Number.isFinite(raw.retryDelayMs) || raw.retryDelayMs < 0 || raw.retryDelayMs > 86_400_000) {
      return null;
    }
    retryDelayMs = Math.round(raw.retryDelayMs);
  }

  let queueWaitMs: number | undefined = undefined;
  if (raw.queueWaitMs !== undefined) {
    if (typeof raw.queueWaitMs !== "number" || !Number.isFinite(raw.queueWaitMs) || raw.queueWaitMs < 0 || raw.queueWaitMs > 86_400_000) {
      return null;
    }
    queueWaitMs = Math.round(raw.queueWaitMs);
  }

  // Optional item counts
  let itemCount: number | undefined = undefined;
  if (raw.itemCount !== undefined) {
    if (typeof raw.itemCount !== "number" || !Number.isInteger(raw.itemCount) || raw.itemCount < 0 || raw.itemCount > 1_000_000) {
      return null;
    }
    itemCount = raw.itemCount;
  }

  let completedItemCount: number | undefined = undefined;
  if (raw.completedItemCount !== undefined) {
    if (typeof raw.completedItemCount !== "number" || !Number.isInteger(raw.completedItemCount) || raw.completedItemCount < 0 || raw.completedItemCount > 1_000_000) {
      return null;
    }
    completedItemCount = raw.completedItemCount;
  }

  // Optional window days
  let dataWindowDays: number | undefined = undefined;
  const rawWindow = raw.dataWindowDays !== undefined ? raw.dataWindowDays : currentCtx?.dataWindowDays;
  if (rawWindow !== undefined) {
    if (typeof rawWindow !== "number" || !Number.isInteger(rawWindow) || rawWindow < 0 || rawWindow > 3650) {
      return null;
    }
    dataWindowDays = rawWindow;
  }

  // Optional throttle utilization percentage
  let throttleUtilizationPct: number | undefined = undefined;
  if (raw.throttleUtilizationPct !== undefined) {
    if (typeof raw.throttleUtilizationPct !== "number" || !Number.isFinite(raw.throttleUtilizationPct)) {
      return null;
    }
    throttleUtilizationPct = Math.max(0, Math.min(100, Math.round(raw.throttleUtilizationPct)));
  }

  // Optional booleans
  let retryAfterSupplied: boolean | undefined = undefined;
  if (raw.retryAfterSupplied !== undefined) {
    if (typeof raw.retryAfterSupplied !== "boolean") return null;
    retryAfterSupplied = raw.retryAfterSupplied;
  }

  let retryAfterHonored: boolean | undefined = undefined;
  if (raw.retryAfterHonored !== undefined) {
    if (typeof raw.retryAfterHonored !== "boolean") return null;
    retryAfterHonored = raw.retryAfterHonored;
  }

  // Optional lease outcome
  let leaseOutcome: LeaseOutcome | undefined = undefined;
  if (raw.leaseOutcome !== undefined) {
    if (typeof raw.leaseOutcome !== "string" || !VALID_LEASE_OUTCOMES.has(raw.leaseOutcome as LeaseOutcome)) {
      return null;
    }
    leaseOutcome = raw.leaseOutcome as LeaseOutcome;
  }

  // Optional freshness outcome
  let freshnessOutcome: FreshnessOutcome | undefined = undefined;
  if (raw.freshnessOutcome !== undefined) {
    if (typeof raw.freshnessOutcome !== "string" || !VALID_FRESHNESS_OUTCOMES.has(raw.freshnessOutcome as FreshnessOutcome)) {
      return null;
    }
    freshnessOutcome = raw.freshnessOutcome as FreshnessOutcome;
  }

  // Build clean object with zero extra keys
  const event: ConnectorTelemetryEvent = {
    schemaVersion: "1.0.0",
    eventName: "connector_telemetry",
    eventCategory,
    provider,
    operation,
    contextStatus,
    attempt,
    outcome,
    durationMs,
    timestamp,
  };

  if (workspaceId !== undefined) event.workspaceId = workspaceId;
  if (connectionId !== undefined) event.connectionId = connectionId;
  if (opaqueAccountId !== undefined) event.opaqueAccountId = opaqueAccountId;
  if (jobId !== undefined) event.jobId = jobId;
  if (maxAttempts !== undefined) event.maxAttempts = maxAttempts;
  if (errorCategory !== undefined) event.errorCategory = errorCategory;
  if (httpStatus !== undefined) event.httpStatus = httpStatus;
  if (retryDelayMs !== undefined) event.retryDelayMs = retryDelayMs;
  if (queueWaitMs !== undefined) event.queueWaitMs = queueWaitMs;
  if (itemCount !== undefined) event.itemCount = itemCount;
  if (completedItemCount !== undefined) event.completedItemCount = completedItemCount;
  if (dataWindowDays !== undefined) event.dataWindowDays = dataWindowDays;
  if (throttleUtilizationPct !== undefined) event.throttleUtilizationPct = throttleUtilizationPct;
  if (retryAfterSupplied !== undefined) event.retryAfterSupplied = retryAfterSupplied;
  if (retryAfterHonored !== undefined) event.retryAfterHonored = retryAfterHonored;
  if (leaseOutcome !== undefined) event.leaseOutcome = leaseOutcome;
  if (freshnessOutcome !== undefined) event.freshnessOutcome = freshnessOutcome;

  return event;
  } catch {
    return null;
  }
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
 * Any errors thrown by the sink or parser are caught and suppressed so business operations never fail.
 */
export function emitConnectorTelemetry(event: unknown): void {
  try {
    const sanitized = sanitizeTelemetryEvent(event);
    if (!sanitized) {
      return; // Safely dropped invalid/malformed telemetry; never throws or crashes caller
    }
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
