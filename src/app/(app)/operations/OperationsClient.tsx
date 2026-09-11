"use client";

import React from "react";
import Link from "next/link";
import useSWR from "swr";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    CircleSlash,
    Info,
    RefreshCw,
} from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { RefreshedAt } from "@/components/ui/RefreshedAt";
import { EmptyState } from "@/components/ui/EmptyState";
import { useWorkspaceStore } from "@/store/workspace";
import { useClientContextNavigation } from "@/components/client-context/useClientContextNavigation";
import { cn } from "@/lib/utils";
import {
    describeOperationsReason,
    deriveOperationsActions,
    formatEvidenceDay,
    formatEvidenceTimestamp,
    operationsPriorityLabel,
    operationsPriorityTone,
    operationsStateLabel,
    operationsStateTone,
    operationsTruncationNotice,
    type OperationsAction,
    type OperationsSectionStateView,
    type OperationsTone,
} from "@/lib/operations-view";
// Type-only import: the summary loader is server-only and must never be pulled
// into the client bundle (enforced by the client-boundary guard).
import type { OperationsSummary } from "@/lib/operations-summary";

type Summary = OperationsSummary;
type ConnectorHealthSection = Summary["sections"]["connectorHealth"];
type FreshnessSection = Summary["sections"]["freshness"];
type IngestionSection = Summary["sections"]["ingestion"];
type ReadinessSection = Summary["sections"]["readiness"];
type DeliverySection = Summary["sections"]["delivery"];
type AnomaliesSection = Summary["sections"]["anomalies"];

const fetcher = async (url: string): Promise<Summary> => {
    const res = await fetch(url);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error((payload as { error?: string }).error || "Failed to load the operations summary");
    }
    return payload as Summary;
};

const TONE_BADGE: Record<OperationsTone, string> = {
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    neutral: "border-line bg-canvas text-ink-mute",
};

const TONE_VALUE: Record<OperationsTone, string> = {
    ok: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    danger: "text-rose-600 dark:text-rose-400",
    info: "text-sky-600 dark:text-sky-400",
    neutral: "text-ink",
};

const STATE_ICON: Record<OperationsSectionStateView, React.ReactNode> = {
    ready: <CheckCircle2 aria-hidden />,
    attention: <AlertTriangle aria-hidden />,
    empty: <CircleSlash aria-hidden />,
    unsupported: <Info aria-hidden />,
    unavailable: <AlertTriangle aria-hidden />,
};

function humanize(value: string): string {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function severityTone(severity: string): OperationsTone {
    if (severity === "critical") return "danger";
    if (severity === "warning") return "warn";
    return "neutral";
}

function countTone(count: number): OperationsTone {
    return count > 0 ? "warn" : "neutral";
}

/**
 * Freshness states are not uniformly bad when non-zero: `fresh` is healthy and
 * `syncing`/`pending` are simply in flight, so they must not be coloured as
 * attention.
 */
function freshnessTone(state: string, count: number): OperationsTone {
    if (count === 0) return "neutral";
    if (state === "fresh") return "ok";
    if (state === "syncing" || state === "pending") return "info";
    return "warn";
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: React.ReactNode; tone?: OperationsTone }) {
    return (
        <div className="rounded-md border border-line bg-canvas px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-mute">{label}</div>
            <div className={cn("mt-1 text-lg font-semibold tabular-nums", TONE_VALUE[tone])}>{value}</div>
        </div>
    );
}

function StatGrid({ children }: { children: React.ReactNode }) {
    return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>;
}

function EvidenceList({ children }: { children: React.ReactNode }) {
    return <ul className="mt-3 space-y-1.5">{children}</ul>;
}

function EvidenceRow({ children }: { children: React.ReactNode }) {
    return (
        <li className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink-mute">{children}</li>
    );
}

function Quiet({ children }: { children: React.ReactNode }) {
    return <p className="mt-3 text-xs text-ink-mute">{children}</p>;
}

function SectionNotice({ reason }: { reason: string | null }) {
    return (
        <p className="rounded-md border border-line bg-canvas px-3 py-2.5 text-xs text-ink-mute">
            {describeOperationsReason(reason)}
        </p>
    );
}

