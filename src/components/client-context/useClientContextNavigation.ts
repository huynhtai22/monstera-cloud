"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  parseRequestedClientId,
  shouldPropagateClientContext,
  withClientContextAndFilters,
} from "@/lib/client-context";
import { switchPendingClient } from "@/lib/pending-query";
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

  const hrefFor = useCallback((path: string) => {
    if (!shouldPropagateClientContext(path)) return path;
    const currentPath = pathname ?? "";
    const live = `?${observedSearchString}`;
    const effective = currentPath
      ? pending.getBase(currentPath, live)
      : live;
    return withClientContextAndFilters(path, requestedRaw, new URLSearchParams(effective));
  }, [requestedRaw, observedSearchString, pathname, pending]);

  return { requested, requestedRaw, switchClient, hrefFor, searchParams, pathname };
}
