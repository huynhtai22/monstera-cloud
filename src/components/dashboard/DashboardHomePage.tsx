"use client";

import React, { useState, useCallback } from "react";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { useResolvedWorkspaceId } from "@/hooks/use-resolved-workspace-id";
import { DashboardHandoff } from "./DashboardHandoff";
import { useWorkspaceStartupActions } from "../WorkspaceStartup";
import { PageShell } from "@/components/ui/PageShell";
import { FixConnectionModal } from "@/components/FixConnectionModal";
import { ConsoleSyncLabel } from "./ConsoleSyncLabel";
import { ConsoleOverview } from "./ConsoleOverview";
import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";
import { trackOnce } from "@/lib/analytics-events";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch dashboard data");
  return data;
};

export function DashboardHomePage() {
  const { workspaceId, workspaces, isLoading: workspaceLoading, error: workspaceError, mutate: retryWorkspaces } = useResolvedWorkspaceId();
  const startup = useWorkspaceStartupActions();
  const completeDashboard = startup?.completeDashboard;
  const completeWorkspace = startup?.completeWorkspace;
  React.useEffect(() => {
    if (workspaceLoading || !workspaceId) return;
    const selected = Array.isArray(workspaces) ? workspaces.find((w: { id: string }) => w.id === workspaceId) : undefined;
    const providers = Array.isArray(selected?.sources)
      ? selected.sources.filter((s: { provider?: unknown }) => typeof s.provider === "string").map((s: { provider: string }) => s.provider)
      : undefined;
    completeWorkspace?.(providers);
  }, [workspaceLoading, workspaceId, workspaces, completeWorkspace]);
  const [fixTarget, setFixTarget] = useState<{
    id: string;
    name: string;
    provider: string;
    catalogId: string;
    status: string;
    errorMsg?: string;
    lastSync?: string;
  } | null>(null);

  const {
    data: receivedOverview,
    error,
    isLoading: dataLoading,
    isValidating,
    mutate,
  } = useSWR<DashboardOverviewDTO>(
    workspaceId ? `/api/dashboard/summary?workspaceId=${workspaceId}` : null,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true },
  );
  // Allow the initial dashboard render to yield to the loader's compositor motion.
  // Readiness follows the committed destination, rather than the network callback.
  const deferredOverview = React.useDeferredValue(receivedOverview);
  const overview = deferredOverview?.workspace.id === workspaceId ? deferredOverview : undefined;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [manualRefreshFailed, setManualRefreshFailed] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const performancePanelRef = React.useRef<HTMLDivElement | null>(null);
  const reviewRecordingRef = React.useRef(false);
  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await mutate();
      setManualRefreshFailed(false);
    } catch {
      setManualRefreshFailed(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [mutate]);

  React.useEffect(() => {
    if (!isValidating && !error && overview) setManualRefreshFailed(false);
  }, [error, isValidating, overview]);

  React.useEffect(() => {
    if (!workspaceId || !overview) return;
    try {
      setWizardDismissed(
        localStorage.getItem(
          `monstera_setup_wizard_dismissed_${workspaceId}`,
        ) === "1",
      );
    } catch {
      /* storage blocked — wizard stays visible */
    }
  }, [overview, workspaceId]);

  const handleWizardDismiss = useCallback(() => {
    setWizardDismissed(true);
    if (!workspaceId) return;
    try {
      localStorage.setItem(
        `monstera_setup_wizard_dismissed_${workspaceId}`,
        "1",
      );
    } catch {
      /* ignore */
    }
  }, [workspaceId]);

  React.useEffect(() => {
    reviewRecordingRef.current = false;
  }, [workspaceId]);

  React.useEffect(() => {
    if (!workspaceId || overview?.pilotActivation.status !== "ready_to_review")
      return;
    const panel = performancePanelRef.current;
    if (!panel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          !entry?.isIntersecting ||
          entry.intersectionRatio < 0.5 ||
          reviewRecordingRef.current
        )
          return;
        reviewRecordingRef.current = true;
        void fetch(`/api/workspaces/${workspaceId}/activation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "dashboard_reviewed" }),
        })
          .then(async (response) => {
            if (!response.ok)
              throw new Error("Could not record dashboard review");
            trackOnce(
              `monstera_activation_dashboard_reviewed_${workspaceId}`,
              "pilot_activation_completed",
              { workspaceId },
            );
            await mutate();
          })
          .catch(() => {
            reviewRecordingRef.current = false;
          });
      },
      { threshold: 0.5 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [mutate, overview?.pilotActivation.status, workspaceId]);

  const isLoading = workspaceLoading || (!overview && !error && Boolean(workspaceId)) || (dataLoading && !overview);
  const settled = !workspaceLoading && (Boolean(workspaceError) || !workspaceId || Boolean(overview) || Boolean(error));
  React.useEffect(() => { if (settled) completeDashboard?.(Boolean(overview), overview?.sourcesList.map(source => source.provider)); }, [settled, overview, completeDashboard]);
  const isUpdating = isRefreshing || isValidating;

  // ── Loading Skeleton ────────────────────────────────────────────────────────
  if (isLoading) {
    return <DashboardHandoff ready={false}>{null}</DashboardHandoff>;
  }

  // ── Error State ─────────────────────────────────────────────────────────────
  if ((error || workspaceError) && !overview) {
    return (
      <PageShell>
        <div className="rounded-lg border border-line bg-panel p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
          <h3 className="mt-2 text-sm font-semibold text-ink">
            Dashboard temporarily unavailable
          </h3>
          <p className="mt-1 text-xs text-ink-mute">
            Your connected sources and warehouse data are safe. We couldn't load
            the operational summary.
          </p>
          <button
            type="button"
            onClick={() => workspaceError ? retryWorkspaces() : mutate()}
            disabled={isValidating}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-wait disabled:opacity-50"
          >
            <ConsoleSyncLabel
              active={isValidating}
              idleLabel="Retry"
              activeLabel="Retrying…"
            />
          </button>
        </div>
      </PageShell>
    );
  }

  if (!workspaceId && !workspaceLoading) return <PageShell><h1 className="text-xl">Create your workspace</h1><p className="mt-2 text-ink-mute">Choose a workspace to start connecting sources and reporting.</p><a href="/settings" className="mt-4 inline-block underline">Open workspace settings</a></PageShell>;
  if (!overview) return <DashboardHandoff ready={false}>{null}</DashboardHandoff>;

  return (
    <DashboardHandoff ready>
      <ConsoleOverview
        overview={overview}
        isUpdating={isUpdating}
        showRefreshWarning={Boolean(error || manualRefreshFailed)}
        onRefresh={handleManualRefresh}
        wizardDismissed={wizardDismissed}
        onWizardDismiss={handleWizardDismiss}
        onWizardResume={() => {
          setWizardDismissed(false);
          if (workspaceId) {
            try {
              localStorage.removeItem(
                `monstera_setup_wizard_dismissed_${workspaceId}`,
              );
            } catch {
              /* storage blocked */
            }
          }
        }}
        performancePanelRef={performancePanelRef}
        onReconnect={(issue) => {
          const source = overview.sourcesList.find(
            (item) => item.id === issue.connectionId,
          );
          setFixTarget({
            id: issue.connectionId!,
            name: source?.name || "Source",
            provider: issue.provider || source?.provider || "meta_ads",
            catalogId: issue.provider || source?.provider || "meta_ads",
            status: "error",
            errorMsg: issue.explanation,
          });
        }}
      />
      {fixTarget && (
        <FixConnectionModal
          isOpen={Boolean(fixTarget)}
          onClose={() => setFixTarget(null)}
          connection={fixTarget}
          onReconnected={() => {
            void mutate();
          }}
        />
      )}
    </DashboardHandoff>
  );
}
