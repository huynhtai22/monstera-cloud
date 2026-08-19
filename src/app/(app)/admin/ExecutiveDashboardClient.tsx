"use client";

import React, { useState, useEffect } from "react";
import { AdminIncidentsPanel } from "./AdminIncidentsPanel";
import {
    TrendingUp,
    Users,
    CreditCard,
    CheckCircle2,
    RefreshCw,
    ArrowUpRight,
    ArrowDownRight,
    QrCode,
    DollarSign,
    Layers,
    Server,
    ShieldCheck,
    AlertTriangle,
    UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricData {
    timeframe: string;
    timestamp: string;
    dbHealth: {
        status: string;
        latencyMs: number;
        tables: {
            users: number;
            workspaces: number;
            connections: number;
            pipelines: number;
            campaignMetrics: number;
            retailOrders: number;
            syncLogs: number;
            syncJobs: number;
        };
    };
    finance: {
        mrrVnd: number;
        mrrUsd: number;
        arrVnd: number;
        arrUsd: number;
        totalVndRealized: number;
        payingWorkspacesCount: number;
        paidConversionRate: number;
        recentTransactions: Array<{
            orderCode: number;
            plan: string;
            billingCycle: string;
            amount: number;
            memo: string;
            status: string;
            userEmail?: string;
            createdAt: number;
            paidAt?: number;
        }>;
    };
    growth: {
        totalUsers: number;
        totalWorkspaces: number;
        newWorkspacesInPeriod: number;
        growthRatePercent: number;
        activeWorkspacesCount: number;
        suspendedWorkspacesCount: number;
        inactiveWorkspacesCount: number;
        churnRatePercent: number;
        planDistribution: Record<string, number>;
    };
    syncTelemetry: {
        totalSyncs24h: number;
        syncSuccessRate: number;
        connectionsByProvider: Array<{ provider: string; count: number }>;
    };
}

export function ExecutiveDashboardClient({ userEmail }: { userEmail: string }) {
    const [tab, setTab] = useState<"incidents" | "finance">("incidents");
    const [timeframe, setTimeframe] = useState<"7d" | "30d" | "90d" | "all">("30d");
    const [data, setData] = useState<MetricData | null>(null);
    const [loading, setLoading] = useState(true);
    const [approvingCode, setApprovingCode] = useState<number | null>(null);

    const loadMetrics = () => {
        setLoading(true);
        fetch(`/api/admin/executive-metrics?timeframe=${timeframe}`)
            .then((res) => res.json())
            .then((d) => {
                if (!d.error) setData(d);
            })
            .catch((err) => console.error("Failed to load executive metrics", err))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadMetrics();
    }, [timeframe]);

    const handleApproveOrder = async (orderCode: number) => {
        setApprovingCode(orderCode);
        try {
            const res = await fetch("/api/payments/vietqr/manual-confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderCode }),
            });
            if (res.ok) {
                loadMetrics();
            }
        } catch (err) {
            console.error("Failed to approve order", err);
        } finally {
            setApprovingCode(null);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="mb-1.5 flex items-center gap-2">
                        <span className="rounded border border-line bg-panel px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                            Executive Ops &amp; Finance
                        </span>
                        <div className="flex items-center gap-1.5 rounded border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-mute">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                            <span>DB Ping: {data?.dbHealth.latencyMs ?? "--"}ms</span>
                        </div>
                    </div>
                    <h1 className="text-xl font-semibold tracking-tight text-ink">
                        Finance &amp; Admin
                    </h1>
                    <p className="mt-0.5 text-xs text-ink-mute">
                        Platform telemetry, billing, and incident response for {userEmail}.
                    </p>

                    {/* View Switcher */}
                    <div className="mt-3 inline-flex rounded-md border border-line bg-panel p-0.5 text-xs font-medium">
                        <button
                            type="button"
                            onClick={() => setTab("incidents")}
                            className={cn(
                                "rounded px-3 py-1.5 transition-colors",
                                tab === "incidents"
                                    ? "bg-white/[0.08] text-ink font-semibold"
                                    : "text-ink-mute hover:text-ink"
                            )}
                        >
                            Incidents
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("finance")}
                            className={cn(
                                "rounded px-3 py-1.5 transition-colors",
                                tab === "finance"
                                    ? "bg-white/[0.08] text-ink font-semibold"
                                    : "text-ink-mute hover:text-ink"
                            )}
                        >
                            Finance &amp; Revenue
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <div className="inline-flex rounded-md border border-line bg-panel p-0.5 text-xs font-medium">
                        {(["7d", "30d", "90d", "all"] as const).map((tf) => (
                            <button
                                key={tf}
                                type="button"
                                onClick={() => setTimeframe(tf)}
                                className={cn(
                                    "rounded px-2.5 py-1.5 transition-colors",
                                    timeframe === tf
                                        ? "bg-white/[0.08] text-ink font-semibold"
                                        : "text-ink-mute hover:text-ink"
                                )}
                            >
                                {tf === "7d" ? "7 Days" : tf === "30d" ? "30 Days" : tf === "90d" ? "90 Days" : "All Time"}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={loadMetrics}
                        className="rounded-md border border-line bg-panel p-2 text-ink-mute hover:bg-white/[0.04] hover:text-ink transition-colors"
                        title="Refresh metrics"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-ink")} strokeWidth={1.5} />
                    </button>
                </div>
            </div>

            {/* Incidents Panel */}
            {tab === "incidents" && <AdminIncidentsPanel />}

            {/* Finance & Telemetry Panel */}
            {tab === "finance" && (
                <div className="space-y-6">
                    {/* SECTION 1: REVENUE KPIS */}
                    <div>
                        <div className="mb-3 flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-emerald-400" />
                            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                                Revenue &amp; Cashflow
                            </h2>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {/* MRR */}
                            <div className="rounded-lg border border-line bg-panel p-5 space-y-2">
                                <div className="flex items-center justify-between text-xs font-medium text-ink-mute">
                                    <span>MRR (Monthly Run-Rate)</span>
                                    <DollarSign className="h-4 w-4 text-emerald-400" />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-2xl font-bold tracking-tight text-ink">
                                        {(data?.finance.mrrVnd || 0).toLocaleString("vi-VN")} đ
                                    </div>
                                    {(data?.finance.mrrUsd || 0) > 0 && (
                                        <p className="text-xs text-blue-400 font-medium">
                                            + ${(data?.finance.mrrUsd || 0).toLocaleString()} USD
                                        </p>
                                    )}
                                </div>
                                <p className="border-t border-line pt-2 text-[11px] text-ink-mute">
                                    Est. ARR: <strong className="text-ink">{((data?.finance.arrVnd || 0) / 1_000_000).toFixed(1)}M đ/yr</strong>
                                </p>
                            </div>

                            {/* Realized Cash-in */}
                            <div className="rounded-lg border border-line bg-panel p-5 space-y-2">
                                <div className="flex items-center justify-between text-xs font-medium text-ink-mute">
                                    <span>Realized Cash-In</span>
                                    <QrCode className="h-4 w-4 text-ink-mute" />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-2xl font-bold tracking-tight text-emerald-400">
                                        {(data?.finance.totalVndRealized || 0).toLocaleString("vi-VN")} đ
                                    </div>
                                    <p className="text-xs text-ink-mute">Collected via VietQR Napas 24/7</p>
                                </div>
                                <p className="border-t border-line pt-2 text-[11px] text-ink-mute">
                                    Beneficiary: <strong className="text-ink font-mono">19036348292019</strong>
                                </p>
                            </div>

                            {/* Paying Workspaces */}
                            <div className="rounded-lg border border-line bg-panel p-5 space-y-2">
                                <div className="flex items-center justify-between text-xs font-medium text-ink-mute">
                                    <span>Paying Accounts</span>
                                    <UserCheck className="h-4 w-4 text-purple-400" />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="text-2xl font-bold tracking-tight text-ink">
                                        {data?.finance.payingWorkspacesCount ?? 0}{" "}
                                        <span className="text-xs font-normal text-ink-mute">workspaces</span>
                                    </div>
                                    <p className="text-xs text-ink-mute">Starter, Pro, Enterprise</p>
                                </div>
                                <p className="border-t border-line pt-2 text-[11px] text-ink-mute">
                                    Paid conversion: <strong className="text-ink">{data?.finance.paidConversionRate ?? 0}%</strong>
                                </p>
                            </div>

                            {/* Growth */}
                            <div className="rounded-lg border border-line bg-panel p-5 space-y-2">
                                <div className="flex items-center justify-between text-xs font-medium text-ink-mute">
                                    <span>Workspace Growth</span>
                                    <TrendingUp className="h-4 w-4 text-blue-400" />
                                </div>
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
                                        <span>+{data?.growth.newWorkspacesInPeriod ?? 0}</span>
                                        <span
                                            className={cn(
                                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                                                (data?.growth.growthRatePercent || 0) >= 0
                                                    ? "bg-emerald-950/40 text-emerald-400 border border-emerald-500/20"
                                                    : "bg-red-950/40 text-red-400 border border-red-500/20"
                                            )}
                                        >
                                            {(data?.growth.growthRatePercent || 0) >= 0 ? (
                                                <ArrowUpRight className="h-3 w-3" />
                                            ) : (
                                                <ArrowDownRight className="h-3 w-3" />
                                            )}
                                            {Math.abs(data?.growth.growthRatePercent || 0)}%
                                        </span>
                                    </div>
                                    <p className="text-xs text-ink-mute">Created in {timeframe}</p>
                                </div>
                                <p className="border-t border-line pt-2 text-[11px] text-ink-mute">
                                    Total workspaces: <strong className="text-ink">{data?.growth.totalWorkspaces ?? 0}</strong>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 2: USERS & RETENTION */}
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                        {/* Retention Breakdown */}
                        <div className="rounded-lg border border-line bg-panel p-5 space-y-4">
                            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-mute">
                                <Users className="h-4 w-4 text-ink" />
                                User Activity &amp; Churn
                            </h3>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-md border border-line bg-canvas p-3.5">
                                    <span className="block text-[11px] text-ink-mute font-medium">Active Workspaces</span>
                                    <span className="text-2xl font-bold text-emerald-400">
                                        {data?.growth.activeWorkspacesCount ?? 0}
                                    </span>
                                    <span className="block text-[10px] text-ink-mute mt-0.5">Synced &lt;14 days</span>
                                </div>

                                <div className="rounded-md border border-line bg-canvas p-3.5">
                                    <span className="block text-[11px] text-ink-mute font-medium">Churned / Inactive</span>
                                    <span className="text-2xl font-bold text-rose-400">
                                        {(data?.growth.suspendedWorkspacesCount || 0) + (data?.growth.inactiveWorkspacesCount || 0)}
                                    </span>
                                    <span className="block text-[10px] text-ink-mute mt-0.5">
                                        Churn rate: {data?.growth.churnRatePercent ?? 0}%
                                    </span>
                                </div>
                            </div>

                            <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200 space-y-1">
                                <div className="flex items-center gap-1.5 font-semibold">
                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                                    <span>Retention Analysis</span>
                                </div>
                                <p className="text-[11px] leading-relaxed text-ink-mute">
                                    <strong>{data?.growth.inactiveWorkspacesCount ?? 0}</strong> workspaces have not synced data in the last 14 days. Proactive onboarding assistance is recommended.
                                </p>
                            </div>
                        </div>

                        {/* Plan Tier Distribution */}
                        <div className="rounded-lg border border-line bg-panel p-5 space-y-4 lg:col-span-2">
                            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-mute">
                                <Layers className="h-4 w-4 text-ink" />
                                Plan Tier Distribution
                            </h3>

                            <div className="space-y-3 pt-1">
                                {data?.growth.planDistribution &&
                                    Object.entries(data.growth.planDistribution).map(([plan, count]) => {
                                        const total = data.growth.totalWorkspaces || 1;
                                        const pct = Math.round((count / total) * 100);
                                        return (
                                            <div key={plan} className="space-y-1 text-xs">
                                                <div className="flex justify-between font-medium">
                                                    <span className="uppercase text-ink">
                                                        {plan === "free" ? "Free Trial" : plan}
                                                    </span>
                                                    <span className="text-ink-mute font-mono">
                                                        {count} ({pct}%)
                                                    </span>
                                                </div>
                                                <div className="h-2 rounded-full border border-line bg-canvas overflow-hidden">
                                                    <div
                                                        className={cn(
                                                            "h-full rounded-full transition-all",
                                                            plan === "professional"
                                                                ? "bg-white"
                                                                : plan === "starter"
                                                                ? "bg-emerald-400"
                                                                : plan === "enterprise"
                                                                ? "bg-indigo-400"
                                                                : "bg-neutral-600"
                                                        )}
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: TRANSACTIONS LEDGER */}
                    <div className="rounded-lg border border-line bg-panel p-5 space-y-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                                <QrCode className="h-4 w-4 text-ink" />
                                VietQR Payment &amp; Activation Ledger
                            </h3>
                            <p className="text-xs text-ink-mute mt-0.5">
                                Real-time Napas 24/7 bank transfer orders and automated reconciliation.
                            </p>
                        </div>

                        {!data?.finance.recentTransactions || data.finance.recentTransactions.length === 0 ? (
                            <div className="rounded-md border border-dashed border-line p-8 text-center text-xs text-ink-mute">
                                No payment transactions recorded in this period.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
                                            <th className="py-2.5 px-3">Order</th>
                                            <th className="py-2.5 px-3">Plan</th>
                                            <th className="py-2.5 px-3">Amount</th>
                                            <th className="py-2.5 px-3">Transfer Memo</th>
                                            <th className="py-2.5 px-3">Created</th>
                                            <th className="py-2.5 px-3">Status</th>
                                            <th className="py-2.5 px-3 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-line">
                                        {data.finance.recentTransactions.map((tx) => (
                                            <tr key={tx.orderCode} className="hover:bg-white/[0.02] transition-colors">
                                                <td className="py-2.5 px-3 font-mono font-semibold text-ink">
                                                    #{tx.orderCode}
                                                </td>
                                                <td className="py-2.5 px-3 uppercase font-semibold text-ink">{tx.plan}</td>
                                                <td className="py-2.5 px-3 font-semibold text-ink">
                                                    {tx.amount.toLocaleString("vi-VN")} đ
                                                </td>
                                                <td className="py-2.5 px-3 font-mono font-medium text-emerald-400">{tx.memo}</td>
                                                <td className="py-2.5 px-3 text-ink-mute">
                                                    {new Date(tx.createdAt).toLocaleString()}
                                                </td>
                                                <td className="py-2.5 px-3">
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold uppercase",
                                                            tx.status === "PAID"
                                                                ? "bg-emerald-950/40 text-emerald-400 border border-emerald-500/30"
                                                                : "bg-amber-950/40 text-amber-400 border border-amber-500/30"
                                                        )}
                                                    >
                                                        {tx.status}
                                                    </span>
                                                </td>
                                                <td className="py-2.5 px-3 text-right">
                                                    {tx.status === "PAID" ? (
                                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                                                            <CheckCircle2 className="h-3.5 w-3.5" /> Activated
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            disabled={approvingCode === tx.orderCode}
                                                            onClick={() => handleApproveOrder(tx.orderCode)}
                                                            className="rounded bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 disabled:opacity-50"
                                                        >
                                                            {approvingCode === tx.orderCode ? "Approving…" : "Approve"}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* SECTION 4: INFRASTRUCTURE & DB HEALTH */}
                    <div className="rounded-lg border border-line bg-panel p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-mute">
                                <Server className="h-4 w-4 text-ink" />
                                Database &amp; ETL Health Telemetry
                            </h3>
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                                <ShieldCheck className="h-4 w-4" /> 99.9% Uptime SLA
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                            <div className="rounded-md border border-line bg-canvas p-3.5">
                                <span className="block text-ink-mute text-[11px]">Campaign Metrics Rows</span>
                                <span className="text-lg font-mono font-bold text-ink">
                                    {(data?.dbHealth.tables.campaignMetrics || 0).toLocaleString()}
                                </span>
                            </div>

                            <div className="rounded-md border border-line bg-canvas p-3.5">
                                <span className="block text-ink-mute text-[11px]">Retail Orders Rows</span>
                                <span className="text-lg font-mono font-bold text-ink">
                                    {(data?.dbHealth.tables.retailOrders || 0).toLocaleString()}
                                </span>
                            </div>

                            <div className="rounded-md border border-line bg-canvas p-3.5">
                                <span className="block text-ink-mute text-[11px]">Sync Logs</span>
                                <span className="text-lg font-mono font-bold text-ink">
                                    {(data?.dbHealth.tables.syncLogs || 0).toLocaleString()}
                                </span>
                            </div>

                            <div className="rounded-md border border-line bg-canvas p-3.5">
                                <span className="block text-ink-mute text-[11px]">Sync Success Rate (24h)</span>
                                <span className="text-lg font-mono font-bold text-emerald-400">
                                    {data?.syncTelemetry.syncSuccessRate ?? 100}%
                                </span>
                            </div>
                        </div>

                        {/* Connected Providers Breakdown */}
                        <div className="border-t border-line pt-3">
                            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
                                Connections by Platform
                            </span>
                            <div className="flex flex-wrap gap-2">
                                {data?.syncTelemetry.connectionsByProvider &&
                                    data.syncTelemetry.connectionsByProvider.map((c) => (
                                        <div
                                            key={c.provider}
                                            className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-xs"
                                        >
                                            <span className="capitalize text-ink">{c.provider.replace(/_/g, " ")}</span>
                                            <span className="rounded-full border border-line bg-panel px-2 py-0.2 text-[10px] font-mono font-semibold text-ink">
                                                {c.count}
                                            </span>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
