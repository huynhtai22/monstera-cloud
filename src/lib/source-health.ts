/** One completed day is the current connection-freshness policy. */
export const SOURCE_HEALTH_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A connection's operational state. This is deliberately derived from durable
 * connection state instead of from UI labels, so a source cannot look healthy
 * simply because it is authorized.
 */
export type SourceHealthState =
  | "fresh"
  | "stale"
  | "error"
  | "partial"
  | "stuck"
  | "syncing"
  | "pending"
  | "disconnected"
  | "unknown";

export function isPartialSyncError(lastError: string | null | undefined): boolean {
  return /^\[partial\](?:\s|$)/i.test(lastError?.trim() ?? "");
}

/**
 * Deterministic precedence (highest first):
 * disconnected → partial → error → unknown → syncing → pending → stale → fresh.
 *
 * A partial sync is stored in `lastError` for durable diagnostics, so it must
 * be recognized before generic error handling. Unknown statuses fail closed:
 * they are never represented as fresh or connected.
 */
export function resolveSourceHealthState(input: {
  connectionStatus: string | null | undefined;
  lastError: string | null | undefined;
  lastSyncAt: Date | string | null | undefined;
  isSyncing?: boolean;
  syncStartedAt?: Date | string | null;
  syncAttemptAt?: Date | string | null;
  now?: Date;
  staleBefore: Date;
}): SourceHealthState {
  const status = input.connectionStatus?.trim().toLowerCase();
  if (status === "disconnected") return "disconnected";
  const providerProcessing = /will resume this task automatically|still processing|did not complete before the bounded polling|report task.*\b(processing|queuing|running|init)\b/i.test(input.lastError ?? "");
  if (providerProcessing && (status === "connected" || status === "error")) {
    const attempted = input.syncAttemptAt ? new Date(input.syncAttemptAt).getTime() : NaN;
    if (!Number.isFinite(attempted)) return "syncing";
    return (input.now ?? new Date()).getTime() - attempted > 60 * 60 * 1000 ? "stuck" : "syncing";
  }
  if (isPartialSyncError(input.lastError)) return "partial";
  if (status === "error" || Boolean(input.lastError)) return "error";
  if (status !== "connected") return "unknown";
  if (input.isSyncing) {
    const started = input.syncStartedAt ? new Date(input.syncStartedAt).getTime() : NaN;
    if (Number.isFinite(started) && (input.now ?? new Date()).getTime() - started > 60 * 60 * 1000) return "stuck";
    return "syncing";
  }
  if (!input.lastSyncAt) return "pending";

  const lastSyncAt = input.lastSyncAt instanceof Date
    ? input.lastSyncAt
    : new Date(input.lastSyncAt);
  if (Number.isNaN(lastSyncAt.getTime())) return "unknown";
  return lastSyncAt < input.staleBefore ? "stale" : "fresh";
}

/**
 * Source health counting for the Sources page. Pending, stale, disconnected,
 * and unknown are intentionally not counted as fully connected.
 */
export interface SourceHealthCounts {
  connected: number;
  needsAttention: number;
  available: number;
  partial: number;
}

export function countSourceHealthStatuses(
  integrations: Array<{ status: string }>
): SourceHealthCounts {
  let connected = 0;
  let needsAttention = 0;
  let available = 0;
  let partial = 0;
  for (const i of integrations) {
    if (i.status === "available") available += 1;
    else if (i.status === "partial") partial += 1; // partial ≠ fully connected
    else if (["error", "stale", "disconnected", "unknown", "stuck"].includes(i.status)) needsAttention += 1;
    else if (i.status === "fresh" || i.status === "connected") connected += 1;
  }
  return { connected, needsAttention, available, partial };
}
