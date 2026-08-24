/**
 * Operational-truthfulness helpers for warehouse UI.
 *
 * `dataThrough` must always be the latest ACTUAL warehouse metric date
 * (MAX(campaignMetric.date) for the workspace) — never the selected
 * date-range end, which is only a request bound.
 */

export type WarehouseEmptyState = "no-data" | "filter-empty" | "not-empty";

/**
 * Resolve the displayed "Data through" date.
 * Returns the real latest data date; if the warehouse has no rows at all,
 * returns null (callers must not fabricate a date from the filter range).
 */
export function resolveDataThrough(
  latestDataDate?: string | null
): string | null {
  if (!latestDataDate) return null;
  return latestDataDate;
}

/**
 * Distinguish "the workspace has never synced any warehouse data" from
 * "data exists, but the current filters matched nothing".
 *
 * `latestDataDate` is the workspace-wide MAX(metric date) — non-null means
 * real warehouse data exists somewhere in the workspace.
 */
export function resolveWarehouseEmptyState(
  visibleRowCount: number,
  latestDataDate?: string | null
): WarehouseEmptyState {
  if (visibleRowCount > 0) return "not-empty";
  return latestDataDate ? "filter-empty" : "no-data";
}
