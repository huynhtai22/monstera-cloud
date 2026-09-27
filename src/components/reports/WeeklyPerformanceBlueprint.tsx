"use client";

import React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertCircle,
  BadgeCheck,
  CalendarRange,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClientSetupChecklistContainer } from "@/components/reports/ClientSetupChecklist";
import { clientSetupHref } from "@/lib/client-setup-checklist";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load");
  return data;
};

const PROVIDER_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  lazada: "Lazada",
};

type BlueprintMetrics = {
  currency: string | null;
  monetaryAvailable: boolean;
  currencies: string[];
  spend: number | null;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number | null;
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
  scope?: "combined" | "by_provider_only" | "unavailable";
};

type PercentDelta = { field: string; current: number | null; previous: number | null; deltaPercent: number | null };

type BlueprintReport = {
  overview: {
    clientName: string;
    blueprintVersion: number;
    reportingWindow: { start: string; end: string };
    comparisonWindow: { start: string; end: string } | null;
    reportingTimezone: string | null;
    currency: string | null;
    requiredProviders: string[];
    requiredDestinations: string[];
    includedProviders: string[];
    generatedAt: string;
    verification: { status: "VERIFIED" | "NOT_VERIFIED"; reasons: string[] };
    readiness: {
      status: "READY" | "NOT_READY" | "WARNING" | "UNKNOWN";
      dataStatus?: "READY" | "NOT_READY" | "WARNING" | "UNKNOWN";
      blockers: string[];
      warnings: string[];
      destinationState: "verified" | "unavailable" | "unverified" | "stale";
    };
  };
  totals: BlueprintMetrics & { scope?: "combined" | "by_provider_only" | "unavailable"; unavailable?: boolean };
  providers: Array<{
    provider: string;
    providerLabel: string;
    status: "included" | "no_data" | "unsupported" | "ambiguous";
    included: boolean;
    metrics: BlueprintMetrics | null;
    changes: PercentDelta[];
    dataThrough: string | null;
    explanation: string;
  }>;
  campaigns: Array<{
    provider: string;
    providerLabel: string;
    campaignId: string;
    campaignName: string;
    accountId: string;
    currency: string | null;
    spend: number | null;
    impressions: number;
    clicks: number;
    conversions: number;
    conversionValue: number | null;
    cpa: number | null;
    roas: number | null;
    changes: PercentDelta[];
  }>;
  campaignTruncated: boolean;
  campaignTotal: number;
};

type ClientRequirement = {
  id: string;
  requiredProviders: string[];
  requiredDestinations: string[];
  requirementsConfiguredAt: string | null;
} | null;

type SnapshotState = {
  id: string;
  sequence: number;
  dependencyHash: string;
  verificationStatus: string;
  verificationReasons: string[];
  generatedAt: string;
  freshness: { freshness: "CURRENT" | "STALE"; staleReasons: Array<{ code: string; label: string }>; dependencyHashMatches: boolean };
  verification: { status: "VERIFIED" | "NOT_VERIFIED"; reasons: string[] };
} | null;

export type ReportLifecycleState =
  | "Not ready to review"
  | "Ready to review"
  | "Approved — ready to send"
  | "Dataset retrieval verified"
  | "Approval outdated"
  | string;

export type ReportLifecycle = {
  dataStatus: "READY" | "WARNING" | "NOT_READY" | "UNKNOWN";
  approvalStatus: "NOT_APPROVED" | "APPROVED" | "OUTDATED";
  deliveryStatus: "NOT_DELIVERED" | "DELIVERED" | "FAILED" | "OUTDATED";
  summaryLabel: string;
};

export type ReportApprovalState = {
  id: string;
  snapshotId: string;
  generationKey: string;
  sequence: number;
  datasetFingerprint: string;
  dependencyHash: string;
  approvedByUserId: string;
  approvedByUserName?: string | null;
  approvedByUserEmail?: string | null;
  approvedAt: string;
};

type BlueprintPayload = {
  client: ClientRequirement;
  snapshot: SnapshotState;
  report: BlueprintReport | null;
  defaultWindow: { start: string; end: string } | null;
  approval?: ReportApprovalState | null;
  lifecycle?: ReportLifecycle | null;
  lifecycleState?: string;
  canEmailApprovedReports?: boolean;
  emailDelivery?: {
    id: string;
    status: "PROVIDER_STARTED" | "ACCEPTED" | "DEFINITIVE_FAILED" | "AMBIGUOUS";
    recipient: string;
    providerMessageId: string | null;
    failureCode: string | null;
    attemptedAt: string;
    finishedAt: string | null;
  } | null;
  error?: string;
};

