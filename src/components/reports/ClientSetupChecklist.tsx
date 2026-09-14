"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { ReportingConfiguration } from "./ReportingConfiguration";
import {
  SETUP_SECTION_ANCHOR,
  SETUP_STATE_LABELS,
  clientSetupHref,
  deriveClientSetupState,
  isSetupFocusFragment,
  providerLabel,
  readinessRequestKey,
  type ClientSetupState,
  type DiscoveryStatus,
  type SetupRole,
  type SetupSectionState,
  type SetupStepState,
} from "@/lib/client-setup-checklist";
import { withClientContext } from "@/lib/client-context";
import type { ReportReadinessEvaluation } from "@/lib/report-readiness";

const DOT: Record<SetupStepState, string> = {
  complete: "bg-emerald-500",
  "needs-attention": "bg-amber-500",
  "action-required": "bg-red-500",
  "waiting-for-admin": "bg-sky-500",
  optional: "bg-zinc-400",
  "not-available": "bg-zinc-400",
};

type ConfigurationResponse = {
  canEdit: boolean;
  role?: SetupRole;
  requiredProviders: string[];
  requiredDestinations: string[];
  requirementsConfiguredAt: string | null;
  accounts: Array<{ connectionId: string; accountId: string; context: null | { overrideAt?: string | null } }>;
};

type DiscoveredResponse = {
  accounts: Array<{
    provider: string;
    accountId: string;
    assignedClient: { id: string; name: string } | null;
    authoritativeConnectionId: string | null;
    availableConnections: Array<{ id: string }>;
  }>;
};

async function jsonFetcher(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Setup data unavailable");
  return res.json();
}

