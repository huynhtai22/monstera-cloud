/**
 * Deterministic pending-query merge contract for canonical filter URLs.
 *
 * Browser-safe and pure: no React, no Next router, no server dependencies.
 * It exists so rapid sequential control edits (and an edit immediately
 * followed by a client switch) merge against the most recent pending query
 * instead of a stale observed snapshot, without depending on navigation
 * timing.
 *
 * Two deliberately distinct operations share one pending contract:
 *
 * - Ordinary filter edits retain the surface's current parameters and only
 *   apply the patch. They must never invent allowlist semantics of their own.
 * - Client switching rebuilds from the strict cross-client allowlist via the
 *   shared `switchClientKeepingFilters`, so unsafe account, pagination,
 *   OAuth, callback and unknown parameters can never survive a switch even
 *   when a pending edit exists.
 */

import { switchClientKeepingFilters } from "./client-context";

export type UrlPatch = Record<string, string | null | undefined>;

function toParams(search: string): URLSearchParams {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query);
}

function toSearch(params: URLSearchParams): string {
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * Apply a patch to a base query without mutating either input. Values that
 * are `null`, `undefined` or empty remove the key; all other values are
 * canonicalized to exactly one entry.
 */
export function applyUrlPatch(base: URLSearchParams, patch: UrlPatch): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next;
}

/**
 * Select the base query for the next navigation: the pending query when one
 * exists, otherwise the observed query. Returns fresh instances and never
 * mutates its inputs.
 */
export function selectPendingBase(input: {
  observedSearch: string;
  pendingSearch: string | null;
}): { params: URLSearchParams; appliedOn: "pending" | "observed" } {
  if (input.pendingSearch !== null) {
    return { params: toParams(input.pendingSearch), appliedOn: "pending" };
  }
  return { params: toParams(input.observedSearch), appliedOn: "observed" };
}

/**
 * Merge an approved filter patch against pending state. Ordinary edits retain
 * the surface's current parameters; removal is expressed with nullish/empty
 * values. The result is a fresh serialized query (with leading `?`, or empty
 * string when no parameters remain).
 */
export function mergePendingUrlState(input: {
  observedSearch: string;
  pendingSearch: string | null;
  patch: UrlPatch;
}): { search: string; appliedOn: "pending" | "observed" } {
  const { params, appliedOn } = selectPendingBase(input);
  return { search: toSearch(applyUrlPatch(params, input.patch)), appliedOn };
}

/**
 * Build a client-switch destination from pending state. The base is the
 * pending query when one exists (so a rapid edit immediately followed by a
 * switch keeps the edit), then the destination is rebuilt by the shared
 * strict cross-client rule with exactly one `clientId` value — unsafe
 * account, pagination, OAuth, callback and unknown parameters are removed
 * even when they were present in pending state.
 */
export function switchPendingClient(input: {
  observedSearch: string;
  pendingSearch: string | null;
  nextClientId: string | null | undefined;
}): { search: string; appliedOn: "pending" | "observed" } {
  const { params: base, appliedOn } = selectPendingBase(input);
  return { search: toSearch(switchClientKeepingFilters(base, input.nextClientId)), appliedOn };
}

export type PendingUrlTracker = {
  /** Last observed canonical query (serialized, with leading `?` or empty). */
  acknowledgedSearch: string;
  /** Last written query still awaiting acknowledgement, if any. */
  pendingSearch: string | null;
};

function normalizeSearch(search: string): string {
  const params = toParams(search);
  const entries = [...params.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey === bKey ? (aValue < bValue ? -1 : aValue > bValue ? 1 : 0) : aKey < bKey ? -1 : 1,
  );
  return toSearch(new URLSearchParams(entries));
}

export function createPendingUrlTracker(initialSearch: string): PendingUrlTracker {
  return { acknowledgedSearch: normalizeSearch(initialSearch), pendingSearch: null };
}

/**
 * Reconcile tracker state with a newly observed URL. A pending navigation
 * stays pending while the observed URL is still the prior URL; it clears
 * when the observed URL matches the pending URL. A genuinely different URL
 * (external history navigation) discards stale pending state so controls
 * hydrate from the externally observed URL. Comparison uses serialized query
 * strings, so recreated param objects with identical content never clear or
 * preserve state incorrectly. Returns a fresh tracker; inputs are untouched.
 */
export function acknowledgePendingUrlState(
  tracker: PendingUrlTracker,
  observedSearch: string,
): PendingUrlTracker {
  const observed = normalizeSearch(observedSearch);
  if (tracker.pendingSearch !== null && observed === normalizeSearch(tracker.pendingSearch)) {
    return { acknowledgedSearch: observed, pendingSearch: null };
  }
  if (observed !== tracker.acknowledgedSearch) {
    return { acknowledgedSearch: observed, pendingSearch: null };
  }
  return { ...tracker };
}
