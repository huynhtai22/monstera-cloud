"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { ReportingConfiguration } from "./ReportingConfiguration";
import {
  SETUP_SECTION_ANCHOR,
  SETUP_STATE_LABELS,
  clientSetupHref,
  deriveClientSetupState,
  isSetupFocusFragment,
  providerLabel,
  type ClientSetupState,
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
}: {
  workspaceId: string;
  clientId: string;
  clientName?: string;
  windowStart?: string;
  windowEnd?: string;
  evaluation?: ReportReadinessEvaluation | null;
}) {
  const configurationKey = workspaceId && clientId
    ? `/api/reports/readiness/configuration?${new URLSearchParams({ workspaceId, clientId })}`
    : null;
  const discoveredKey = workspaceId ? `/api/workspaces/${workspaceId}/client-accounts` : null;
  const readinessParams = new URLSearchParams({ workspaceId, clientId });
  if (windowStart) readinessParams.set("start", windowStart);
  if (windowEnd) readinessParams.set("end", windowEnd);
  const readinessKey = workspaceId && clientId && providedEvaluation === undefined && windowStart && windowEnd
    ? `/api/reports/readiness?${readinessParams.toString()}`
    : null;

  const {
    data: configuration,
    error: configurationError,
    isLoading: configurationLoading,
    mutate: retryConfiguration,
  } = useSWR<ConfigurationResponse>(configurationKey, jsonFetcher, { errorRetryCount: 1 });
  const { data: discovered, mutate: retryDiscovered } = useSWR<DiscoveredResponse>(discoveredKey, jsonFetcher, { errorRetryCount: 1 });
  const { data: readiness } = useSWR<{ evaluation?: ReportReadinessEvaluation }>(readinessKey, jsonFetcher, { errorRetryCount: 1 });

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
  const windowMatches = !windowStart || !windowEnd || !fetchedEvaluation
    || (fetchedEvaluation.window.start === windowStart && fetchedEvaluation.window.end === windowEnd);
  const scopedProvided = providedEvaluation
    && providedEvaluation.workspaceId === workspaceId
    && providedEvaluation.clientId === clientId
    && (!windowStart || !windowEnd || (providedEvaluation.window.start === windowStart && providedEvaluation.window.end === windowEnd));
  // Never retain another workspace/client/window result.
  const evaluation = (scopedProvided ? providedEvaluation : null)
    ?? (windowMatches ? fetchedEvaluation ?? null : null);

  const role: SetupRole = configuration.role
    ?? (configuration.canEdit ? "admin" : "viewer");
  const derived = deriveClientSetupState({
    workspaceId,
    clientId,
    clientName: clientName ?? clientId,
    role,
    canEdit: configuration.canEdit,
    requirements: {
      providers: configuration.requiredProviders ?? [],
      destinations: configuration.requiredDestinations ?? [],
      configuredAt: configuration.requirementsConfiguredAt,
    },
    discovered: (discovered?.accounts ?? []).map((account) => ({
      provider: account.provider,
      accountId: account.accountId,
      assignedClientId: account.assignedClient?.id ?? null,
      connectionIds: [
        ...(account.authoritativeConnectionId ? [account.authoritativeConnectionId] : []),
        ...account.availableConnections.map((connection) => connection.id),
      ],
    })),
    configurationAccounts: (configuration.accounts ?? []).map((account) => ({
      connectionId: account.connectionId,
      accountId: account.accountId,
      hasOverride: Boolean(account.context?.overrideAt),
    })),
    evaluation: evaluation ?? null,
  });
  if (!derived.ok) return null;
  return (
    <ClientSetupChecklist
      state={derived.state}
      onConfigurationSaved={() => {
        void retryConfiguration();
        void retryDiscovered();
      }}
    />
  );
}
