/**
 * Shared, provider-agnostic sync outcome contract.
 *
 * `success` is deliberately reserved for a fully completed requested scope.
 * A provider may have written useful rows during a `partial` outcome, but that
 * state must never be presented as a completed sync or advance freshness.
 */
export type SyncOutcome = "success" | "partial" | "failed";

export type SyncTargetKind = "ad_account" | "customer" | "advertiser" | "connection";

export interface SyncChildResult {
  id: string;
  kind: SyncTargetKind;
  ok: boolean;
  rowsIngested?: number;
  error?: string;
  retryable?: boolean;
}

export interface SyncResult {
  /** True only if every requested provider/account target completed. */
  success: boolean;
  outcome: SyncOutcome;
  rowsIngested: number;
  error?: string;
  children: SyncChildResult[];
}

/**
 * Retry classification. Structured provider information wins (an explicit
 * `retryable` flag, or a provider error code/status); the legacy message regex
 * remains only as a fallback for unstructured errors. Auth-revoked conditions
 * are never retryable.
 */
export function isRetryableSyncError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as { retryable?: unknown; authRevoked?: unknown; code?: unknown; status?: unknown };
    if (err.authRevoked === true) return false;
    if (typeof err.retryable === "boolean") return err.retryable;
    if (err.code === 190) return false; // Meta OAuth revoked — permanent auth condition
    if (err.status === 401 || err.status === 403) return false; // structured auth/permission failure
    if (err.status === 429 || (typeof err.status === "number" && err.status >= 500)) return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(17|32|429|613|80004|5\d\d|rate[ _-]?limit|quota|throttl|resource[_ ]exhausted|temporar|timeout|timed out|econnreset|fetch failed|network)\b/i.test(message);
}

export function summarizeSyncOutcome(children: SyncChildResult[]): Pick<SyncResult, "success" | "outcome" | "rowsIngested" | "error"> {
  const rowsIngested = children.reduce((total, child) => total + (child.rowsIngested ?? 0), 0);
  const failed = children.filter((child) => !child.ok);
  const succeeded = children.length - failed.length;
  const outcome: SyncOutcome = failed.length === 0 ? "success" : succeeded > 0 ? "partial" : "failed";
  const error = failed.length
    ? failed.slice(0, 3).map((child) => `${child.id}: ${child.error ?? "sync failed"}`).join(" | ") +
      (failed.length > 3 ? ` (+${failed.length - 3} more)` : "")
    : undefined;

  return { success: outcome === "success", outcome, rowsIngested, error };
}

export function makeFailedSyncResult(error: string, retryable = isRetryableSyncError(error)): SyncResult {
  const child: SyncChildResult = { id: "connection", kind: "connection", ok: false, error, retryable };
  return { ...summarizeSyncOutcome([child]), children: [child] };
}

/** The durable worker uses this set to retry only work which has not succeeded. */
export function retryableFailedTargetIds(children: SyncChildResult[]): string[] {
  return children.filter((child) => !child.ok && child.retryable).map((child) => child.id);
}