function formatMetric(value: number | null, currency: string | null, kind: "money" | "count" | "ratio" | "percent"): string {
  if (value === null || value === undefined) return "—";
  if (kind === "money" && currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: currency === "VND" ? 0 : 2,
      }).format(value);
    } catch {
      return `${value.toLocaleString("en-US")} ${currency}`;
    }
  }
  if (kind === "percent") return `${(value * 100).toFixed(2)}%`;
  if (kind === "ratio") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US");
}

function deltaLabel(delta: PercentDelta | undefined): string {
  if (!delta || delta.deltaPercent === null || !Number.isFinite(delta.deltaPercent)) return "—";
  const rounded = Math.round(delta.deltaPercent * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function LifecycleBadge({ state }: { state: ReportLifecycleState }) {
  const configs: Record<ReportLifecycleState, { tone: string; icon: React.ElementType }> = {
    "Not ready to review": {
      tone: "border-red-500/40 bg-red-950/30 text-red-300",
      icon: AlertCircle,
    },
    "Ready to review": {
      tone: "border-blue-500/40 bg-blue-950/30 text-blue-300",
      icon: Clock,
    },
    "Approved — ready to send": {
      tone: "border-emerald-500/40 bg-emerald-950/30 text-emerald-300",
      icon: CheckCircle2,
    },
    "Dataset retrieval verified": {
      tone: "border-purple-500/40 bg-purple-950/30 text-purple-300",
      icon: BadgeCheck,
    },
    "Dataset retrieval verified (unapproved)": {
      tone: "border-amber-500/40 bg-amber-950/30 text-amber-300",
      icon: ShieldAlert,
    },
    "Dataset evidence outdated": {
      tone: "border-amber-500/40 bg-amber-950/30 text-amber-300",
      icon: ShieldAlert,
    },
    "Approval outdated": {
      tone: "border-amber-500/40 bg-amber-950/30 text-amber-300",
      icon: ShieldAlert,
    },
  };
  const config = configs[state] ?? {
    tone: "border-line bg-canvas text-ink-mute",
    icon: HelpCircle,
  };
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide", config.tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {state}
    </span>
  );
}

function VerificationBadge({ status }: { status: string }) {
  if (status === "VERIFIED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Verified
      </span>
    );
  }
  const tone = status === "WARNING" || status === "READY"
    ? "border-amber-500/40 bg-amber-950/30 text-amber-300"
    : status === "UNKNOWN"
      ? "border-line bg-canvas text-ink-mute"
      : "border-red-500/40 bg-red-950/30 text-red-300";
  const Icon = status === "UNKNOWN" ? HelpCircle : ShieldAlert;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {status === "READY" ? "Not verified · Ready" : status === "NOT_VERIFIED" ? "Not verified" : status}
    </span>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-ink-mute">{hint}</p> : null}
    </div>
  );
}

const CARD = "rounded-xl border border-line bg-panel p-4 shadow-xs";

