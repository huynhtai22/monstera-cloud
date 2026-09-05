"use client";

import React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertCircle,
  BadgeCheck,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Clock,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load");
  return data;
};

const SUPPORTED_PROVIDERS = [
  { id: "google_ads", label: "Google Ads" },
  { id: "meta_ads", label: "Meta Ads" },
  { id: "tiktok_business", label: "TikTok Ads" },
] as const;

const TIMEZONE_OPTIONS = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Manila",
  "UTC",
] as const;

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
  scope?: "combined" | "by_provider_only";
};

type PercentDelta = { field: string; current: number | null; previous: number | null; deltaPercent: number | null };

type BlueprintReport = {
  overview: {
    clientName: string;
    blueprintVersion: number;
    reportingWindow: { start: string; end: string };
    comparisonWindow: { start: string; end: string } | null;
    reportingTimezone: string;
    currency: string | null;
    requiredProviders: string[];
    includedProviders: string[];
    generatedAt: string;
    verification: { status: "VERIFIED" | "NOT_VERIFIED"; reasons: string[] };
    readiness: { status: "READY" | "NOT_READY" | "WARNING" | "UNKNOWN"; blockers: string[] };
  };
  totals: BlueprintMetrics;
  providers: Array<{
    provider: string;
    providerLabel: string;
    connectionCount: number;
    accountsCovered: number;
    coverageComplete: boolean;
    hasData: boolean;
    metrics: BlueprintMetrics;
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

type Requirement = {
  id: string;
  requiredProviders: string[];
  requireDestination: boolean;
  reportingTimezone: string | null;
  reportingCurrency: string | null;
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

type BlueprintPayload = {
  requirement: Requirement;
  snapshot: SnapshotState;
  report: BlueprintReport | null;
  defaultWindow: { start: string; end: string } | null;
  error?: string;
};

type GenerateResponse = {
  snapshot: { id: string; sequence: number; dependencyHash: string; verificationStatus: string; verificationReasons: string[]; generatedAt: string };
  report: BlueprintReport;
  created: boolean;
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
  const Icon = status === "WARNING" || status === "READY" ? ShieldAlert : status === "UNKNOWN" ? HelpCircle : ShieldAlert;
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
  const [showRequirements, setShowRequirements] = React.useState(false);
  const [savingRequirements, setSavingRequirements] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

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

  const requirement = data?.requirement ?? null;
  const [form, setForm] = React.useState({
    requiredProviders: [] as string[],
    requireDestination: false,
    reportingTimezone: "Asia/Ho_Chi_Minh",
    reportingCurrency: "",
  });

  React.useEffect(() => {
    if (!requirement) return;
    setForm({
      requiredProviders: [...requirement.requiredProviders],
      requireDestination: requirement.requireDestination,
      reportingTimezone: requirement.reportingTimezone ?? "Asia/Ho_Chi_Minh",
      reportingCurrency: requirement.reportingCurrency ?? "",
    });
  }, [requirement]);

  const applyDefaultWindow = React.useCallback(() => {
    setWindowStart("");
    setWindowEnd("");
  }, []);

  const saveRequirements = async () => {
    if (!workspaceId || !selectedClientId) return;
    if (form.requiredProviders.length === 0) {
      toast.error("Select at least one required provider.");
      return;
    }
    setSavingRequirements(true);
    try {
      const res = await fetch("/api/reports/blueprint/requirements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          clientId: selectedClientId,
          requiredProviders: form.requiredProviders,
          requireDestination: form.requireDestination,
          reportingTimezone: form.reportingTimezone,
          reportingCurrency: form.reportingCurrency.trim().toUpperCase(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to save requirements");
      toast.success("Reporting requirements saved.");
      setShowRequirements(false);
      await revalidate();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : "Failed to save requirements");
    } finally {
      setSavingRequirements(false);
    }
  };

  const generate = async () => {
    if (!workspaceId || !selectedClientId) return;
    setGenerating(true);
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
      const payload: GenerateResponse = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Failed to generate report");
      await revalidate();
    } catch (generateError) {
      toast.error(generateError instanceof Error ? generateError.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  if (!enabled) {
    return (
      <section className={cn(CARD, "relative z-10")} aria-label="Verified Weekly Performance Blueprint">
        <BlueprintHeader status={null} />
        {clients.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-12 w-12" />}
            title="No clients yet"
            description="Add a client first, then configure its weekly reporting requirements to generate a verified report."
            primaryAction={
              <a
                href="/clients"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                Go to Clients
              </a>
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
  const displayedWindow = report?.overview.reportingWindow
    ?? data?.defaultWindow
    ?? null;
  const effectiveStatus = snapshot?.verification.status
    ?? report?.overview.readiness.status
    ?? null;

  return (
    <section className={cn(CARD, "relative z-10")} aria-label="Verified Weekly Performance Blueprint">
      <BlueprintHeader status={effectiveStatus} />

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

      {/* Reporting context shown BEFORE generation */}
      <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-line bg-canvas p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <ContextItem label="Reporting timezone" value={report?.overview.reportingTimezone ?? requirement?.reportingTimezone ?? "Not configured"} />
        <ContextItem label="Currency" value={report?.overview.currency ?? requirement?.reportingCurrency ?? "Any single currency"} />
        <ContextItem
          label="Required providers"
          value={(requirement?.requiredProviders ?? []).map((p) => SUPPORTED_PROVIDERS.find((s) => s.id === p)?.label ?? p).join(", ") || "Not configured"}
        />
        <ContextItem
          label="Window"
          value={displayedWindow ? `${displayedWindow.start} → ${displayedWindow.end}` : "—"}
        />
      </div>

      {/* Window controls */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
          <button
            type="button"
            onClick={() => setShowRequirements((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-2 text-xs font-medium text-ink hover:bg-white/[0.04]"
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
            Requirements
            <ChevronDown className={cn("h-3 w-3 transition-transform", showRequirements && "rotate-180")} aria-hidden="true" />
          </button>
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

      {showRequirements ? (
        <div className="mt-4 rounded-lg border border-line bg-canvas p-4">
          <p className="text-xs font-semibold text-ink">Weekly reporting requirements</p>
          <p className="mt-0.5 text-[11px] text-ink-mute">
            Configured by workspace admins. Requirements are explicit — they are never inferred from connected sources.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">Required providers</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SUPPORTED_PROVIDERS.map((provider) => {
                  const active = form.requiredProviders.includes(provider.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setForm((prev) => ({
                        ...prev,
                        requiredProviders: active
                          ? prev.requiredProviders.filter((p) => p !== provider.id)
                          : [...prev.requiredProviders, provider.id],
                      }))}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                        active ? "border-primary bg-primary/10 text-ink" : "border-line bg-panel text-ink-mute hover:text-ink",
                      )}
                    >
                      {provider.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-mute">
                Timezone
                <select
                  value={form.reportingTimezone}
                  onChange={(event) => setForm((prev) => ({ ...prev, reportingTimezone: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-2 text-xs text-ink"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-ink-mute">
                Currency
                <input
                  type="text"
                  inputMode="text"
                  placeholder="VND"
                  maxLength={3}
                  value={form.reportingCurrency}
                  onChange={(event) => setForm((prev) => ({ ...prev, reportingCurrency: event.target.value.toUpperCase() }))}
                  className="mt-1 w-full rounded-lg border border-line bg-panel px-2 py-2 text-xs text-ink"
                />
              </label>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-ink-mute">
            <input
              type="checkbox"
              checked={form.requireDestination}
              onChange={(event) => setForm((prev) => ({ ...prev, requireDestination: event.target.checked }))}
              className="h-3.5 w-3.5"
            />
            Client requires delivery to a destination (verified reports then need destination evidence)
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveRequirements()}
              disabled={savingRequirements}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
            >
              {savingRequirements ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" /> : null}
              Save requirements
            </button>
            <button
              type="button"
              onClick={() => setShowRequirements(false)}
              className="rounded-md border border-line bg-panel px-3.5 py-2 text-xs font-medium text-ink-mute hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Loading / error / empty states */}
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

      {!isLoading && !error && data && !requirement ? (
        <div className="mt-4">
          <EmptyState
            icon={<Wand2 className="h-12 w-12" />}
            title="Configure reporting requirements first"
            description="Verified weekly reports need explicitly configured required providers, a reporting timezone and a currency. Open Requirements to configure them."
            primaryAction={
              <button
                type="button"
                onClick={() => setShowRequirements(true)}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                Configure requirements
              </button>
            }
          />
        </div>
      ) : null}

      {/* Staleness banner */}
      {!isLoading && !error && snapshot && isStale ? (
        <div role="status" className="mt-4 rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <p className="font-semibold">This saved report is stale — underlying data or requirements changed after generation.</p>
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
        <div className="mt-5 space-y-5">
          <details className="rounded-lg border border-line bg-canvas p-3 text-xs text-ink-mute">
            <summary className="cursor-pointer font-semibold text-ink">Evidence &amp; blockers</summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              <EvidenceItem label="Verification" value={snapshot?.verification.status ?? report.overview.verification.status} />
              <EvidenceItem label="Readiness" value={report.overview.readiness.status} />
              <EvidenceItem label="Blockers" value={report.overview.readiness.blockers.join(", ") || "None"} />
              <EvidenceItem label="Verification reasons" value={(snapshot?.verification.reasons ?? report.overview.verification.reasons).join(", ") || "None"} />
              <EvidenceItem label="Included providers" value={report.overview.includedProviders.join(", ") || "None"} />
              <EvidenceItem label="Generated at" value={new Date(snapshot?.generatedAt ?? report.overview.generatedAt).toLocaleString()} />
              <EvidenceItem label="Snapshot" value={snapshot ? `${snapshot.id} · v${snapshot.sequence}` : "Not saved"} />
              <EvidenceItem label="Dependency hash" value={(snapshot?.dependencyHash ?? "").slice(0, 16) || "—"} />
            </dl>
            <p className="mt-2 text-[10px] text-ink-mute">
              Verification is derived from the shared reporting-readiness evaluator; a report is customer-facing
              VERIFIED only when readiness is READY and every gate passes. Warnings never verify.
            </p>
          </details>

          {/* Cross-channel totals */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                Cross-channel totals {displayedWindow ? <span className="font-normal text-ink-mute">· {displayedWindow.start} → {displayedWindow.end}</span> : null}
              </h3>
              {report.totals.monetaryAvailable ? null : (
                <span className="rounded-full border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                  Monetary totals blocked: mixed or unknown currencies — shown per provider
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <MetricCard label="Spend" value={formatMetric(report.totals.spend, report.totals.currency, "money")} />
              <MetricCard label="Impressions" value={formatMetric(report.totals.impressions, null, "count")} />
              <MetricCard label="Clicks" value={formatMetric(report.totals.clicks, null, "count")} />
              <MetricCard label="CTR" value={formatMetric(report.totals.ctr, null, "percent")} />
              <MetricCard label="CPC" value={formatMetric(report.totals.cpc, report.totals.currency, "money")} />
              <MetricCard label="Conversions" value={formatMetric(report.totals.conversions, null, "count")} />
              <MetricCard label="Conversion value" value={formatMetric(report.totals.conversionValue, report.totals.currency, "money")} />
              <MetricCard label="CPA" value={formatMetric(report.totals.cpa, report.totals.currency, "money")} />
              <MetricCard label="ROAS" value={formatMetric(report.totals.roas, null, "ratio")} />
              <MetricCard label="Currency" value={report.totals.currency ?? "—"} hint={report.totals.scope === "by_provider_only" ? "Per provider" : "Combined"} />
            </div>
          </div>

          {/* Provider breakdown */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Provider breakdown</h3>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {report.providers.map((provider) => (
                <div key={provider.provider} className="rounded-lg border border-line bg-canvas p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">{provider.providerLabel}</p>
                    {provider.hasData ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-ink">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        {provider.accountsCovered}/{provider.connectionCount} accounts
                      </span>
                    ) : (
                      <span className="rounded-full border border-red-500/40 bg-red-950/30 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                        No data
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-mute">
                    <span>Spend: <span className="font-medium text-ink">{formatMetric(provider.metrics.spend, provider.metrics.currency, "money")}</span></span>
                    <span>ROAS: <span className="font-medium text-ink">{formatMetric(provider.metrics.roas, null, "ratio")}</span></span>
                    <span>Clicks: <span className="font-medium text-ink">{formatMetric(provider.metrics.clicks, null, "count")}</span></span>
                    <span>CTR: <span className="font-medium text-ink">{formatMetric(provider.metrics.ctr, null, "percent")}</span></span>
                    <span>Conv.: <span className="font-medium text-ink">{formatMetric(provider.metrics.conversions, null, "count")}</span></span>
                    <span>CPA: <span className="font-medium text-ink">{formatMetric(provider.metrics.cpa, provider.metrics.currency, "money")}</span></span>
                  </div>
                  <p className="mt-2 text-[10px] text-ink-mute">
                    Data through: {provider.dataThrough ? provider.dataThrough.slice(0, 10) : "no data yet"}
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
      {!isLoading && !error && requirement && !report && !generating ? (
        <p className="mt-4 rounded-lg border border-line bg-canvas p-4 text-xs text-ink-mute">
          No saved snapshot exists for this window yet. Generate the report to produce a deterministic, reproducible preview
          from existing warehouse data.
        </p>
      ) : null}
    </section>
  );
}

function BlueprintHeader({ status }: { status: string | null }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ink" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink">Weekly Paid Media Performance</h2>
          <span className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[10px] font-medium text-ink-mute">Blueprint v1</span>
        </div>
        <p className="mt-1 max-w-2xl text-xs text-ink-mute">
          One opinionated, verified weekly client report built from Monstera&apos;s warehouse and readiness system.
          Never calls ad platforms directly and never converts currency.
        </p>
      </div>
      <VerificationBadge status={status ?? "UNKNOWN"} />
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
