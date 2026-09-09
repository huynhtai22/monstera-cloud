/**
 * Framework-free pending-navigation store.
 *
 * Holds one {@link PendingUrlTracker} per pathname so every navigation entry
 * point on a surface — page controls, the global context bar, sidebar links —
 * observes the same pending state. All transition logic delegates to the pure
 * helpers in `pending-query.ts`; this module only owns lifecycle:
 * per-pathname scoping, change notification, unmount/transition cleanup and
 * scope resets. No React, no router, no module-level mutable state: each
 * `createPendingNavigationStore()` call returns an isolated instance, so SSR
 * requests, tests, hot reloads and multiple mounted roots can never share
 * one user's pending query.
 */

import {
  acknowledgePendingUrlState,
  createPendingUrlTracker,
  type PendingUrlTracker,
} from "./pending-query";

export type PendingNavigationStore = {
  /** Record a just-issued navigation; synchronously visible to later reads. */
  stage(pathname: string, observedSearch: string, nextSearch: string): void;
  /** Reconcile with a newly observed URL (mount, commit, history). */
  acknowledge(pathname: string, observedSearch: string): void;
  /** Drop a surface's state (unmount hygiene). */
  clear(pathname: string): void;
  /** Drop every surface (workspace/session/app-root change). */
  reset(): void;
  /** Drop every surface except the current one (route transition). */
  pruneExcept(pathname: string): void;
  /** Effective base query: pending when unacknowledged, else observed. */
  getBase(pathname: string, observedSearch: string): string;
  /** Raw pending query for a surface, if any. */
  pendingFor(pathname: string): string | null;
  /** Fresh shallow copy for inspection; mutating it affects nothing. */
  snapshot(): ReadonlyMap<string, PendingUrlTracker>;
  /** Change subscription; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

export function createPendingNavigationStore(): PendingNavigationStore {
  const entries = new Map<string, PendingUrlTracker>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of Array.from(listeners)) listener();
  };

  const replace = (pathname: string, tracker: PendingUrlTracker) => {
    const prev = entries.get(pathname);
    if (
      prev
      && prev.acknowledgedSearch === tracker.acknowledgedSearch
      && prev.pendingSearch === tracker.pendingSearch
    ) {
      return;
    }
    entries.set(pathname, tracker);
    notify();
  };

  return {
    stage(pathname, observedSearch, nextSearch) {
      const prev = entries.get(pathname) ?? createPendingUrlTracker(observedSearch);
      replace(pathname, { ...prev, pendingSearch: nextSearch });
    },
    acknowledge(pathname, observedSearch) {
      const prev = entries.get(pathname);
      replace(
        pathname,
        prev
          ? acknowledgePendingUrlState(prev, observedSearch)
          : createPendingUrlTracker(observedSearch),
      );
    },
    clear(pathname) {
      if (entries.delete(pathname)) notify();
    },
    reset() {
      if (entries.size > 0) {
        entries.clear();
        notify();
      }
    },
    pruneExcept(pathname) {
      let removed = false;
      for (const key of Array.from(entries.keys())) {
        if (key !== pathname) {
          entries.delete(key);
          removed = true;
        }
      }
      if (removed) notify();
    },
    getBase(pathname, observedSearch) {
      return entries.get(pathname)?.pendingSearch ?? observedSearch;
    },
    pendingFor(pathname) {
      return entries.get(pathname)?.pendingSearch ?? null;
    },
    snapshot() {
      return new Map(entries);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
