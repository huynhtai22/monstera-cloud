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
  /** Account intentionally not attempted (quarantined / reconnect required). */
  skipped?: string;
}

export interface SyncResult {
  /** True only if every requested provider/account target completed. */
  success: boolean;
  outcome: SyncOutcome;
  rowsIngested: number;
  error?: string;
  children: SyncChildResult[];
}

export function isRetryableSyncError(error: unknown): boolean {
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
