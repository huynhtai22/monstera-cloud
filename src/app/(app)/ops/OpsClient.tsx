"use client";
import React, { useEffect, useState } from "react";
import useSWR from "swr";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Database,
    Info,
    RefreshCw,
    Server,
    Unplug,
    Users,
    Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface OpsStats {
    ts: number;
    etl: {
        last24h: { total: number; success: number; error: number; rowsSynced: number; avgMs: number };
        last1h: { total: number; success: number; error: number };
        byPlatform: Array<{ platform: string; total: number; success: number; error: number; avgMs: number }>;
        errorClasses: { timeout: number; oauth: number; rateLimit: number; schema: number; other: number };
        connectionHealth: { total: number; healthy: number; error: number; stale: number };
    };
    queue: {
        byStatus: Record<string, number>;
        avgLatencyMs: number;
        backlog: number;
        failedLast1h: number;
        stuckJobs: number;
    };
    usage: {
        totalWorkspaces: number;
        newWorkspaces7d: number;
        newWorkspaces24h: number;
        totalPipelines: number;
        activePipelines: number;
        totalConnections: number;
        byProvider: Array<{ provider: string; count: number }>;
        pipelineHealth: Record<string, number>;
    };
    alerts: Array<{ level: "critical" | "warning" | "info"; message: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) =>
    fetch(url).then((r) => {
        if (!r.ok) throw new Error("Fetch failed");
        return r.json();
    });

function pct(a: number, b: number) {
    if (b === 0) return "—";
    return `${Math.round((a / b) * 100)}%`;
}

function fmtMs(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function fmtNum(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function timeAgo(ts: number) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
    return (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
            <Icon className="h-4 w-4 text-gray-400" />
            {title}
        </h2>
    );
}

function StatCard({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string | number;
    sub?: string;
    accent?: "green" | "red" | "yellow" | "blue" | "gray";
}) {
    const colors: Record<string, string> = {
        green: "text-emerald-600 dark:text-emerald-400",
        red: "text-red-600 dark:text-red-400",
        yellow: "text-amber-600 dark:text-amber-400",
        blue: "text-blue-600 dark:text-blue-400",
        gray: "text-gray-600 dark:text-gray-300",
    };
    const c = accent ? colors[accent] : colors.gray;
    return (
        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${c}`}>{value}</p>
            {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </div>
    );
}

function AlertBanner({ alerts }: { alerts: OpsStats["alerts"] }) {
    const critical = alerts.filter((a) => a.level === "critical");
    const warnings = alerts.filter((a) => a.level === "warning");
    const infos = alerts.filter((a) => a.level === "info");

    if (critical.length === 0 && warnings.length === 0 && infos.length === 0) return null;

    return (
        <div className="space-y-2 mb-6">
            {critical.map((a, i) => (
                <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{a.message}</span>
                </div>
            ))}
            {warnings.map((a, i) => (
                <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
                >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{a.message}</span>
                </div>
            ))}
            {infos.map((a, i) => (
                <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300"
                >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{a.message}</span>
                </div>
            ))}
        </div>
    );
}

function PlatformTable({ rows }: { rows: OpsStats["etl"]["byPlatform"] }) {
    if (rows.length === 0) {
        return <p className="text-sm text-gray-400 italic">No sync data in the last 24 h.</p>;
    }
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                        <th className="text-left pb-2 pr-4 font-medium">Platform</th>
                        <th className="text-right pb-2 pr-4 font-medium">Syncs</th>
                        <th className="text-right pb-2 pr-4 font-medium">Success</th>
                        <th className="text-right pb-2 pr-4 font-medium">Errors</th>
                        <th className="text-right pb-2 font-medium">Avg latency</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {rows.map((r) => (
                        <tr key={r.platform} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="py-2 pr-4 font-medium capitalize text-gray-700 dark:text-gray-200">
                                {r.platform}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-gray-600 dark:text-gray-300">
                                {r.total}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                                {pct(r.success, r.total)}
                            </td>
                            <td
                                className={`py-2 pr-4 text-right tabular-nums ${r.error > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}
                            >
                                {r.error > 0 ? r.error : "—"}
                            </td>
                            <td className="py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                                {fmtMs(r.avgMs)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ErrorClassRow({ label, count, total }: { label: string; count: number; total: number }) {
    const bar = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
        <div className="flex items-center gap-3">
            <span className="w-24 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div className="h-full bg-red-400 dark:bg-red-600" style={{ width: `${bar}%` }} />
            </div>
            <span className="w-8 text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{count}</span>
        </div>
    );
}

function QueueChip({ label, count, color }: { label: string; count: number; color: string }) {
    return (
        <div className={`flex flex-col items-center rounded-lg border p-3 ${color}`}>
            <span className="text-xl font-bold tabular-nums">{count}</span>
            <span className="text-xs font-medium mt-0.5 capitalize">{label}</span>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export function OpsClient() {
    const { data, error, isLoading, mutate } = useSWR<OpsStats>(
        "/api/admin/ops-stats",
        fetcher,
        { refreshInterval: 60_000, revalidateOnFocus: true },
    );
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 5_000);
        return () => clearInterval(t);
    }, []);

    if (error) {
        return (
            <div className="flex items-center gap-2 text-sm text-red-600 py-12 justify-center">
                <AlertTriangle className="h-4 w-4" />
                Failed to load ops stats — are you logged in as admin?
            </div>
        );
    }

    const skeleton = (
        <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-gray-100 dark:bg-gray-800" />
            ))}
        </div>
    );

    const s = data;

    return (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Ops Dashboard</h1>
                    <p className="text-xs text-gray-400 mt-0.5">Internal — admin only · auto-refreshes every 60 s</p>
                </div>
                <button
                    onClick={() => mutate()}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {s ? `Refreshed ${timeAgo(s.ts)}` : "Loading…"}
                </button>
            </div>

            {/* Alerts */}
            {isLoading ? skeleton : s && <AlertBanner alerts={s.alerts} />}

            {/* ─── Live 1-hour pulse ─────────────────────────── */}
            {isLoading ? skeleton : s && (
                <section>
                    <SectionTitle icon={Zap} title="Live · Last hour" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard
                            label="Syncs (1h)"
                            value={s.etl.last1h.total}
                            accent="blue"
                        />
                        <StatCard
                            label="Success rate (1h)"
                            value={pct(s.etl.last1h.success, s.etl.last1h.total)}
                            accent={
                                s.etl.last1h.total === 0
                                    ? "gray"
                                    : s.etl.last1h.error / Math.max(s.etl.last1h.total, 1) >= 0.2
                                    ? "red"
                                    : "green"
                            }
                        />
                        <StatCard
                            label="Errors (1h)"
                            value={s.etl.last1h.error}
                            accent={s.etl.last1h.error > 0 ? "red" : "gray"}
                        />
                        <StatCard
                            label="Queue backlog"
                            value={s.queue.backlog}
                            sub={s.queue.stuckJobs > 0 ? `${s.queue.stuckJobs} stuck >30 min` : undefined}
                            accent={s.queue.stuckJobs > 0 ? "red" : s.queue.backlog > 20 ? "yellow" : "gray"}
                        />
                    </div>
                </section>
            )}

            {/* ─── ETL Health (24h) ─────────────────────────── */}
            {isLoading ? skeleton : s && (
                <section>
                    <SectionTitle icon={Activity} title="ETL Pipeline Health · Last 24 h" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        <StatCard label="Total syncs" value={fmtNum(s.etl.last24h.total)} accent="blue" />
                        <StatCard
                            label="Success rate"
                            value={pct(s.etl.last24h.success, s.etl.last24h.total)}
                            accent={
                                s.etl.last24h.total === 0
                                    ? "gray"
                                    : s.etl.last24h.error / Math.max(s.etl.last24h.total, 1) >= 0.1
                                    ? "red"
                                    : "green"
                            }
                        />
                        <StatCard
                            label="Rows synced"
                            value={fmtNum(s.etl.last24h.rowsSynced)}
                            accent="green"
                        />
                        <StatCard
                            label="Avg latency"
                            value={fmtMs(s.etl.last24h.avgMs)}
                            accent="gray"
                        />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        {/* By platform */}
                        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
                                By platform
                            </p>
                            <PlatformTable rows={s.etl.byPlatform} />
                        </div>

                        {/* Error breakdown */}
                        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
                                Error breakdown ({s.etl.last24h.error} total)
                            </p>
                            <div className="space-y-3">
                                {(
                                    [
                                        ["Timeout", s.etl.errorClasses.timeout],
                                        ["OAuth / Token", s.etl.errorClasses.oauth],
                                        ["Rate limit", s.etl.errorClasses.rateLimit],
                                        ["Schema", s.etl.errorClasses.schema],
                                        ["Other", s.etl.errorClasses.other],
                                    ] as [string, number][]
                                ).map(([label, count]) => (
                                    <ErrorClassRow
                                        key={label}
                                        label={label}
                                        count={count}
                                        total={Math.max(s.etl.last24h.error, 1)}
                                    />
                                ))}
                            </div>

                            <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
                                    Connection health
                                </p>
                                <div className="grid grid-cols-3 gap-2 text-sm">
                                    <div className="text-center">
                                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                            {s.etl.connectionHealth.healthy}
                                        </p>
                                        <p className="text-xs text-gray-400">Healthy</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                                            {s.etl.connectionHealth.stale}
                                        </p>
                                        <p className="text-xs text-gray-400">Stale &gt;24 h</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-bold text-red-600 dark:text-red-400 tabular-nums">
                                            {s.etl.connectionHealth.error}
                                        </p>
                                        <p className="text-xs text-gray-400">Error</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* ─── Queue / Infra ────────────────────────────── */}
            {isLoading ? skeleton : s && (
                <section>
                    <SectionTitle icon={Server} title="Job Queue · Infra Load" />
                    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                        <div className="flex flex-wrap gap-3 mb-4">
                            {(["queued", "running", "done", "failed"] as const).map((status) => {
                                const count = s.queue.byStatus[status] || 0;
                                const colorMap: Record<string, string> = {
                                    queued: "border-blue-100 dark:border-blue-900 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950",
                                    running: "border-amber-100 dark:border-amber-900 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950",
                                    done: "border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950",
                                    failed: "border-red-100 dark:border-red-900 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950",
                                };
                                return <QueueChip key={status} label={status} count={count} color={colorMap[status]} />;
                            })}
                        </div>
                        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100 dark:border-gray-800 text-sm">
                            <div>
                                <p className="text-xs text-gray-400 mb-0.5">Avg job latency (24 h)</p>
                                <p className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                                    {s.queue.avgLatencyMs > 0 ? fmtMs(s.queue.avgLatencyMs) : "—"}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-400 mb-0.5">Failed (last 1 h)</p>
                                <p
                                    className={`font-semibold tabular-nums ${s.queue.failedLast1h > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}
                                >
                                    {s.queue.failedLast1h}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs text-gray-400 mb-0.5">Stuck jobs (&gt;30 min)</p>
                                <p
                                    className={`font-semibold tabular-nums ${s.queue.stuckJobs > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}
                                >
                                    {s.queue.stuckJobs || "—"}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* ─── Usage / Growth ───────────────────────────── */}
            {isLoading ? skeleton : s && (
                <section>
                    <SectionTitle icon={Users} title="Platform Usage & Growth" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        <StatCard
                            label="Workspaces"
                            value={s.usage.totalWorkspaces}
                            sub={`+${s.usage.newWorkspaces7d} this week`}
                            accent="blue"
                        />
                        <StatCard
                            label="New today"
                            value={s.usage.newWorkspaces24h}
                            accent={s.usage.newWorkspaces24h > 0 ? "green" : "gray"}
                        />
                        <StatCard
                            label="Active pipelines"
                            value={s.usage.activePipelines}
                            sub={`${s.usage.totalPipelines} total`}
                            accent="blue"
                        />
                        <StatCard
                            label="Connections"
                            value={s.usage.totalConnections}
                            accent="gray"
                        />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        {/* By provider */}
                        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
                                Connections by platform
                            </p>
                            {s.usage.byProvider.length === 0 ? (
                                <p className="text-sm text-gray-400 italic">No connections yet.</p>
                            ) : (
                                <div className="space-y-2">
                                    {s.usage.byProvider.map((r) => (
                                        <div key={r.provider} className="flex items-center gap-3">
                                            <Unplug className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
                                            <span className="flex-1 text-sm capitalize text-gray-700 dark:text-gray-200">
                                                {r.provider}
                                            </span>
                                            <span className="text-sm font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                                                {r.count}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Pipeline health */}
                        <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wider">
                                Pipeline health
                            </p>
                            <div className="grid grid-cols-3 gap-2 text-sm text-center">
                                {(
                                    [
                                        ["healthy", "emerald", "Healthy"],
                                        ["stale", "amber", "Stale"],
                                        ["error", "red", "Error"],
                                    ] as [string, string, string][]
                                ).map(([key, c, label]) => (
                                    <div key={key}>
                                        <p
                                            className={`text-xl font-bold tabular-nums text-${c}-600 dark:text-${c}-400`}
                                        >
                                            {s.usage.pipelineHealth[key] || 0}
                                        </p>
                                        <p className="text-xs text-gray-400">{label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {/* ─── External-data placeholders ───────────────── */}
            <section>
                <SectionTitle icon={Database} title="External Metrics (connect to unlock)" />
                <div className="grid sm:grid-cols-3 gap-3">
                    {[
                        {
                            icon: Clock,
                            title: "Revenue & MRR",
                            desc: "Connect Stripe to see trials, conversions, ARPU, and churn.",
                            link: "https://stripe.com",
                        },
                        {
                            icon: Users,
                            title: "Activation Funnel",
                            desc: "Connect PostHog to track signup → first sync conversion.",
                            link: "https://posthog.com",
                        },
                        {
                            icon: Info,
                            title: "Support Tickets",
                            desc: "Connect Linear or Intercom to see open issues and resolution time.",
                            link: null,
                        },
                    ].map(({ icon: Icon, title, desc }) => (
                        <div
                            key={title}
                            className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <Icon className="h-4 w-4 text-gray-400" />
                                <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">{title}</p>
                            </div>
                            <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
