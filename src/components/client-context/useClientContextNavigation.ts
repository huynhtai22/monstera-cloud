"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  parseRequestedClientId,
  shouldPropagateClientContext,
  withClientContextAndFilters,
} from "@/lib/client-context";
import { switchPendingClient } from "@/lib/pending-query";

export function useClientContextNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedRaw = searchParams.get("clientId");
  const requested = useMemo(() => parseRequestedClientId(requestedRaw), [requestedRaw]);

  /**
   * Switch clients through the shared pending-aware contract. Callers that
   * own a pending-query tracker (Warehouse, Reports) pass its pending query
   * so a rapid filter edit immediately followed by a switch keeps the edit;
   * the destination is still rebuilt from the strict cross-client allowlist.
   * Returns the navigated query for tracker bookkeeping. Callers without
   * pending state omit the second argument (equivalent to settled behavior).
   */
  const switchClient = useCallback((nextClientId: string | null, pendingSearch: string | null = null) => {
    const live = typeof window !== "undefined" ? window.location.search : `?${searchParams.toString()}`;
    const { search } = switchPendingClient({ observedSearch: live, pendingSearch, nextClientId });
    router.push(search ? `${pathname}${search}` : pathname);
    return search;
  }, [pathname, router, searchParams]);

  const hrefFor = useCallback((path: string) => {
    if (!shouldPropagateClientContext(path)) return path;
    return withClientContextAndFilters(path, requestedRaw, searchParams);
  }, [requestedRaw, searchParams]);

  return { requested, requestedRaw, switchClient, hrefFor, searchParams, pathname };
}
