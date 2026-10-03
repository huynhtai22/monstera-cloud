"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useWorkspaceStore } from "@/store/workspace";
import {
  createPendingNavigationStore,
  type PendingNavigationStore,
} from "@/lib/pending-navigation-store";

const PendingNavigationContext = createContext<PendingNavigationStore | null>(null);

/**
 * Owns the single pending-navigation store for a mounted application tree.
 * Mounted at the authenticated app-layout boundary so page controls, the
 * global context bar and sidebar links observe the same pending state.
 *
 * Isolation is structural, not conventional:
 * - State lives in this instance (refs/state), never in module scope, so SSR
 *   requests, tests, hot reloads and sibling mounted roots cannot share it.
 * - Entries are keyed by pathname: Warehouse state can never affect Reports.
 * - A workspace/session change resets the store, so state cannot cross
 *   workspaces or authentication sessions.
 * - Route transitions prune every non-current surface.
 * All effects are idempotent, so React Strict Mode mount cycles are safe.
 */
export function PendingNavigationProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createPendingNavigationStore());
  const pathname = usePathname();
  const { data: session } = useSession();
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const userId = session?.user?.id ?? "";
  const scopeKey = `${userId}|${workspaceId ?? ""}`;

  useEffect(() => {
    store.reset();
  }, [store, scopeKey]);

  useEffect(() => {
    if (pathname) store.pruneExcept(pathname);
  }, [store, pathname]);

  const value = useMemo(() => store, [store]);
  return (
    <PendingNavigationContext.Provider value={value}>
      {children}
    </PendingNavigationContext.Provider>
  );
}

/**
 * Shared-or-local store access. Inside the provider every consumer on the
 * surface observes the same instance; outside one (edge usage, isolated
 * tests) each caller gets a private instance with identical behavior.
 * Subscribes, so global controls/sidebar rerender when staged destinations
 * change.
 */
export function usePendingNavigation(): PendingNavigationStore {
  const fromProvider = useContext(PendingNavigationContext);
  const [local] = useState(() => createPendingNavigationStore());
  const store = fromProvider ?? local;
  const [, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion((version) => version + 1)), [store]);
  return store;
}
