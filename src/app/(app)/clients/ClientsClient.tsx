"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import {
  Plus,
  X,
  Briefcase,
  LineChart,
  DatabaseZap,
  Calendar,
  Mail,
  Trash2,
  Pencil,
  Building2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  Check,
  ArrowRight,
  ExternalLink,
  Layers,
  Sparkles,
  ShieldAlert,
  Send,
  Flame,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/PageShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { formatLastSyncLabel } from "@/lib/source-list-display";
import {
  deriveClientHealth,
  summarizeWorkspacesPortfolio,
  summarizeClientsPortfolio,
  type WorkspacePortfolioItem,
  type ClientWithConnections,
} from "@/lib/agency-portfolio";
import { ScheduleReportModal, type ReportScheduleData } from "@/components/clients/ScheduleReportModal";
import { AnomalyDetailsModal } from "@/components/clients/AnomalyDetailsModal";
import type { MarketingAnomaly } from "@/lib/marketing-anomalies";
import { ReportReadinessPanel, readinessFetcher } from "@/components/reports/ReportReadinessPanel";
import type { ReportReadinessEvaluation } from "@/lib/report-readiness";

type ReportSchedule = ReportScheduleData & {
  createdAt?: string;
  updatedAt?: string;
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to load");
  return data;
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getProviderLogo(provider: string): string | null {
  if (provider === "meta_ads") return INTEGRATION_LOGOS.meta;
  if (provider === "google_ads") return INTEGRATION_LOGOS.googleAds;
  if (provider === "tiktok_business") return INTEGRATION_LOGOS.tiktok;
  if (provider === "shopee") return INTEGRATION_LOGOS.shopee;
  if (provider === "lazada") return INTEGRATION_LOGOS.lazada;
  if (provider === "shopify") return INTEGRATION_LOGOS.shopify;
  if (provider === "amazon") return INTEGRATION_LOGOS.amazon;
  return null;
}

export function ClientsClient() {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
  const { mutate } = useSWRConfig();

  const clientsKey = activeWorkspaceId ? `/api/clients?workspaceId=${activeWorkspaceId}` : null;
  const { data: clients, error: clientsError, isLoading: clientsLoading } = useSWR<ClientWithConnections[]>(
    clientsKey,
    fetcher
  );

  const schedulesKey = activeWorkspaceId ? `/api/report-schedules?workspaceId=${activeWorkspaceId}` : null;
  const { data: readinessPages, error: readinessError, isLoading: readinessLoading, isValidating: readinessValidating, mutate: recheckReadiness, size: readinessSize, setSize: setReadinessSize } = useSWRInfinite<{
    evaluations: ReportReadinessEvaluation[]; nextCursor: string | null;
  }>((index, previous) => {
    if (!activeWorkspaceId || (index > 0 && !previous?.nextCursor)) return null;
    const params = new URLSearchParams({ workspaceId: activeWorkspaceId });
    if (index > 0) params.set("after", previous.nextCursor);
    return `/api/reports/readiness?${params}`;
  }, readinessFetcher, { keepPreviousData: false, persistSize: false, errorRetryCount: 1 });
  const readinessByClient = new Map((readinessPages?.flatMap(page => page.evaluations) ?? []).filter(e => e.workspaceId === activeWorkspaceId).map(e => [e.clientId, e]));
  const { data: schedules } = useSWR<ReportSchedule[]>(schedulesKey, fetcher);

  const anomaliesKey = activeWorkspaceId ? `/api/anomalies?workspaceId=${activeWorkspaceId}` : null;
  const { data: anomaliesData } = useSWR<{
    anomalies: MarketingAnomaly[];
    summary: { total: number; critical: number; warning: number };
    byClient: Record<string, { clientName: string; anomalies: MarketingAnomaly[] }>;
  }>(anomaliesKey, fetcher);

  const { data: workspaces, error: workspacesError, isLoading: workspacesLoading } = useSWR<WorkspacePortfolioItem[]>(
    "/api/workspaces",
    fetcher
  );

  const activeWorkspace = useMemo(() => {
    if (!Array.isArray(workspaces) || !activeWorkspaceId) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  }, [workspaces, activeWorkspaceId]);

  // Portfolio controls
  const [viewMode, setViewMode] = useState<"clients" | "workspaces">("clients");
  const [statusFilter, setStatusFilter] = useState<"all" | "attention" | "healthy" | "anomalies">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // CRUD Form states
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // New Modal States
  const [selectedClientForSchedule, setSelectedClientForSchedule] = useState<ClientWithConnections | null>(null);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [selectedAnomalies, setSelectedAnomalies] = useState<{ clientName?: string; anomalies: MarketingAnomaly[] } | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setLogoUrl("");
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (c: ClientWithConnections) => {
    setEditingId(c.id);
    setName(c.name);
    setDescription(c.description ?? "");
    setLogoUrl(c.logoUrl ?? "");
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    resetForm();
  };

  const saveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkspaceId || !name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingId,
            workspaceId: activeWorkspaceId,
            name: name.trim(),
            description: description.trim() || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to update client");
        toast.success("Client updated.");
      } else {
        const res = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: activeWorkspaceId,
            name: name.trim(),
            description: description.trim() || undefined,
            logoUrl: logoUrl.trim() || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to create client");
        toast.success(`Client “${data.name}” created.`);
      }
      await mutate(clientsKey);
      closeForm();
    } catch (err: any) {
      toast.error(err?.message || "Could not save client.");
    } finally {
      setSaving(false);
    }
  };

  const deleteClient = async (c: ClientWithConnections) => {
    if (!activeWorkspaceId) return;
    if (!window.confirm(`Delete client “${c.name}”? This won't delete their sources or pipelines, just the grouping.`))
      return;
    try {
      const res = await fetch(
        `/api/clients?id=${encodeURIComponent(c.id)}&workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete client");
      toast.success("Client deleted.");
      await mutate(clientsKey);
    } catch (err: any) {
      toast.error(err?.message || "Could not delete client.");
    }
  };

  const scheduleByClient = useMemo(() => {
    const m = new Map<string, ReportSchedule>();
    for (const s of schedules ?? []) {
      if (s.clientId) m.set(s.clientId, s);
    }
    return m;
  }, [schedules]);

  const openScheduleModalFor = (client: ClientWithConnections) => {
    setSelectedClientForSchedule(client);
    setIsScheduleModalOpen(true);
  };

  const openAnomaliesModal = (clientName?: string, anomalies?: MarketingAnomaly[]) => {
    setSelectedAnomalies({
      clientName,
      anomalies: anomalies || anomaliesData?.anomalies || [],
    });
  };

  // Summaries
  const workspacesList = useMemo(() => (Array.isArray(workspaces) ? workspaces : []), [workspaces]);
  const clientsList = useMemo(() => (Array.isArray(clients) ? clients : []), [clients]);

  const workspacesSummary = useMemo(() => summarizeWorkspacesPortfolio(workspacesList), [workspacesList]);
  const clientsSummary = useMemo(() => summarizeClientsPortfolio(clientsList), [clientsList]);

  // Filtering
  const filteredClients = useMemo(() => {
    return clientsList.filter((c) => {
      const h = deriveClientHealth(c);
      if (statusFilter === "attention" && h.status !== "needs_attention") return false;
      if (statusFilter === "healthy" && h.status !== "healthy") return false;
      if (statusFilter === "anomalies") {
        const brandAnomalies = anomaliesData?.byClient?.[c.id]?.anomalies || [];
        if (brandAnomalies.length === 0) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchDesc = (c.description || "").toLowerCase().includes(q);
        if (!matchName && !matchDesc) return false;
      }
      return true;
    });
  }, [clientsList, statusFilter, searchQuery, anomaliesData]);

  const filteredWorkspaces = useMemo(() => {
    return workspacesList.filter((ws) => {
      const isAttention = ws.health.status === "error" || (ws.health.failingConnections ?? 0) > 0;
      if (statusFilter === "attention" && !isAttention) return false;
      if (statusFilter === "healthy" && ws.health.status !== "healthy") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = ws.name.toLowerCase().includes(q);
        const matchSlug = ws.slug.toLowerCase().includes(q);
        if (!matchName && !matchSlug) return false;
      }
      return true;
    });
  }, [workspacesList, statusFilter, searchQuery]);

  const switchWorkspace = (wsId: string, wsName: string) => {
    setActiveWorkspaceId(wsId);
    toast.success(`Switched active workspace to “${wsName}”`);
  };

  return (
    <PageShell>
      {/* ─── 1. PORTFOLIO HEADER ─── */}
      <div className="relative z-10 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Agency Portfolio</h1>
            <span className="rounded-full bg-white/[0.06] border border-line px-2 py-0.5 text-[10px] font-mono text-ink-mute">
              {viewMode === "clients" ? `${clientsList.length} Brands` : `${workspacesList.length} Workspaces`}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-mute">
            {viewMode === "clients"
              ? `Client brands in ${activeWorkspace?.name || "current workspace"} · grouped sources and reporting.`
              : "Cross-workspace health triage across all managed agency accounts."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented View Switcher */}
          <div className="flex items-center rounded-lg border border-line bg-panel p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => { setViewMode("clients"); setStatusFilter("all"); }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
                viewMode === "clients"
                  ? "bg-white/[0.12] text-ink font-semibold shadow-xs"
                  : "text-ink-mute hover:text-ink"
              )}
            >
              <Briefcase className="h-3.5 w-3.5" />
              Client Brands ({clientsList.length})
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("workspaces"); setStatusFilter("all"); }}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors",
                viewMode === "workspaces"
                  ? "bg-white/[0.12] text-ink font-semibold shadow-xs"
                  : "text-ink-mute hover:text-ink"
              )}
            >
              <Building2 className="h-3.5 w-3.5" />
              All Workspaces ({workspacesList.length})
            </button>
          </div>

          {viewMode === "clients" ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-md bg-white hover:bg-neutral-200 px-3.5 py-1.5 text-xs font-semibold text-black transition-colors shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              New Brand
            </button>
          ) : (
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel hover:bg-white/[0.04] px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors"
            >
              <Building2 className="h-3.5 w-3.5" />
              Manage Workspaces
            </Link>
          )}
        </div>
      </div>

      {/* ─── 2. EXECUTIVE METRICS BAR ─── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-panel/60 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-mute">
            {viewMode === "clients" ? "Total Brands" : "Total Workspaces"}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">
            {viewMode === "clients" ? clientsSummary.totalClients : workspacesSummary.totalWorkspaces}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-panel/60 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-mute">
            {viewMode === "clients" ? "Assigned Sources" : "Managed Sources"}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">
            {viewMode === "clients"
              ? clientsList.reduce((s, c) => s + (c.connections?.length ?? 0), 0)
              : workspacesSummary.totalSources}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-panel/60 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-mute">Portfolio Health</p>
          <div className="mt-1 flex items-center gap-1.5">
            {(viewMode === "clients" ? clientsSummary.attentionCount : workspacesSummary.attentionCount) > 0 ? (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
                <span className="text-sm font-semibold text-red-300">
                  {viewMode === "clients" ? clientsSummary.attentionCount : workspacesSummary.attentionCount} need attention
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300">All healthy</span>
              </>
            )}
          </div>
        </div>

        <div
          onClick={() => openAnomaliesModal()}
          className={cn(
            "rounded-xl border p-4 cursor-pointer transition",
            (anomaliesData?.summary?.total ?? 0) > 0
              ? "border-rose-500/30 bg-rose-500/[0.06] hover:border-rose-500/50"
              : "border-line bg-panel/60 hover:border-white/20"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-mute">Marketing Watchdog</p>
            <ShieldAlert className={cn("w-4 h-4", (anomaliesData?.summary?.total ?? 0) > 0 ? "text-rose-400" : "text-ink-mute")} />
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight text-ink">
            {anomaliesData?.summary?.total ?? 0}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {(anomaliesData?.summary?.critical ?? 0) > 0 ? (
              <span className="text-rose-300 font-semibold">{anomaliesData?.summary?.critical} critical spend burn</span>
            ) : (anomaliesData?.summary?.total ?? 0) > 0 ? (
              <span className="text-amber-300 font-semibold">{anomaliesData?.summary?.warning} efficiency alerts</span>
            ) : (
              <span className="text-emerald-400 font-medium">Tracking healthy</span>
            )}
          </div>
        </div>
      </div>

      {/* ─── 3. SEARCH & TRIAGE FILTERS ─── */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              statusFilter === "all"
                ? "bg-white/[0.1] text-ink font-semibold border border-line"
                : "text-ink-mute hover:text-ink"
            )}
          >
            All ({viewMode === "clients" ? clientsList.length : workspacesList.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("attention")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5",
              statusFilter === "attention"
                ? "bg-red-950/40 text-red-200 font-semibold border border-red-900/50"
                : "text-ink-mute hover:text-red-300"
            )}
          >
            <AlertCircle className="h-3 w-3 text-red-400" />
            Needs Attention (
            {viewMode === "clients" ? clientsSummary.attentionCount : workspacesSummary.attentionCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("anomalies")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5",
              statusFilter === "anomalies"
                ? "bg-rose-950/40 text-rose-200 font-semibold border border-rose-900/50"
                : "text-ink-mute hover:text-rose-300"
            )}
          >
            <ShieldAlert className="h-3 w-3 text-rose-400" />
            Anomalies ({anomaliesData?.summary?.total ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("healthy")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5",
              statusFilter === "healthy"
                ? "bg-emerald-950/40 text-emerald-200 font-semibold border border-emerald-900/50"
                : "text-ink-mute hover:text-emerald-300"
            )}
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            Healthy ({viewMode === "clients" ? clientsSummary.healthyCount : workspacesSummary.healthyCount})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-mute" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={viewMode === "clients" ? "Filter brands…" : "Filter workspaces…"}
            className="w-full rounded-lg border border-line bg-panel pl-8 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-mute focus:border-white focus:outline-none"
          />
        </div>
      </div>

      {/* ─── 4. CLIENTS VIEW ─── */}
      {viewMode === "clients" && readinessPages?.at(-1)?.nextCursor ? (
        <button type="button" disabled={readinessValidating} onClick={() => void setReadinessSize(readinessSize + 1)} className="mb-3 text-xs text-ink underline disabled:opacity-50">
          {readinessValidating ? "Checking more clients…" : "Evaluate next 50 clients"}
        </button>
      ) : null}
      {viewMode === "clients" && (
        <>
          {clientsLoading ? (
            <div className="py-16 text-center text-sm text-ink-mute">Loading client portfolio…</div>
          ) : clientsError ? (
            <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
              Failed to load clients.
            </div>
          ) : filteredClients.length === 0 ? (
            <EmptyState
              icon={<Briefcase />}
              title={searchQuery || statusFilter !== "all" ? "No matching brands" : "No client brands yet"}
              description={
                searchQuery || statusFilter !== "all"
                  ? "Try adjusting your search or health filter."
                  : "Create your first brand to group sources, pipelines, and weekly report deliveries."
              }
              primaryAction={
                !searchQuery && statusFilter === "all" ? (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-white hover:bg-neutral-200 px-4 py-2 text-xs font-semibold text-black shadow-xs transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add a brand
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredClients.map((c) => {
                const health = deriveClientHealth(c);
                const schedule = scheduleByClient.get(c.id);
                const pipelineCount = c._count?.pipelines ?? 0;
                const connectionCount = c.connections?.length ?? c._count?.connections ?? 0;
                const lastSync = formatLastSyncLabel(health.latestSyncAt);

                return (
                  <div
                    key={c.id}
                    className="group relative flex flex-col rounded-xl border border-line bg-panel p-5 transition-colors hover:border-white/30"
                  >
                    {/* Header */}
                    <div className="mb-3.5 flex items-start gap-3">
                      {c.logoUrl ? (
                        <Image
                          src={c.logoUrl}
                          alt={`${c.name} logo`}
                          width={40}
                          height={40}
                          unoptimized
                          className="h-10 w-10 rounded-lg object-cover ring-1 ring-line shrink-0"
                        />
                      ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-sm font-semibold text-ink">
                          {initials(c.name) || "?"}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <h3 className="truncate text-sm font-semibold text-ink">{c.name}</h3>
                          {c.isDemo ? (
                            <span className="rounded bg-violet-950/80 border border-violet-800/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-200">
                              Demo
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-mute">
                          {c.description || "No description provided"}
                        </p>
                      </div>
                    </div>

                    {/* Health & Sources Row */}
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium", health.badgeClass)}>
                          {health.status === "healthy" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          ) : health.status === "needs_attention" ? (
                            <AlertCircle className="h-3 w-3 text-red-400" />
                          ) : (
                            <Clock className="h-3 w-3 text-ink-mute" />
                          )}
                          {health.label}
                        </span>

                        <span className="text-[11px] text-ink-mute">
                          Last sync: <strong className="text-ink font-normal">{lastSync.text}</strong>
                        </span>
                      </div>

                      {/* Provider Icons */}
                      {health.connectedProviders.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {health.connectedProviders.map((p) => {
                            const logo = getProviderLogo(p);
                            return (
                              <div
                                key={p}
                                className="flex items-center gap-1 rounded-md border border-line bg-canvas/80 px-2 py-1 text-[11px] text-ink-mute"
                              >
                                {logo ? <IntegrationMark src={logo} size="sm" /> : null}
                                <span className="capitalize">{p.replace(/_/g, " ")}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <ReportReadinessPanel
                      compact
                      evaluation={readinessByClient.get(c.id)}
                      loading={readinessLoading || readinessValidating}
                      error={Boolean(readinessError)}
                      onRetry={() => void recheckReadiness()}
                    />

                    {/* Marketing Anomaly Alert Banner */}
                    {(() => {
                      const clientAnomalies = anomaliesData?.byClient?.[c.id]?.anomalies || [];
                      if (clientAnomalies.length === 0) return null;
                      const hasCritical = clientAnomalies.some((a) => a.severity === "critical");
                      return (
                        <button
                          type="button"
                          onClick={() => openAnomaliesModal(c.name, clientAnomalies)}
                          className={cn(
                            "mb-3 w-full text-left rounded-lg border p-2.5 transition-colors group/anom",
                            hasCritical
                              ? "border-rose-900/50 bg-rose-950/30 hover:bg-rose-950/45"
                              : "border-amber-900/50 bg-amber-950/20 hover:bg-amber-950/35"
                          )}
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span
                              className={cn(
                                "font-semibold flex items-center gap-1.5",
                                hasCritical ? "text-rose-300" : "text-amber-300"
                              )}
                            >
                              <Flame className="h-3.5 w-3.5 shrink-0" />
                              {clientAnomalies.length} Anomaly {clientAnomalies.length === 1 ? "Alert" : "Alerts"}
                            </span>
                            <span
                              className={cn(
                                "text-[11px] group-hover/anom:underline flex items-center gap-0.5",
                                hasCritical ? "text-rose-400" : "text-amber-400"
                              )}
                            >
                              Triage <ArrowRight className="h-3 w-3" />
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-ink-mute truncate">
                            {clientAnomalies[0].message}
                          </p>
                        </button>
                      );
                    })()}

                    {/* Weekly Schedule Banner */}
                    {schedule ? (
                      <button
                        type="button"
                        onClick={() => openScheduleModalFor(c)}
                        className={cn(
                          "mb-4 w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors hover:border-white/30",
                          schedule.enabled
                            ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-200"
                            : "border-line bg-canvas text-ink-mute"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 font-semibold">
                            <Calendar className="h-3.5 w-3.5" />
                            {schedule.enabled ? "Auto Brief Active" : "Brief Paused"}
                          </span>
                          <span className="text-[10px] text-ink-mute uppercase tracking-wider">Edit</span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] opacity-80">{schedule.recipients}</div>
                      </button>
                    ) : null}

                    {/* Card Actions */}
                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
                      <Link
                        href={`/reports?clientId=${encodeURIComponent(c.id)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04] transition-colors"
                      >
                        <LineChart className="h-3.5 w-3.5" />
                        Reports
                      </Link>
                      <Link
                        href={`/explorer`}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04] transition-colors"
                      >
                        <DatabaseZap className="h-3.5 w-3.5" />
                        Warehouse
                      </Link>

                      {!c.isDemo ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openScheduleModalFor(c)}
                            className="inline-flex items-center gap-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink-mute hover:text-ink hover:bg-white/[0.04] transition-colors"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {schedule ? "Dispatch" : "Schedule"}
                          </button>
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(c)}
                              className="rounded-md p-1.5 text-ink-mute hover:text-ink hover:bg-white/[0.04] transition-colors"
                              aria-label="Edit brand"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteClient(c)}
                              className="rounded-md p-1.5 text-ink-mute hover:text-red-400 hover:bg-red-950/20 transition-colors"
                              aria-label="Delete brand"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ─── 5. ALL WORKSPACES VIEW ─── */}
      {viewMode === "workspaces" && (
        <>
          {workspacesLoading ? (
            <div className="py-16 text-center text-sm text-ink-mute">Loading agency workspaces…</div>
          ) : workspacesError ? (
            <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
              Failed to load workspaces.
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <EmptyState
              icon={<Building2 />}
              title="No matching workspaces"
              description="Try adjusting your search or health filter."
            />
          ) : (
            <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredWorkspaces.map((ws) => {
                const isActive = activeWorkspaceId === ws.id;
                const isError = ws.health.status === "error" || (ws.health.failingConnections ?? 0) > 0;
                const lastSync = formatLastSyncLabel(ws.health.latestSyncAt);

                return (
                  <div
                    key={ws.id}
                    className={cn(
                      "group relative flex flex-col rounded-xl border bg-panel p-5 transition-colors",
                      isActive ? "border-white/40 ring-1 ring-white/20 shadow-md" : "border-line hover:border-white/30"
                    )}
                  >
                    {/* Top Row: Name & Plan */}
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-ink">{ws.name}</h3>
                          {isActive ? (
                            <span className="inline-flex items-center gap-1 rounded bg-white/[0.08] border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink">
                              <Check className="h-3 w-3 text-emerald-400" /> Active
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-ink-mute">slug: {ws.slug}</p>
                      </div>

                      <span className="rounded-full bg-panel border border-line px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                        {ws.plan}
                      </span>
                    </div>

                    {/* Health Status */}
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
                            isError
                              ? "border-red-900/40 bg-red-950/30 text-red-300"
                              : ws.health.status === "healthy"
                              ? "border-emerald-900/40 bg-emerald-950/20 text-emerald-300"
                              : "border-line bg-canvas text-ink-mute"
                          )}
                        >
                          {isError ? (
                            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                          ) : ws.health.status === "healthy" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-ink-mute" />
                          )}
                          {isError
                            ? `${ws.health.failingConnections || 1} source(s) need attention`
                            : ws.health.status === "healthy"
                            ? "All sources healthy"
                            : "Pending initial sync"}
                        </span>

                        <span className="text-[11px] text-ink-mute">
                          Sync: <strong className="text-ink font-normal">{lastSync.text}</strong>
                        </span>
                      </div>

                      {/* Failing Details List (Immediate Triage) */}
                      {ws.health.failingDetails && ws.health.failingDetails.length > 0 ? (
                        <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-2.5 space-y-1.5 text-xs text-red-200">
                          <p className="font-semibold text-[11px] text-red-300 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> Attention required:
                          </p>
                          {ws.health.failingDetails.map((f) => (
                            <div key={f.id} className="flex items-center justify-between text-[11px]">
                              <span className="truncate">{f.name || f.provider}: {f.errorMsg || "Auth required"}</span>
                              <Link
                                href={`/sources/${f.id}`}
                                className="underline ml-2 text-red-300 hover:text-white shrink-0"
                              >
                                Fix →
                              </Link>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/* Stats Grid */}
                    <div className="mb-4 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg border border-line bg-canvas/60 p-2">
                        <p className="font-semibold text-ink">{ws.counts?.sourceConnections ?? 0}</p>
                        <p className="text-[10px] text-ink-mute">Sources</p>
                      </div>
                      <div className="rounded-lg border border-line bg-canvas/60 p-2">
                        <p className="font-semibold text-ink">{ws.counts?.clients ?? 0}</p>
                        <p className="text-[10px] text-ink-mute">Brands</p>
                      </div>
                      <div className="rounded-lg border border-line bg-canvas/60 p-2">
                        <p className="font-semibold text-ink">{ws.counts?.pipelines ?? 0}</p>
                        <p className="text-[10px] text-ink-mute">Pipelines</p>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div className="mt-auto flex items-center justify-between border-t border-line/60 pt-3">
                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => switchWorkspace(ws.id, ws.name)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-white hover:bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black transition-colors shadow-xs"
                        >
                          Switch Workspace <ArrowRight className="h-3 w-3" />
                        </button>
                      ) : (
                        <span className="text-xs font-medium text-emerald-400 flex items-center gap-1">
                          <Check className="h-3.5 w-3.5" /> Currently Active
                        </span>
                      )}

                      <div className="flex items-center gap-2">
                        <Link
                          href="/sources"
                          className="text-xs text-ink-mute hover:text-ink transition-colors"
                        >
                          Sources
                        </Link>
                        <Link
                          href="/explorer"
                          className="text-xs text-ink-mute hover:text-ink transition-colors"
                        >
                          Warehouse
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ─── MODALS ─── */}
      {/* Client Edit / Create Modal */}
      {formOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-4 sm:items-center backdrop-blur-xs">
          <form
            onSubmit={saveClient}
            className="w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">
                {editingId ? "Edit brand" : "New client brand"}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg p-1 text-ink-mute hover:bg-white/[0.06] hover:text-ink"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink">
                Brand Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aurora Retail VN"
                required
                className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:border-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="e.g. Fashion & lifestyle, Meta + Google Ads"
                className="mt-1 w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:border-white focus:outline-none"
              />
            </div>

            {!editingId ? (
              <div>
                <label className="block text-xs font-semibold text-ink">
                  Logo URL (optional)
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-ink-mute focus:border-white focus:outline-none"
                />
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-md border border-line bg-canvas px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="rounded-md bg-white hover:bg-neutral-200 px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-60 transition-colors shadow-xs"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Create brand"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Schedule Dispatch Modal */}
      {selectedClientForSchedule && activeWorkspaceId ? (
        <ScheduleReportModal
          isOpen={isScheduleModalOpen}
          onClose={() => {
            setIsScheduleModalOpen(false);
            setSelectedClientForSchedule(null);
          }}
          workspaceId={activeWorkspaceId}
          client={{ id: selectedClientForSchedule.id, name: selectedClientForSchedule.name }}
          initialSchedule={scheduleByClient.get(selectedClientForSchedule.id) || null}
          onSaved={async () => {
            if (schedulesKey) await mutate(schedulesKey);
          }}
        />
      ) : null}

      {/* Marketing Anomaly Details Modal */}
      {selectedAnomalies ? (
        <AnomalyDetailsModal
          isOpen={Boolean(selectedAnomalies)}
          onClose={() => setSelectedAnomalies(null)}
          anomalies={selectedAnomalies.anomalies}
          clientName={selectedAnomalies.clientName}
        />
      ) : null}
    </PageShell>
  );
}