function StateBadge({ state, scope }: { state: SetupStepState; scope: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT[state]}`} />
      {SETUP_STATE_LABELS[state]}
      <span className="sr-only">{` for ${scope}`}</span>
    </span>
  );
}

function SectionItem({ section, scope, showLinks }: { section: SetupSectionState; scope: string; showLinks: boolean }) {
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-ink">{section.title}</h4>
        <StateBadge state={section.state} scope={`${section.title} for ${scope}`} />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-mute">{section.summary}</p>
      {section.recovery && showLinks ? (
        <a className="mt-2 inline-block text-xs font-medium text-ink underline" href={section.recovery.href}>
          {section.recovery.label}
        </a>
      ) : null}
    </li>
  );
}

/**
 * Presentational guided checklist. Pure render from derived state: performs
 * no fetching and triggers no approval, delivery or synchronization.
 */
export function ClientSetupChecklist({ state, onConfigurationSaved }: { state: ClientSetupState; onConfigurationSaved?: () => void }) {
  const scope = `${state.clientName}`;
  const showLinks = state.role !== "viewer";
  const unsupportedLabels = state.unsupportedRequiredProviders.map(providerLabel);
  const overallState: SetupStepState = state.generationBlocked
    ? (state.canEdit ? "action-required" : "waiting-for-admin")
    : unsupportedLabels.length > 0 ? "needs-attention" : "complete";
  const sectionRef = useRef<HTMLElement>(null);
  // Move keyboard and assistive-technology focus to the checklist only when
  // the checklist was the explicit recovery target. Mount-only: saves,
  // revalidation and fragment-less visits never steal focus, and a remount
  // always represents the currently selected client.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isSetupFocusFragment(window.location.hash)) return;
    const frame = requestAnimationFrame(() => {
      sectionRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const ordered = [
    state.sections.requirements,
    state.sections.accounts,
    state.sections.data,
    state.sections.context,
    state.sections.readiness,
    state.sections.delivery,
  ];
  return (
    <section ref={sectionRef} tabIndex={-1} aria-label={`Reporting setup for ${state.clientName}`} id={SETUP_SECTION_ANCHOR} className="my-3 min-w-0 scroll-mt-20 rounded-xl border border-line bg-canvas/50 p-3 focus-visible:ring-2 focus-visible:ring-white/30 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-ink">Reporting setup</h3>
        <StateBadge state={overallState} scope={`overall setup for ${scope}`} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-mute">
        {state.generationBlocked
          ? state.canEdit
            ? "Finish the steps below, then generate the Weekly Performance Blueprint."
            : "An owner or admin must finish the steps below before Blueprint generation is available."
          : unsupportedLabels.length > 0
            ? `Setup prerequisites are complete, but Weekly Blueprint v1 cannot verify the required marketplace provider${unsupportedLabels.length === 1 ? "" : "s"} listed below: ${unsupportedLabels.join(", ")}.`
            : "Setup is sufficient to generate a Weekly Performance Blueprint."}
      </p>
      <ol className="mt-3 space-y-2">
        {ordered.map((section) => {
          if (section.id !== "accounts") {
            return <SectionItem key={section.id} section={section} scope={scope} showLinks={showLinks} />;
          }
          return (
            <li key={section.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-ink">{section.title}</h4>
                <StateBadge state={section.state} scope={`${section.title} for ${scope}`} />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-mute">{section.summary}</p>
              {state.providers.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {state.providers.map((provider) => (
                    <li key={provider.provider} aria-label={`${provider.label} for ${scope}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-panel px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink">{provider.label}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-mute">{provider.detail}</p>
                      </div>
                      <StateBadge state={provider.state} scope={`${provider.label} for ${scope}`} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {section.recovery && showLinks ? (
                <a className="mt-2 inline-block text-xs font-medium text-ink underline" href={section.recovery.href}>
                  {section.recovery.label}
                </a>
              ) : null}
            </li>
          );
        })}
      </ol>
      {state.blockers.length > 0 ? (
        <details className="mt-3 text-xs text-ink-mute">
          <summary className="cursor-pointer font-medium text-ink">
            Blocking and warning details ({state.blockers.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {state.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${blocker.provider ?? "all"}-${index}`} className="rounded-md border border-line p-2.5">
                <p>
                  <span className="font-mono text-[10px]">{blocker.code}</span>
                  {blocker.provider ? ` (${blocker.provider})` : ""}: {blocker.message}
                </p>
                {blocker.recovery && showLinks ? (
                  <a className="mt-1.5 inline-block font-medium text-ink underline" href={blocker.recovery.href}>
                    {blocker.recovery.label}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {state.canEdit ? (
        <ReportingConfiguration
          workspaceId={state.workspaceId}
          clientId={state.clientId}
          defaultOpen={!state.requirementsConfigured}
          onSaved={onConfigurationSaved}
        />
      ) : state.role === "viewer" ? (
        <p className="mt-3 text-xs text-ink-mute">
          Read-only. Ask a workspace owner or admin about changes.{" "}
          <a className="font-medium text-ink underline" href={withClientContext("/reports", state.clientId)}>
            View this client&apos;s report
          </a>
        </p>
      ) : (
        <p className="mt-3 text-xs text-ink-mute">
          Only a workspace owner or admin can change requirements and reporting context. The links above open the surfaces an admin needs.
        </p>
      )}
      {showLinks ? (
        <p className="mt-2 text-xs text-ink-mute">
          <a className="font-medium text-ink underline" href={clientSetupHref(state.clientId)}>
            Open this client&apos;s reporting setup
          </a>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Data container: reads the existing reporting-configuration, discovered
 * account and readiness endpoints (all GET) and derives checklist state.
 * Never triggers approval, delivery or synchronization.
 */
export function ClientSetupChecklistContainer({
  workspaceId,
  clientId,
  clientName,
  windowStart,
  windowEnd,
  evaluation: providedEvaluation,
  evaluationLoading = false,
  onRequestReadinessRefresh,
}: {
  workspaceId: string;
  clientId: string;
  clientName?: string;
  windowStart?: string;
  windowEnd?: string;
  evaluation?: ReportReadinessEvaluation | null;
  /** True while the parent is still resolving its own readiness evaluation.
   * Suppresses a duplicate child request for the same evaluation. */
  evaluationLoading?: boolean;
  /** Explicit parent refresh contract: invoked after a successful
   * configuration save so parent-supplied readiness is revalidated. May
   * return the parent revalidation promise when available. */
  onRequestReadinessRefresh?: () => Promise<unknown> | void;
}) {
  const configurationKey = workspaceId && clientId
    ? `/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId, clientId })}`
    : null;
  const discoveredKey = workspaceId ? `/api/workspaces/${workspaceId}/client-accounts` : null;
  // An explicit null parent evaluation means "absent": the child may fetch a
  // scoped fallback. Only a usable parent evaluation or a loading parent
  // suppresses the child request. Partial date pairs never produce a key.
  const requestedKey = readinessRequestKey({ workspaceId, clientId, windowStart, windowEnd });
  const parentEvaluationUsable = providedEvaluation != null
    && providedEvaluation.workspaceId === workspaceId
    && providedEvaluation.clientId === clientId
    && (!windowStart || !windowEnd || (providedEvaluation.window.start === windowStart && providedEvaluation.window.end === windowEnd));
  const readinessKey = requestedKey && !parentEvaluationUsable && !evaluationLoading ? requestedKey : null;

  const {
    data: configuration,
    error: configurationError,
    isLoading: configurationLoading,
    mutate: retryConfiguration,
  } = useSWR<ConfigurationResponse>(configurationKey, jsonFetcher, { errorRetryCount: 1 });
  const {
    data: discovered,
    error: discoveredError,
    isLoading: discoveredLoading,
    mutate: retryDiscovered,
  } = useSWR<DiscoveredResponse>(discoveredKey, jsonFetcher, { errorRetryCount: 1 });
  const {
    data: readiness,
    mutate: retryReadiness,
  } = useSWR<{ evaluation?: ReportReadinessEvaluation }>(readinessKey, jsonFetcher, { errorRetryCount: 1 });

  // Tracks saves whose readiness revalidation is still in flight. While set,
  // displayed readiness is qualified as rechecking instead of current. Clears
  // when the displayed evaluation postdates the save, or when the
  // container-owned request settles. Remounts (workspace/client switches)
  // reset it, so a stale flag can never follow another client.
  const [pendingSaveRefresh, setPendingSaveRefresh] = useState(false);
  const saveEpochRef = useRef(0);

  if (!workspaceId || !clientId) return null;
  if (configurationLoading) {
    return (
      <section aria-label={`Reporting setup for ${clientName ?? clientId}`} aria-busy="true" className="my-3 rounded-xl border border-line p-3 text-xs text-ink-mute sm:p-4">
        Checking reporting setup…
      </section>
    );
  }
  if (configurationError || !configuration) {
    return (
      <section aria-label={`Reporting setup for ${clientName ?? clientId}`} className="my-3 rounded-xl border border-line p-3 text-xs text-ink-mute sm:p-4">
        <p role="alert">Reporting setup unavailable. Do not rely on an earlier result.</p>
        <button type="button" onClick={() => void retryConfiguration()} className="mt-2 underline">Retry setup check</button>
      </section>
    );
  }

  const fetchedEvaluation = readiness?.evaluation;
  // Never retain another workspace/client/window result. Default-window
  // fetches accept the server-computed window; explicit windows must match.
  const fetchedUsable = fetchedEvaluation
    && fetchedEvaluation.workspaceId === workspaceId
    && fetchedEvaluation.clientId === clientId
    && (!windowStart || !windowEnd || (fetchedEvaluation.window.start === windowStart && fetchedEvaluation.window.end === windowEnd))
    ? fetchedEvaluation
    : null;
  const evaluation = (parentEvaluationUsable ? providedEvaluation : null) ?? fetchedUsable;
  const discoveryStatus: DiscoveryStatus = !discoveredKey ? "idle" : discoveredError ? "error" : discoveredLoading || !discovered ? "loading" : "ready";

  const role: SetupRole = configuration.role
    ?? (configuration.canEdit ? "admin" : "viewer");
  // Assignment permission mirrors the authoritative assignment route's actual
  // minimum role (member). Viewers stay read-only; the fallback role above
  // already fails closed to viewer when the server omits it.
  const canManageAssignments = role === "owner" || role === "admin" || role === "member";
  const derived = deriveClientSetupState({
    workspaceId,
    clientId,
    clientName: clientName ?? clientId,
    role,
    canEdit: configuration.canEdit,
    canManageAssignments,
    requirements: {
      providers: configuration.requiredProviders ?? [],
      destinations: configuration.requiredDestinations ?? [],
      configuredAt: configuration.requirementsConfiguredAt,
    },
    discovery: {
      status: discoveryStatus,
      accounts: (discovered?.accounts ?? []).map((account) => ({
        provider: account.provider,
        accountId: account.accountId,
        assignedClientId: account.assignedClient?.id ?? null,
        connectionIds: [
          ...(account.authoritativeConnectionId ? [account.authoritativeConnectionId] : []),
          ...account.availableConnections.map((connection) => connection.id),
        ],
      })),
    },
    configurationAccounts: (configuration.accounts ?? []).map((account) => ({
      connectionId: account.connectionId,
      accountId: account.accountId,
      hasOverride: Boolean(account.context?.overrideAt),
    })),
    evaluation: evaluation ?? null,
    evaluationStale: pendingSaveRefresh && evaluation != null,
  });
  if (!derived.ok) return null;

  const handleConfigurationSaved = () => {
    const epoch = ++saveEpochRef.current;
    setPendingSaveRefresh(true);
    const refreshes: Array<Promise<unknown>> = [retryConfiguration(), retryDiscovered()];
    if (readinessKey) {
      // Revalidate the exact readiness key (default or explicit window).
      refreshes.push(retryReadiness());
    }
    // Parent-owned readiness: await the parent revalidation when it exposes
    // its refresh promise so the stale flag clears exactly when fresh data
    // has arrived, never on an older save's completion.
    refreshes.push(Promise.resolve(onRequestReadinessRefresh?.()));
    void Promise.allSettled(refreshes).then(() => {
      if (saveEpochRef.current === epoch) setPendingSaveRefresh(false);
    });
  };

  return (
    <>
      {discoveredError ? (
        <div role="alert" className="my-3 rounded-xl border border-line p-3 text-xs text-ink-mute sm:p-4">
          <p>Assigned-account status is unavailable right now. Existing assignments were not changed.</p>
          <button type="button" onClick={() => void retryDiscovered()} className="mt-2 underline">Retry discovery</button>
        </div>
      ) : null}
      <ClientSetupChecklist state={derived.state} onConfigurationSaved={handleConfigurationSaved} />
    </>
  );
}
