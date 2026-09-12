"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  parseRequestedClientId,
  shouldPropagateClientContext,
} from "@/lib/client-context";
import { clientContextHrefWithPending, switchPendingClient } from "@/lib/pending-query";
import { usePendingNavigation } from "./PendingNavigationProvider";

export function useClientContextNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pending = usePendingNavigation();
  const requestedRaw = searchParams.get("clientId");
  const requested = useMemo(() => parseRequestedClientId(requestedRaw), [requestedRaw]);
  const observedSearchString = searchParams.toString();

  // Acknowledge on observed change for every surface this hook is mounted on.
  // The bar is mounted across the app, so surfaces without page-level effects
  // (e.g. Sources) still reconcile.
  useEffect(() => {
    if (pathname) pending.acknowledge(pathname, `?${observedSearchString}`);
  }, [pathname, observedSearchString, pending]);

  /**
   * Switch clients through the shared pending-aware contract: the base is the
   * surface's pending query when one is unacknowledged (so a rapid filter
   * edit immediately followed by a switch keeps the edit), then the
   * destination is rebuilt from the strict cross-client allowlist with
   * exactly one `clientId`. Returns the navigated query for bookkeeping.
   */
  const switchClient = useCallback((nextClientId: string | null) => {
    const currentPath = pathname ?? "";
    const live = typeof window !== "undefined" ? window.location.search : `?${observedSearchString}`;
    const { search } = switchPendingClient({
      observedSearch: live,
      pendingSearch: currentPath ? pending.pendingFor(currentPath) : null,
      nextClientId,
    });
    if (currentPath) pending.stage(currentPath, live, search);
    router.push(currentPath && search ? `${currentPath}${search}` : currentPath || search || "/");
    return search;
  }, [pathname, router, observedSearchString, pending]);

  /**
   * Build a link href for another surface. `targetClientId` lets a CTA request a
   * defined client scope (for example the canonical All Clients sentinel); when
   * omitted the operator's current scope is preserved. Both paths go through the
   * shared contract, so unsafe parameters are still dropped.
   */
  const hrefFor = useCallback((path: string, targetClientId?: string | null) => {
    if (!shouldPropagateClientContext(path)) return path;
    const currentPath = pathname ?? "";
    const live = `?${observedSearchString}`;
    return clientContextHrefWithPending({
      href: path,
      observedSearch: live,
      pendingSearch: currentPath ? pending.pendingFor(currentPath) : null,
      requestedClientId: requestedRaw,
      targetClientId,
    });
  }, [requestedRaw, observedSearchString, pathname, pending]);

  return { requested, requestedRaw, switchClient, hrefFor, searchParams, pathname };
}