function NextActionsCard({
    actions,
    hrefFor,
}: {
    actions: OperationsAction[];
    hrefFor: (path: string) => string;
}) {
    return (
        <section
            data-testid="operations-actions"
            aria-labelledby="operations-actions-heading"
            className="mb-6 rounded-lg border border-line bg-panel p-5 shadow-xs"
        >
            <header className="flex items-center justify-between gap-3 border-b border-line pb-3">
                <div className="flex items-center gap-2">
                    <h2 id="operations-actions-heading" className="text-sm font-semibold text-ink">
                        Next actions
                    </h2>
                    <span
                        data-testid="operations-actions-count"
                        className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-mute"
                    >
                        {actions.length}
                    </span>
                </div>
            </header>

            {actions.length === 0 ? (
                <div
                    data-testid="operations-actions-empty"
                    className="mt-4 flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300"
                >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <div>
                        <p className="font-semibold">No immediate action required</p>
                        <p className="mt-0.5 text-ink-mute">
                            All systems operational across connectors, freshness, ingestion, readiness, delivery, and anomalies.
                        </p>
                    </div>
                </div>
            ) : (
                <ul data-testid="operations-actions-list" className="mt-3 space-y-2">
                    {actions.map((action) => {
                        const tone = operationsPriorityTone(action.priority);
                        const priorityLabel = operationsPriorityLabel(action.priority);
                        return (
                            <li
                                key={action.id}
                                data-testid={`operations-action-${action.sectionKey}`}
                                data-priority={action.priority}
                                className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span
                                            data-testid="operations-action-priority"
                                            className={cn(
                                                "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                                                TONE_BADGE[tone],
                                            )}
                                            aria-label={priorityLabel}
                                        >
                                            {priorityLabel}
                                        </span>
                                        <h3 className="text-xs font-semibold text-ink">{action.title}</h3>
                                        {action.count !== undefined && action.count > 0 ? (
                                            <span className="text-[11px] text-ink-mute">
                                                ({action.count})
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mt-1 text-xs text-ink-mute">{action.explanation}</p>
                                    {action.latestEvidenceAt ? (
                                        <p className="mt-1 text-[11px] text-ink-mute">
                                            Latest evidence: {formatEvidenceTimestamp(action.latestEvidenceAt)}
                                        </p>
                                    ) : null}
                                </div>
                                <Link
                                    href={hrefFor(action.cta.href)}
                                    className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/[0.06] sm:self-center"
                                >
                                    {action.cta.label}
                                    <ChevronRight className="h-3 w-3" aria-hidden />
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function SectionCard({
    sectionKey,
    title,
    description,
    icon,
    state,
    truncated,
    limit,
    unit,
    cta,
    children,
}: {
    sectionKey: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    state: OperationsSectionStateView;
    truncated: boolean;
    limit: number;
    unit: string;
    cta: { label: string; href: string };
    children: React.ReactNode;
}) {
    const tone = operationsStateTone(state);
    return (
        <section
            data-testid={`operations-section-${sectionKey}`}
            data-state={state}
            className="flex flex-col rounded-lg border border-line bg-panel shadow-xs"
        >
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-ink [&>svg]:h-4 [&>svg]:w-4">
                    {icon}
                </span>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-ink">{title}</h2>
                    <p className="mt-0.5 text-xs text-ink-mute">{description}</p>
                </div>
                <span
                    data-testid={`operations-state-${sectionKey}`}
                    data-state={state}
                    className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em]",
                        TONE_BADGE[tone],
                    )}
                >
                    <span className="[&>svg]:h-3 [&>svg]:w-3">{STATE_ICON[state]}</span>
                    {operationsStateLabel(state)}
                </span>
            </header>
            <div className="flex-1 px-5 py-4">{children}</div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
                <p className="text-[11px] text-ink-mute">
                    {truncated ? operationsTruncationNotice(limit, unit) : ""}
                </p>
                <Link
                    href={cta.href}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-white/[0.06]"
                >
                    {cta.label}
                    <ChevronRight className="h-3 w-3" aria-hidden />
                </Link>
            </footer>
        </section>
    );
}

function renderConnectorHealth(section: ConnectorHealthSection): React.ReactNode {
    if (section.data === null) {
        return <SectionNotice reason={section.reason} />;
    }
    const { totals, attention } = section.data;
    return (
        <>
            <StatGrid>
                <Stat label="Accounts" value={totals.total} />
                <Stat label="Healthy" value={totals.healthy} tone="ok" />
                <Stat label="Degraded" value={totals.degraded} tone={countTone(totals.degraded)} />
                <Stat label="Quarantined" value={totals.quarantined} tone={totals.quarantined > 0 ? "danger" : "neutral"} />
                <Stat label="Reconnect" value={totals.reconnectRequired} tone={countTone(totals.reconnectRequired)} />
                <Stat label="Unknown" value={totals.unknown} tone={countTone(totals.unknown)} />
            </StatGrid>
            {attention.length === 0 ? (
                <Quiet>Every provider account in this scope is healthy.</Quiet>
            ) : (
                <EvidenceList>
                    {attention.map((account) => (
                        <EvidenceRow key={`${account.connectionId}:${account.accountId}`}>
                            <span className="font-semibold text-ink">
                                {account.accountName ?? account.accountId}
                            </span>{" "}
                            <span className="text-ink-mute">· {humanize(account.provider)}</span>{" "}
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                                {humanize(account.status)}
                            </span>
                            {account.consecutiveFailures > 0 ? (
                                <span className="text-ink-mute"> · {account.consecutiveFailures} consecutive failures</span>
                            ) : null}
                            {account.lastErrorSummary ? (
                                <div className="mt-1 truncate text-[11px] text-ink-mute" title={account.lastErrorSummary}>
                                    {account.lastErrorSummary}
                                </div>
                            ) : null}
                        </EvidenceRow>
                    ))}
                </EvidenceList>
            )}
        </>
    );
}

function renderFreshness(section: FreshnessSection): React.ReactNode {
    if (section.data === null) {
        return <SectionNotice reason={section.reason} />;
    }
    const { totals, attention, sourceFreshnessHours, escalationHours } = section.data;
    const total = Object.values(totals).reduce((sum, count) => sum + count, 0);
    return (
        <>
            <StatGrid>
                <Stat label="Sources" value={total} />
                {Object.entries(totals).map(([state, count]) => (
                    <Stat key={state} label={humanize(state)} value={count} tone={freshnessTone(state, count)} />
                ))}
            </StatGrid>
            <Quiet>
                Source freshness policy is {sourceFreshnessHours}h; the pipeline escalation window is {escalationHours}h.
            </Quiet>
            {attention.length === 0 ? (
                <Quiet>No source connection is stale or errored in this scope.</Quiet>
            ) : (
                <EvidenceList>
                    {attention.map((source) => (
                        <EvidenceRow key={source.connectionId}>
                            <span className="font-semibold text-ink">{source.name}</span>{" "}
                            <span className="text-ink-mute">· {humanize(source.provider)}</span>{" "}
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                                {humanize(source.state)}
                            </span>
                            <div className="mt-1 text-[11px] text-ink-mute">
                                Last sync {formatEvidenceTimestamp(source.lastSyncAt)} · data through{" "}
                                {formatEvidenceDay(source.lastDataThrough)}
                            </div>
                        </EvidenceRow>
                    ))}
                </EvidenceList>
            )}
        </>
    );
}

function renderIngestion(section: IngestionSection): React.ReactNode {
    if (section.data === null) {
        return <SectionNotice reason={section.reason} />;
    }
    const { totals, recentFailures, syncLogErrors, windowDays } = section.data;
    return (
        <>
            <StatGrid>
                <Stat label={`Jobs · ${windowDays}d`} value={totals.total} />
                <Stat label="Queued" value={totals.queued} />
                <Stat label="Running" value={totals.running} tone="info" />
                <Stat label="Completed" value={totals.completed} tone="ok" />
                <Stat label="Partial" value={totals.partial} tone={countTone(totals.partial)} />
                <Stat label="Failed" value={totals.failed} tone={totals.failed > 0 ? "danger" : "neutral"} />
            </StatGrid>
            {recentFailures.length === 0 && syncLogErrors.length === 0 ? (
                <Quiet>No failed or partial import job in this window.</Quiet>
            ) : (
                <EvidenceList>
                    {recentFailures.map((failure) => (
                        <EvidenceRow key={failure.id}>
                            <span className="font-semibold text-ink">Import job</span>{" "}
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                                {humanize(failure.status)}
                            </span>
                            <div className="mt-1 text-[11px] text-ink-mute">
                                {formatEvidenceDay(failure.since)} → {formatEvidenceDay(failure.until)} · finished{" "}
                                {formatEvidenceTimestamp(failure.finishedAt)}
                            </div>
                            {failure.errorSummary ? (
                                <div className="mt-1 truncate text-[11px] text-ink-mute" title={failure.errorSummary}>
                                    {failure.errorSummary}
                                </div>
                            ) : null}
                        </EvidenceRow>
                    ))}
                    {syncLogErrors.map((entry) => (
                        <EvidenceRow key={entry.id}>
                            <span className="font-semibold text-ink">Sync log</span>{" "}
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                                {humanize(entry.status)}
                            </span>{" "}
                            <span className="text-ink-mute">· {formatEvidenceTimestamp(entry.createdAt)}</span>
                            {entry.errorSummary ? (
                                <div className="mt-1 truncate text-[11px] text-ink-mute" title={entry.errorSummary}>
                                    {entry.errorSummary}
                                </div>
                            ) : null}
                        </EvidenceRow>
                    ))}
                </EvidenceList>
            )}
        </>
    );
}

function renderReadiness(section: ReadinessSection): React.ReactNode {
    if (section.data === null) {
        return <SectionNotice reason={section.reason} />;
    }
    const { totals, clients, evaluatedClients } = section.data;
    return (
        <>
            <StatGrid>
                <Stat label="Evaluated" value={evaluatedClients} />
                <Stat label="Ready" value={totals.ready} tone="ok" />
                <Stat label="Not ready" value={totals.notReady} tone={totals.notReady > 0 ? "danger" : "neutral"} />
                <Stat label="Warnings" value={totals.warning} tone={countTone(totals.warning)} />
                <Stat label="Unknown" value={totals.unknown} tone={countTone(totals.unknown)} />
            </StatGrid>
            {clients.length === 0 ? (
                <Quiet>No client is in scope for a readiness evaluation.</Quiet>
            ) : (
                <EvidenceList>
                    {clients.map((client) => (
                        <EvidenceRow key={client.clientId}>
                            <span className="font-semibold text-ink">{client.clientName}</span>{" "}
                            <span
                                className={cn(
                                    "font-medium",
                                    client.status === "READY"
                                        ? "text-emerald-600 dark:text-emerald-400"
                                        : "text-amber-600 dark:text-amber-400",
                                )}
                            >
                                {humanize(client.status)}
                            </span>
                            {client.blockers.length > 0 ? (
                                <div className="mt-1 text-[11px] text-ink-mute">
                                    Blockers: {client.blockers.map(humanize).join(", ")}
                                </div>
                            ) : null}
                            {client.warnings.length > 0 ? (
                                <div className="mt-1 text-[11px] text-ink-mute">
                                    Warnings: {client.warnings.map(humanize).join(", ")}
                                </div>
                            ) : null}
                        </EvidenceRow>
                    ))}
                </EvidenceList>
            )}
        </>
    );
}

function renderDelivery(section: DeliverySection): React.ReactNode {
    if (section.data === null) {
        return <SectionNotice reason={section.reason} />;
    }
    const { totals, latest, recencyHours } = section.data;
    return (
        <>
            <StatGrid>
                <Stat label="Destinations" value={totals.receipts} />
                <Stat label="Stale" value={totals.stale} tone={totals.stale > 0 ? "danger" : "neutral"} />
                <Stat label="Clients" value={totals.clients} />
            </StatGrid>
            <Quiet>A delivery is current only when it was retrieved within {recencyHours}h.</Quiet>
            {latest.length === 0 ? (
                <Quiet>No destination delivery receipt exists in this scope.</Quiet>
            ) : (
                <EvidenceList>
                    {latest.map((entry) => (
                        <EvidenceRow key={`${entry.clientId}:${entry.destination}:${entry.windowStart}`}>
                            <span className="font-semibold text-ink">{humanize(entry.destination)}</span>{" "}
                            <span
                                className={cn(
                                    "font-medium",
                                    entry.stale ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
                                )}
                            >
                                {entry.stale ? "Stale" : "Current"}
                            </span>
                            <div className="mt-1 text-[11px] text-ink-mute">
                                {entry.rowCount} rows · data through {formatEvidenceDay(entry.dataThroughDate)} · retrieved{" "}
                                {formatEvidenceTimestamp(entry.retrievedAt)}
                            </div>
                        </EvidenceRow>
                    ))}
                </EvidenceList>
            )}
        </>
    );
}

function renderAnomalies(section: AnomaliesSection): React.ReactNode {
    if (section.data === null) {
        return <SectionNotice reason={section.reason} />;
    }
    const { totals, items, windowDays } = section.data;
    return (
        <>
            <StatGrid>
                <Stat label={`Anomalies · ${windowDays}d`} value={totals.total} tone={totals.total > 0 ? "warn" : "neutral"} />
                <Stat label="Critical" value={totals.critical} tone={totals.critical > 0 ? "danger" : "neutral"} />
                <Stat label="Warning" value={totals.warning} tone={countTone(totals.warning)} />
            </StatGrid>
            {items.length === 0 ? (
                <Quiet>No marketing anomaly was detected in this window.</Quiet>
            ) : (
                <EvidenceList>
                    {items.map((item) => (
                        <EvidenceRow key={item.id}>
                            <span className={cn("font-semibold", TONE_VALUE[severityTone(item.severity)])}>
                                {humanize(item.type)}
                            </span>{" "}
                            <span className="text-ink-mute">· {humanize(item.platform)}</span>
                            <div className="mt-1 truncate text-[11px] text-ink-mute" title={item.campaignName}>
                                {item.campaignName}
                                {item.accountName ? ` · ${item.accountName}` : ""}
                            </div>
                        </EvidenceRow>
                    ))}
                </EvidenceList>
            )}
        </>
    );
}

function LoadingGrid() {
    return (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-hidden>
            {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-52 animate-pulse rounded-lg border border-line bg-panel" />
            ))}
        </div>
    );
}

export function OperationsClient() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { requestedRaw, hrefFor } = useClientContextNavigation();

    const query = new URLSearchParams();
    if (activeWorkspaceId) query.set("workspaceId", activeWorkspaceId);
    if (requestedRaw) query.set("clientId", requestedRaw);
    const key = activeWorkspaceId ? `/api/operations/summary?${query.toString()}` : null;

    const { data, error, isLoading, isValidating, mutate } = useSWR<Summary>(key, fetcher, {
        revalidateOnFocus: false,
    });

    const scopeLabel = (() => {
        const context = data?.clientContext;
        if (!context) return null;
        if (context.status === "resolved" && context.client) return `Viewing: ${context.client.name}`;
        if (context.status === "unassigned") return "Viewing: Unassigned accounts";
        return "Workspace-wide";
    })();

    const actions = React.useMemo(() => deriveOperationsActions(data), [data]);

    return (
        <PageShell>
            <div data-testid="operations-page" className="mx-auto w-full max-w-6xl">
                <header className="mb-6 flex flex-col justify-between gap-3 border-b border-line pb-6 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-ink">
                            <Activity className="h-5 w-5" aria-hidden />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-ink">Operations Hub</h1>
                            <p className="mt-1 text-xs text-ink-mute">
                                Read-only operational health across connectors, freshness, ingestion, readiness,
                                delivery and anomalies.
                            </p>
                        </div>
                    </div>
                    <RefreshedAt onRefresh={() => void mutate()} loading={isValidating} />
                </header>

                {scopeLabel ? (
                    <p data-testid="operations-scope" className="mb-4 text-xs text-ink-mute">
                        {scopeLabel}
                    </p>
                ) : null}

                {!activeWorkspaceId ? (
                    <EmptyState
                        icon={<Activity aria-hidden />}
                        title="No workspace selected"
                        description="Choose a workspace to see its operational summary."
                    />
                ) : error ? (
                    <div
                        data-testid="operations-error"
                        className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-700 dark:text-rose-300"
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <div>
                            <p className="font-semibold">Could not load the operations summary</p>
                            <p className="mt-1 text-xs">{error instanceof Error ? error.message : "Unknown error"}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void mutate()}
                            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-canvas px-3 py-1.5 text-[11px] font-semibold text-ink"
                        >
                            <RefreshCw className="h-3 w-3" aria-hidden />
                            Retry
                        </button>
                    </div>
                ) : isLoading || !data ? (
                    <LoadingGrid />
                ) : (
                    <>
                        <NextActionsCard actions={actions} hrefFor={hrefFor} />
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <SectionCard
                            sectionKey="connectorHealth"
                            title="Connector health"
                            description="Provider accounts by health state."
                            icon={<Activity aria-hidden />}
                            state={data.sections.connectorHealth.state}
                            truncated={data.sections.connectorHealth.truncated}
                            limit={data.sections.connectorHealth.limit}
                            unit="accounts"
                            cta={{ label: "Open sources", href: hrefFor(data.navigation.sources) }}
                        >
                            {renderConnectorHealth(data.sections.connectorHealth)}
                        </SectionCard>

                        <SectionCard
                            sectionKey="freshness"
                            title="Source freshness"
                            description="Connections that are stale or errored."
                            icon={<RefreshCw aria-hidden />}
                            state={data.sections.freshness.state}
                            truncated={data.sections.freshness.truncated}
                            limit={data.sections.freshness.limit}
                            unit="sources"
                            cta={{ label: "Open sources", href: hrefFor(data.navigation.sources) }}
                        >
                            {renderFreshness(data.sections.freshness)}
                        </SectionCard>

                        <SectionCard
                            sectionKey="ingestion"
                            title="Ingestion"
                            description="Warehouse import jobs and sync-log errors."
                            icon={<CircleSlash aria-hidden />}
                            state={data.sections.ingestion.state}
                            truncated={data.sections.ingestion.truncated}
                            limit={data.sections.ingestion.limit}
                            unit="entries"
                            cta={{ label: "Open reports", href: hrefFor(data.navigation.reports) }}
                        >
                            {renderIngestion(data.sections.ingestion)}
                        </SectionCard>

                        <SectionCard
                            sectionKey="readiness"
                            title="Report readiness"
                            description="Clients that can produce a verified report."
                            icon={<CheckCircle2 aria-hidden />}
                            state={data.sections.readiness.state}
                            truncated={data.sections.readiness.truncated}
                            limit={data.sections.readiness.limit}
                            unit="clients"
                            cta={{ label: "Open reports", href: hrefFor(data.navigation.reports) }}
                        >
                            {renderReadiness(data.sections.readiness)}
                        </SectionCard>

                        <SectionCard
                            sectionKey="delivery"
                            title="Destination delivery"
                            description="Recent deliveries and stale destinations."
                            icon={<Info aria-hidden />}
                            state={data.sections.delivery.state}
                            truncated={data.sections.delivery.truncated}
                            limit={data.sections.delivery.limit}
                            unit="destinations"
                            cta={{ label: "Open exports", href: hrefFor(data.navigation.exports) }}
                        >
                            {renderDelivery(data.sections.delivery)}
                        </SectionCard>

                        <SectionCard
                            sectionKey="anomalies"
                            title="Marketing anomalies"
                            description="Detected spend, CPA and conversion anomalies."
                            icon={<AlertTriangle aria-hidden />}
                            state={data.sections.anomalies.state}
                            truncated={data.sections.anomalies.truncated}
                            limit={data.sections.anomalies.limit}
                            unit="anomalies"
                            cta={{ label: "Open clients", href: hrefFor(data.navigation.clients) }}
                        >
                            {renderAnomalies(data.sections.anomalies)}
                        </SectionCard>
                    </div>
                    </>
                )}
            </div>
        </PageShell>
    );
}
