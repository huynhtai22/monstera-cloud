"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  canonicalHref,
  parseRequestedClientId,
  shouldPropagateClientContext,
  switchClientKeepingFilters,
  withClientContextAndFilters,
} from "@/lib/client-context";

export function useClientContextNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedRaw = searchParams.get("clientId");
  const requested = useMemo(() => parseRequestedClientId(requestedRaw), [requestedRaw]);

  const switchClient = useCallback((nextClientId: string | null) => {
    const next = switchClientKeepingFilters(new URLSearchParams(searchParams.toString()), nextClientId);
    router.push(canonicalHref(pathname, next));
  }, [pathname, router, searchParams]);

  const hrefFor = useCallback((path: string) => {
    if (!shouldPropagateClientContext(path)) return path;
    return withClientContextAndFilters(path, requestedRaw, searchParams);
  }, [requestedRaw, searchParams]);

  return { requested, requestedRaw, switchClient, hrefFor, searchParams, pathname };
}