export function WeeklyPerformanceBlueprint({
  workspaceId,
  clients,
  selectedClientId,
  onClientChange,
}: {
  workspaceId: string;
  clients: Array<{ id: string; name: string }>;
  selectedClientId: string;
  onClientChange: (id: string) => void;
}) {
  const [windowStart, setWindowStart] = React.useState("");
  const [windowEnd, setWindowEnd] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [sendingEmail, setSendingEmail] = React.useState(false);
  const [emailRecipient, setEmailRecipient] = React.useState("");
  const emailIdempotencyKey = React.useRef<string | null>(null);
  const [generateError, setGenerateError] = React.useState<{ message: string; code?: string } | null>(null);

  React.useEffect(() => {
    setGenerateError(null);
  }, [selectedClientId, workspaceId]);

  const query = new URLSearchParams({ workspaceId, clientId: selectedClientId });
  if (windowStart && windowEnd) {
    query.set("windowStart", windowStart);
    query.set("windowEnd", windowEnd);
  }
  const enabled = Boolean(workspaceId && selectedClientId);

  const { data, error, isLoading, mutate: revalidate } = useSWR<BlueprintPayload>(
    enabled ? `/api/reports/blueprint?${query.toString()}` : null,
    fetcher,
  );

  React.useEffect(() => {
    emailIdempotencyKey.current = null;
  }, [workspaceId, selectedClientId, data?.snapshot?.id]);

  const clientRequirement = data?.client ?? null;
  const requirementsConfigured = Boolean(
    clientRequirement?.requirementsConfiguredAt
    && (clientRequirement.requiredProviders?.length ?? 0) > 0
    && (clientRequirement.requiredDestinations?.length ?? 0) > 0,
  );

  const applyDefaultWindow = React.useCallback(() => {
    setWindowStart("");
    setWindowEnd("");
  }, []);

  const generate = async () => {
    if (!workspaceId || !selectedClientId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/reports/blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId: selectedClientId,
          ...(windowStart && windowEnd ? { windowStart, windowEnd } : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError({ message: payload.error || "Failed to generate report", code: payload.code });
        throw new Error(payload.error || "Failed to generate report");
      }
      await revalidate();
    } catch (generateError) {
      toast.error(generateError instanceof Error ? generateError.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!data?.snapshot?.id) return;
    setApproving(true);
    try {
      const res = await fetch("/api/reports/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotId: data.snapshot.id,
          workspaceId,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to approve report");
      toast.success(payload.created ? "Report approved successfully" : "Report is already approved");
      await revalidate();
    } catch (approveError) {
      toast.error(approveError instanceof Error ? approveError.message : "Failed to approve report");
    } finally {
      setApproving(false);
    }
  };

  const sendApprovedEmail = async () => {
    if (!data?.snapshot?.id || !emailRecipient.trim()) return;
    setSendingEmail(true);
    if (
      data.emailDelivery?.status === "PROVIDER_STARTED" &&
      Date.now() - new Date(data.emailDelivery.attemptedAt).getTime() >= 10 * 60 * 1000
    ) {
      // A fresh click after the recovery window is an explicit operator retry.
      emailIdempotencyKey.current = null;
    }
    emailIdempotencyKey.current ??= crypto.randomUUID();
    try {
      const res = await fetch("/api/reports/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          snapshotId: data.snapshot.id,
          recipient: emailRecipient.trim(),
          idempotencyKey: emailIdempotencyKey.current,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (payload.attempt?.status === "ACCEPTED") {
        toast.success("Email provider accepted the report. Inbox delivery is not confirmed.");
      } else if (payload.attempt?.status === "DEFINITIVE_FAILED") {
        toast.error("The email provider rejected the report send.");
      } else if (payload.attempt?.status === "AMBIGUOUS" || res.status === 202) {
        toast.error(payload.attempt?.status === "PROVIDER_STARTED"
          ? "The send is still in progress. Wait for its outcome before trying again."
          : "The email outcome is unknown. Check the delivery record before sending again.");
      } else if (!res.ok) {
        throw new Error(payload.error || "Could not email this report");
      }
      if (payload.attempt?.status !== "PROVIDER_STARTED" && payload.attempt?.status !== "AMBIGUOUS") {
        emailIdempotencyKey.current = null;
      }
      await revalidate();
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : "Could not email this report");
    } finally {
      setSendingEmail(false);
    }
  };

  if (!enabled) {
    return (
      <section className={cn(CARD, "relative z-10")} aria-label="Verified Weekly Performance Blueprint">
        <BlueprintHeader status={null} lifecycleState={null} />
        {clients.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-12 w-12" />}
            title="No clients yet"
            description="Add a client first, then configure its reporting requirements to generate a verified report."
            primaryAction={
              <Link
                href="/clients"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                Go to Clients
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Sparkles className="h-12 w-12" />}
            title="Select a client"
            description="Choose a client above to generate its Verified Weekly Performance report."
          />
        )}
      </section>
    );
  }

  const report = data?.report ?? null;
  const snapshot = data?.snapshot ?? null;
  const isStale = snapshot?.freshness.freshness === "STALE";
  const canSendEmail = Boolean(
    snapshot?.freshness.freshness === "CURRENT"
    && data?.lifecycle?.dataStatus === "READY"
    && data.lifecycle.approvalStatus === "APPROVED"
    && data?.canEmailApprovedReports === true,
  );
  const latestEmailAttempt = data?.emailDelivery ?? null;
  const emailSendInProgress = Boolean(
    latestEmailAttempt?.status === "PROVIDER_STARTED"
    && Date.now() - new Date(latestEmailAttempt.attemptedAt).getTime() < 10 * 60 * 1000,
  );
  const emailOutcomeAmbiguous = latestEmailAttempt?.status === "AMBIGUOUS";
  const displayedWindow = report?.overview.reportingWindow
    ?? data?.defaultWindow
    ?? null;
  const effectiveStatus = snapshot?.verification.status
    ?? report?.overview.readiness.status
    ?? null;
  const workflowSteps = [
    { id: "report-setup", label: "Setup", complete: requirementsConfigured, current: !requirementsConfigured, detail: requirementsConfigured ? "Configured" : "Requirements" },
    { id: "report-generate", label: "Generate", complete: Boolean(snapshot), current: requirementsConfigured && !snapshot, detail: snapshot ? `Snapshot v${snapshot.sequence}` : "Create snapshot" },
    { id: "report-review", label: "Review", complete: Boolean(snapshot && snapshot.freshness.freshness === "CURRENT" && snapshot.verification.status === "VERIFIED"), current: Boolean(snapshot && snapshot.freshness.freshness === "CURRENT" && snapshot.verification.status !== "VERIFIED"), detail: snapshot?.verification.status === "VERIFIED" ? "All checks passed" : snapshot ? "Check evidence" : "Await snapshot" },
    { id: "report-approve", label: "Approve", complete: data?.lifecycle?.approvalStatus === "APPROVED", current: Boolean(snapshot && data?.lifecycle?.approvalStatus !== "APPROVED"), detail: data?.lifecycle?.approvalStatus === "APPROVED" ? "Approved" : "Human review" },
    { id: "report-deliver", label: "Deliver", complete: latestEmailAttempt?.status === "ACCEPTED", current: data?.lifecycle?.approvalStatus === "APPROVED" && latestEmailAttempt?.status !== "ACCEPTED", detail: latestEmailAttempt?.status === "ACCEPTED" ? "Provider accepted" : "Send approved report" },
  ];

  return (
    <section className={cn(CARD, "relative z-10")} aria-label="Verified Weekly Performance Blueprint">
      <BlueprintHeader status={effectiveStatus} lifecycleState={data?.lifecycleState ?? null} />

      <nav aria-label="Report workflow" className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {workflowSteps.map((step, index) => (
          <a key={step.id} href={`#${step.id}`} className={cn(
            "group rounded-lg border px-3 py-2 transition-colors hover:border-white/20 hover:bg-white/[0.03]",
            step.complete ? "border-emerald-500/25 bg-emerald-500/[0.04]" : step.current ? "border-line bg-panel" : "border-line/70 bg-canvas/60",
          )}>
            <span className="flex items-center gap-2 text-xs font-semibold text-ink"><span className={cn("flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[10px]", step.complete ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-line bg-canvas text-ink-mute")}>{step.complete ? "✓" : index + 1}</span>{step.label}</span>
            <span className="mt-1 block pl-7 text-[10px] text-ink-mute">{step.detail}</span>
          </a>
        ))}
      </nav>

      {/* Client selector (chips, consistent with the Reports page) */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">Client</span>
        {clients.map((client) => (
          <button
            key={client.id}
            type="button"
            onClick={() => onClientChange(client.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              selectedClientId === client.id
                ? "border-line bg-white/[0.06] text-ink"
                : "border-line bg-panel text-ink-mute hover:text-ink",
            )}
          >
            {client.name}
          </button>
        ))}
      </div>

      {/* Reporting context shown BEFORE generation. Requirements come from the
          client's explicit configuration (Clients page), never from sources. */}
      <div id="report-setup" className="mt-4 scroll-mt-24 grid grid-cols-1 gap-3 rounded-lg border border-line bg-canvas p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <ContextItem label="Reporting timezone" value={report?.overview.reportingTimezone ?? "Unverified"} />
        <ContextItem label="Currency" value={report?.overview.currency ?? "Unverified"} />
        <ContextItem
          label="Required providers"
          value={(clientRequirement?.requiredProviders ?? []).map((p) => {
            const label = PROVIDER_LABELS[p] ?? p;
            // Blueprint v1 scope: the three paid-media providers only.
            return p === "google_ads" || p === "meta_ads" || p === "tiktok_business" ? label : `${label} (unsupported in blueprint v1)`;
          }).join(", ") || "Not configured"}
        />
        <ContextItem
          label="Required destinations"
          value={(clientRequirement?.requiredDestinations ?? []).join(", ") || "Not configured"}
        />
      </div>

      {/* Window controls */}
      <div id="report-generate" className="mt-4 scroll-mt-24 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex items-center gap-1.5 text-xs font-medium text-ink-mute">
          From
          <input
            type="date"
            value={windowStart}
            onChange={(event) => setWindowStart(event.target.value)}
            className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-ink-mute">
          To
          <input
            type="date"
            value={windowEnd}
            onChange={(event) => setWindowEnd(event.target.value)}
            className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs text-ink"
          />
        </label>
        <button
          type="button"
          onClick={applyDefaultWindow}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
        >
          <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
          Last complete week
        </button>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Link
            href={clientSetupHref(selectedClientId)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Requirements
          </Link>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
          >
            {generating
              ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
              : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {generating ? "Generating…" : "Generate report"}
          </button>
        </div>
      </div>

      {!requirementsConfigured ? (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Reporting requirements are not configured for this client yet. An owner or admin must choose required
          providers and destinations before a verified report can be generated.{" "}
          <Link className="font-semibold underline" href={clientSetupHref(selectedClientId)}>
            Open this client&apos;s reporting setup
          </Link>
        </p>
      ) : null}

      {generateError?.code === "requirements_not_configured" ? (
        <p role="alert" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          {generateError.message}{" "}
          <Link className="font-semibold underline" href={clientSetupHref(selectedClientId)}>
            Open this client&apos;s reporting setup
          </Link>
        </p>
      ) : null}

      <details className="mt-4 rounded-lg border border-line bg-canvas p-3 text-xs">
        <summary className="cursor-pointer font-medium text-ink">Check prerequisites for this client</summary>
        <ClientSetupChecklistContainer
          key={`${workspaceId}:${selectedClientId}:${windowStart}-${windowEnd}`}
          workspaceId={workspaceId}
          clientId={selectedClientId}
          clientName={clients.find((client) => client.id === selectedClientId)?.name}
          windowStart={windowStart || undefined}
          windowEnd={windowEnd || undefined}
        />
      </details>

      {/* Loading / error states */}
      {isLoading ? <BlueprintSkeleton /> : null}
      {!isLoading && error ? (
        <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">Blueprint could not load</p>
              <p className="mt-1 text-xs text-red-200/80">{error instanceof Error ? error.message : String(error)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void revalidate()}
            className="inline-flex shrink-0 items-center gap-2 rounded-md border border-red-400/30 bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-900/40"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : null}

      {/* Lifecycle & Human Approval Section */}
      {!isLoading && !error && snapshot ? (
        <div id="report-approve" className="mt-4 scroll-mt-24 rounded-lg border border-line bg-canvas p-4 text-xs">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">Report Status</span>
              <LifecycleBadge state={(data?.lifecycle?.summaryLabel ?? data?.lifecycleState ?? "Not ready to review") as ReportLifecycleState} />
            </div>

            {/* Authenticated approval action */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void approve()}
                disabled={
                  approving ||
                  !snapshot ||
                  (data?.lifecycle?.dataStatus ?? report?.overview.readiness.dataStatus ?? report?.overview.readiness.status) !== "READY" ||
                  data?.lifecycle?.approvalStatus === "APPROVED"
                }
                title={
                  (data?.lifecycle?.dataStatus ?? report?.overview.readiness.dataStatus ?? report?.overview.readiness.status) !== "READY"
                    ? "Data readiness must be READY before approval"
                    : data?.lifecycle?.approvalStatus === "APPROVED"
                      ? "Report is already approved"
                      : "Approve this report snapshot"
                }
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  data?.lifecycle?.approvalStatus !== "APPROVED" && (data?.lifecycle?.dataStatus ?? report?.overview.readiness.dataStatus ?? report?.overview.readiness.status) === "READY"
                    ? "bg-emerald-600 text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    : "border border-line bg-panel text-ink-mute disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {approving ? (
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {approving
                  ? "Approving…"
                  : data?.lifecycle?.approvalStatus === "APPROVED"
                    ? "Approved"
                    : "Approve this report"}
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line/60 pt-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">1. Data Readiness</p>
              <p className="mt-0.5 font-medium text-ink">
                {(data?.lifecycle?.dataStatus ?? report?.overview.readiness.dataStatus ?? report?.overview.readiness.status) === "READY" ? (
                  <span className="text-emerald-400">Ready to review (data complete)</span>
                ) : (
                  <span className="text-amber-400">
                    Not ready (status: {data?.lifecycle?.dataStatus ?? report?.overview.readiness.dataStatus ?? report?.overview.readiness.status})
                  </span>
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">2. Human Approval</p>
              <p className="mt-0.5 font-medium text-ink">
                {data?.lifecycle?.approvalStatus === "APPROVED" && data?.approval ? (
                  <span className="text-emerald-400">
                    Approved by {data.approval.approvedByUserName || data.approval.approvedByUserEmail || data.approval.approvedByUserId} on{" "}
                    {new Date(data.approval.approvedAt).toLocaleDateString()}
                  </span>
                ) : data?.lifecycle?.approvalStatus === "OUTDATED" ? (
                  <span className="text-amber-400">
                    Approval outdated {data?.approval ? `(prior approval: ${new Date(data.approval.approvedAt).toLocaleDateString()})` : ""} — re-approval required
                  </span>
                ) : (
                  <span className="text-ink-mute">Not approved</span>
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">3. Dataset Retrieval Evidence</p>
              <p className="mt-0.5 font-medium text-ink">
                {data?.lifecycle?.deliveryStatus === "DELIVERED" ? (
                  <span className="text-emerald-400">Current retrieval proof · report email not confirmed</span>
                ) : data?.lifecycle?.deliveryStatus === "OUTDATED" ? (
                  <span className="text-amber-400">Retrieval evidence is outdated</span>
                ) : data?.lifecycle?.deliveryStatus === "FAILED" ? (
                  <span className="text-red-400">Destination retrieval failed</span>
                ) : (
                  <span className="text-ink-mute">No current dataset retrieval proof</span>
                )}
              </p>
            </div>
          </div>
          <div id="report-deliver" className="mt-4 scroll-mt-24 border-t border-line/60 pt-4">
            <h3 className="text-xs font-semibold text-ink">Email this approved snapshot</h3>
            <p className="mt-1 text-[11px] text-ink-mute">
              Sends the saved snapshot shown below. The email provider’s acceptance does not confirm inbox delivery.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1 text-[11px] font-medium text-ink-mute">
                Recipient email
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={emailRecipient}
                  onChange={(event) => setEmailRecipient(event.target.value)}
                  placeholder="name@example.com"
                  className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink"
                />
              </label>
              <button
                type="button"
                onClick={() => void sendApprovedEmail()}
                disabled={sendingEmail || emailSendInProgress || emailOutcomeAmbiguous || !canSendEmail || !emailRecipient.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                title={emailOutcomeAmbiguous
                  ? "Reconcile the existing provider outcome before retrying"
                  : !canSendEmail ? "A current snapshot with READY data and an active approval is required" : undefined}
              >
                {sendingEmail ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                {sendingEmail ? "Sending…" : "Send approved report"}
              </button>
            </div>
            {latestEmailAttempt ? (
              <p role="status" className={cn(
                "mt-2 text-[11px]",
                latestEmailAttempt.status === "ACCEPTED" ? "text-emerald-400"
                  : latestEmailAttempt.status === "DEFINITIVE_FAILED" ? "text-red-400"
                    : "text-amber-300",
              )}>
                {latestEmailAttempt.status === "ACCEPTED"
                  ? `Accepted by email provider for ${latestEmailAttempt.recipient}; inbox delivery is not confirmed.`
                  : latestEmailAttempt.status === "DEFINITIVE_FAILED"
                    ? `Email provider rejected the send to ${latestEmailAttempt.recipient}.`
                    : latestEmailAttempt.status === "AMBIGUOUS"
                      ? `Outcome is unknown for ${latestEmailAttempt.recipient}; reconcile provider records before any retry.`
                      : `A send to ${latestEmailAttempt.recipient} is still processing or has an unknown outcome.`}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Staleness banner */}
      {!isLoading && !error && snapshot && isStale ? (
        <div role="status" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <p className="font-semibold">This saved report is stale — underlying data, requirements or delivery evidence changed after generation.</p>
          <ul className="mt-1 list-inside list-disc text-amber-200/80">
            {snapshot.freshness.staleReasons.map((reason) => (
              <li key={reason.code}>{reason.label}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-950/40 px-3 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-900/40 disabled:opacity-60"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Regenerate from current data
          </button>
        </div>
      ) : null}

      {/* Report content */}
      {!isLoading && !error && report ? (
        <div id="report-review" className="mt-5 scroll-mt-24 space-y-5">
          <details className="rounded-lg border border-line bg-canvas p-3 text-xs text-ink-mute">
            <summary className="cursor-pointer font-semibold text-ink">Evidence &amp; blockers</summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <EvidenceItem label="Verification" value={snapshot?.verification.status ?? report.overview.verification.status} />
              <EvidenceItem label="Readiness" value={report.overview.readiness.status} />
              <EvidenceItem label="Blockers" value={report.overview.readiness.blockers.join(", ") || "None"} />
              <EvidenceItem label="Warnings" value={report.overview.readiness.warnings.join(", ") || "None"} />
              <EvidenceItem label="Delivery evidence" value={report.overview.readiness.destinationState} />
              <EvidenceItem label="Verification reasons" value={(snapshot?.verification.reasons ?? report.overview.verification.reasons).join(", ") || "None"} />
              <EvidenceItem label="Included providers" value={report.overview.includedProviders.join(", ") || "None"} />
              <EvidenceItem label="Generated at" value={new Date(snapshot?.generatedAt ?? report.overview.generatedAt).toLocaleString()} />
              <EvidenceItem label="Snapshot" value={snapshot ? `${snapshot.id} · v${snapshot.sequence}` : "Not saved"} />
              <EvidenceItem label="Dependency hash" value={(snapshot?.dependencyHash ?? "").slice(0, 16) || "—"} />
            </dl>
            <p className="mt-2 text-[10px] text-ink-mute">
              Verification is derived from the shared reporting-readiness evaluator and current delivery receipts;
              a report is customer-facing VERIFIED only when readiness is READY and every gate passes. Warnings,
              unknowns and stale evidence never verify.
            </p>
          </details>

          {/* Cross-channel totals */}
          <div>
            {(() => {
              const totalsUnavailable = Boolean(report.totals.unavailable || report.totals.scope === "unavailable");
              return (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">
                      Cross-channel totals {displayedWindow ? <span className="font-normal text-ink-mute">· {displayedWindow.start} → {displayedWindow.end}</span> : null}
                    </h3>
                    {totalsUnavailable ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        Totals unavailable: the same provider account is assigned through multiple source connections — no partial totals are shown
                      </span>
                    ) : report.totals.monetaryAvailable ? null : (
                      <span className="rounded-full border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                        Monetary totals blocked: mixed or unknown currencies — shown per provider
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    <MetricCard label="Spend" value={formatMetric(totalsUnavailable ? null : report.totals.spend, report.totals.currency, "money")} />
                    <MetricCard label="Impressions" value={formatMetric(totalsUnavailable ? null : report.totals.impressions, null, "count")} />
                    <MetricCard label="Clicks" value={formatMetric(totalsUnavailable ? null : report.totals.clicks, null, "count")} />
                    <MetricCard label="CTR" value={formatMetric(totalsUnavailable ? null : report.totals.ctr, null, "percent")} />
                    <MetricCard label="CPC" value={formatMetric(totalsUnavailable ? null : report.totals.cpc, report.totals.currency, "money")} />
                    <MetricCard label="Conversions" value={formatMetric(totalsUnavailable ? null : report.totals.conversions, null, "count")} />
                    <MetricCard label="Conversion value" value={formatMetric(totalsUnavailable ? null : report.totals.conversionValue, report.totals.currency, "money")} />
                    <MetricCard label="CPA" value={formatMetric(totalsUnavailable ? null : report.totals.cpa, report.totals.currency, "money")} />
                    <MetricCard label="ROAS" value={formatMetric(totalsUnavailable ? null : report.totals.roas, null, "ratio")} />
                    <MetricCard
                      label="Currency"
                      value={totalsUnavailable ? "—" : (report.totals.currency ?? "—")}
                      hint={totalsUnavailable ? "Unavailable" : report.totals.scope === "by_provider_only" ? "Per provider" : "Combined"}
                    />
                  </div>
                </>
              );
            })()}
          </div>

          {/* Provider breakdown */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Provider breakdown</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {report.providers.map((provider) => (
                <div key={provider.provider} className="rounded-lg border border-line bg-canvas p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">{provider.providerLabel}</p>
                    {provider.status === "ambiguous" ? (
                      <span className="rounded-full border border-amber-500/40 bg-amber-950/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        Ambiguous account sources
                      </span>
                    ) : provider.status === "unsupported" ? (
                      <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                        Out of scope
                      </span>
                    ) : provider.included ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-ink">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Included
                      </span>
                    ) : (
                      <span className="rounded-full border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                        No data
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-mute">
                    <span>Spend: <span className="font-medium text-ink">{formatMetric(provider.metrics?.spend ?? null, provider.metrics?.currency ?? null, "money")}</span></span>
                    <span>ROAS: <span className="font-medium text-ink">{formatMetric(provider.metrics?.roas ?? null, null, "ratio")}</span></span>
                    <span>Clicks: <span className="font-medium text-ink">{formatMetric(provider.metrics?.clicks ?? null, null, "count")}</span></span>
                    <span>CTR: <span className="font-medium text-ink">{formatMetric(provider.metrics?.ctr ?? null, null, "percent")}</span></span>
                    <span>Conv.: <span className="font-medium text-ink">{formatMetric(provider.metrics?.conversions ?? null, null, "count")}</span></span>
                    <span>CPA: <span className="font-medium text-ink">{formatMetric(provider.metrics?.cpa ?? null, provider.metrics?.currency ?? null, "money")}</span></span>
                  </div>
                  <p className="mt-2 text-[10px] text-ink-mute">
                    Data through: {provider.dataThrough ?? "no data yet"}
                    {" · "}WoW spend: {deltaLabel(provider.changes.find((change) => change.field === "spend"))}
                  </p>
                  <p className="mt-1.5 rounded-md bg-white/[0.02] px-2 py-1.5 text-[10px] leading-relaxed text-ink-mute">{provider.explanation}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign table */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Campaigns</h3>
              <p className="text-[11px] text-ink-mute">
                Showing {report.campaigns.length} of {report.campaignTotal} tracked campaigns
                {report.campaignTruncated ? " (bounded snapshot)" : ""}
              </p>
            </div>
            {report.campaigns.length === 0 ? (
              <p className="rounded-lg border border-line bg-canvas p-4 text-xs text-ink-mute">
                No campaign-level rows exist for the required providers in this window.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">Campaign performance for {report.overview.clientName}</caption>
                  <thead>
                    <tr className="border-b border-line text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                      <th className="py-2.5 pr-4">Provider</th>
                      <th className="py-2.5 pr-4">Campaign</th>
                      <th className="py-2.5 pr-4">Campaign ID</th>
                      <th className="py-2.5 pr-4 text-right">Spend</th>
                      <th className="py-2.5 pr-4 text-right">Impr.</th>
                      <th className="py-2.5 pr-4 text-right">Clicks</th>
                      <th className="py-2.5 pr-4 text-right">Conv.</th>
                      <th className="py-2.5 pr-4 text-right">Conv. value</th>
                      <th className="py-2.5 pr-4 text-right">CPA</th>
                      <th className="py-2.5 pr-4 text-right">ROAS</th>
                      <th className="py-2.5 text-right">Spend Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.campaigns.map((campaign) => (
                      <tr key={`${campaign.provider}:${campaign.accountId}:${campaign.campaignId}:${campaign.currency ?? ""}`} className="border-b border-line">
                        <td className="py-2 pr-4 text-ink-mute">{campaign.providerLabel}</td>
                        <td className="py-2 pr-4 max-w-[220px] truncate font-medium text-ink" title={campaign.campaignName}>{campaign.campaignName}</td>
                        <td className="py-2 pr-4 font-mono text-[11px] text-ink-mute" title={campaign.campaignId}>{campaign.campaignId}</td>
                        <td className="py-2 pr-4 text-right text-ink">{formatMetric(campaign.spend, campaign.currency, "money")}</td>
                        <td className="py-2 pr-4 text-right text-ink-mute">{formatMetric(campaign.impressions, null, "count")}</td>
                        <td className="py-2 pr-4 text-right text-ink-mute">{formatMetric(campaign.clicks, null, "count")}</td>
                        <td className="py-2 pr-4 text-right text-ink-mute">{formatMetric(campaign.conversions, null, "count")}</td>
                        <td className="py-2 pr-4 text-right text-ink">{formatMetric(campaign.conversionValue, campaign.currency, "money")}</td>
                        <td className="py-2 pr-4 text-right text-ink-mute">{formatMetric(campaign.cpa, campaign.currency, "money")}</td>
                        <td className="py-2 pr-4 text-right text-ink-mute">{formatMetric(campaign.roas, null, "ratio")}</td>
                        <td className="py-2 text-right font-medium text-ink">{deltaLabel(campaign.changes.find((change) => change.field === "spend"))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* No snapshot yet for this window (requirements configured) */}
      {!isLoading && !error && requirementsConfigured && !report && !generating ? (
        <p className="mt-4 rounded-lg border border-line bg-canvas p-4 text-xs text-ink-mute">
          No saved snapshot exists for this window yet. Generate the report to produce a deterministic, reproducible preview
          from existing warehouse data.
        </p>
      ) : null}
    </section>
  );
}

function BlueprintHeader({
  status,
  lifecycleState,
}: {
  status: string | null;
  lifecycleState?: ReportLifecycleState | null;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ink" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink">Weekly Paid Media Performance</h2>
          <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink-mute">Blueprint v1</span>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-ink-mute">
          One opinionated, verified weekly client report for Google Ads, Meta Ads and TikTok Ads, built from
          Monstera&apos;s warehouse, shared readiness evaluation and delivery receipts. Never calls ad platforms
          directly and never converts currency; marketplace providers are out of scope for this blueprint.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {lifecycleState ? <LifecycleBadge state={lifecycleState} /> : null}
        <VerificationBadge status={status ?? "UNKNOWN"} />
      </div>
    </div>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">{label}</p>
      <p className="mt-0.5 truncate font-medium text-ink" title={value}>{value}</p>
    </div>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 font-semibold text-ink-mute">{label}:</dt>
      <dd className="min-w-0 break-all text-ink">{value}</dd>
    </div>
  );
}

function BlueprintSkeleton() {
  return (
    <div className="mt-5 space-y-4" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-lg border border-line bg-canvas" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-lg border border-line bg-canvas" />
      <div className="h-48 animate-pulse rounded-lg border border-line bg-canvas" />
      <p className="flex items-center gap-1.5 text-[11px] text-ink-mute">
        <Clock className="h-3 w-3" aria-hidden="true" />
        Reopening the saved snapshot…
      </p>
    </div>
  );
}
