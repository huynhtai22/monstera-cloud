"use client";

import React, { useState, useEffect } from "react";
import { AdminIncidentsPanel } from "./AdminIncidentsPanel";
import {
    TrendingUp,
    Users,
    CreditCard,
    Database,
    Activity,
    AlertTriangle,
    CheckCircle2,
    RefreshCw,
    ArrowUpRight,
    ArrowDownRight,
    QrCode,
    DollarSign,
    Layers,
    Server,
    ShieldCheck,
    Clock,
    UserMinus,
    UserCheck,
    Sparkles,
} from "lucide-react";

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
        <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 p-4 sm:p-8 lg:p-10 font-sans text-slate-900 dark:text-slate-100 antialiased space-y-8">
            {/* ── Top Header Bar ────────────────────────────────────────────── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-cyan-100 dark:bg-cyan-950 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800">
                            Executive Ops &amp; Finance
                        </span>
                        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>DB Ping: {data?.dbHealth.latencyMs ?? "--"}ms</span>
                        </div>
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white">
                        Admin portal
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Incidents, tickets, and finance for {userEmail}.
                    </p>
                    <div className="mt-3 inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold dark:border-slate-800 dark:bg-slate-900">
                        <button
                            type="button"
                            onClick={() => setTab("incidents")}
                            className={`rounded-lg px-3 py-1.5 ${tab === "incidents" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500"}`}
                        >
                            Incidents
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("finance")}
                            className={`rounded-lg px-3 py-1.5 ${tab === "finance" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500"}`}
                        >
                            Finance
                        </button>
                    </div>
                </div>

                {/* Controls: Timeframe Filter & Refresh */}
                <div className="flex items-center gap-3">
                    <div className="inline-flex p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800/80 border border-slate-300/60 dark:border-slate-700 text-xs font-semibold">
                        {(["7d", "30d", "90d", "all"] as const).map((tf) => (
                            <button
                                key={tf}
                                type="button"
                                onClick={() => setTimeframe(tf)}
                                className={`px-3 py-1.5 rounded-lg transition-all ${
                                    timeframe === tf
                                        ? "bg-white dark:bg-slate-900 text-slate-950 dark:text-white shadow-2xs font-bold"
                                        : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                }`}
                            >
                                {tf === "7d" ? "7 Ngày" : tf === "30d" ? "30 Ngày" : tf === "90d" ? "90 Ngày" : "Tất Cả"}
                            </button>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={loadMetrics}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 shadow-2xs transition-all"
                        title="Làm mới dữ liệu"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-cyan-600" : ""}`} />
                    </button>
                </div>
            </div>

            {tab === "incidents" && <AdminIncidentsPanel />}

            {tab === "finance" && (
            <>
            {/* ── SECTION 1: FINANCE & REVENUE (MONEY-IN) ───────────────────── */}
            <div>
                <div className="flex items-center gap-2 mb-4">
                    <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <h2 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Chỉ Số Doanh Thu &amp; Dòng Tiền (Money-In)
                    </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {/* Card 1: MRR */}
                    <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase tracking-wider">
                            <span>MRR (Doanh thu tháng)</span>
                            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                                <DollarSign className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight">
                                {(data?.finance.mrrVnd || 0).toLocaleString("vi-VN")} đ
                            </div>
                            {(data?.finance.mrrUsd || 0) > 0 && (
                                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                                    + ${(data?.finance.mrrUsd || 0).toLocaleString()} USD
                                </p>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                            ARR ước tính: <strong>{((data?.finance.arrVnd || 0) / 1000000).toFixed(1)}M đ/năm</strong>
                        </p>
                    </div>

                    {/* Card 2: Realized VietQR Cash-In */}
                    <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase tracking-wider">
                            <span>Thực Thu VietQR (Cash-In)</span>
                            <div className="p-2 rounded-xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400">
                                <QrCode className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 tracking-tight">
                                {(data?.finance.totalVndRealized || 0).toLocaleString("vi-VN")} đ
                            </div>
                            <p className="text-xs text-slate-500">Tiền thực nhận qua Techcombank</p>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                            TK Thụ hưởng: <strong>19036348292019</strong>
                        </p>
                    </div>

                    {/* Card 3: Paying Workspaces */}
                    <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase tracking-wider">
                            <span>Khách Hàng Trả Phí</span>
                            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                                <UserCheck className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight">
                                {data?.finance.payingWorkspacesCount ?? 0}{" "}
                                <span className="text-xs font-normal text-slate-400">workspaces</span>
                            </div>
                            <p className="text-xs text-slate-500">Starter, Pro, Enterprise</p>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                            Tỷ lệ chuyển đổi Paid: <strong>{data?.finance.paidConversionRate ?? 0}%</strong>
                        </p>
                    </div>

                    {/* Card 4: Net Growth Rate */}
                    <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase tracking-wider">
                            <span>Tăng Trưởng Workspace</span>
                            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                                <TrendingUp className="w-4 h-4" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-2xl sm:text-3xl font-extrabold text-slate-950 dark:text-white tracking-tight flex items-center gap-1.5">
                                <span>+{data?.growth.newWorkspacesInPeriod ?? 0}</span>
                                <span
                                    className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center ${
                                        (data?.growth.growthRatePercent || 0) >= 0
                                            ? "bg-emerald-100 text-emerald-700"
                                            : "bg-red-100 text-red-700"
                                    }`}
                                >
                                    {(data?.growth.growthRatePercent || 0) >= 0 ? (
                                        <ArrowUpRight className="w-3 h-3" />
                                    ) : (
                                        <ArrowDownRight className="w-3 h-3" />
                                    )}
                                    {Math.abs(data?.growth.growthRatePercent || 0)}%
                                </span>
                            </div>
                            <p className="text-xs text-slate-500">Mới tạo trong {timeframe}</p>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
                            Tổng Workspace: <strong>{data?.growth.totalWorkspaces ?? 0}</strong>
                        </p>
                    </div>
                </div>
            </div>

            {/* ── SECTION 2: USERS & CHURN TELEMETRY (USER-LEAVE) ───────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* User & Churn Breakdown */}
                <div className="p-6 md:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                            <Users className="w-4 h-4 text-cyan-600" />
                            <span>Người Dùng &amp; Tỷ Lệ Rời Bỏ (Churn)</span>
                        </h3>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                            <span className="text-[11px] text-slate-400 block font-medium">Người dùng hoạt động (Active)</span>
                            <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                                {data?.growth.activeWorkspacesCount ?? 0}
                            </span>
                            <span className="text-[10px] text-slate-500 block mt-0.5">Sync dữ liệu &lt;14 ngày</span>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                            <span className="text-[11px] text-slate-400 block font-medium">Rời bỏ / Tạm dừng (Churn)</span>
                            <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">
                                {(data?.growth.suspendedWorkspacesCount || 0) + (data?.growth.inactiveWorkspacesCount || 0)}
                            </span>
                            <span className="text-[10px] text-slate-500 block mt-0.5">
                                Churn rate: {data?.growth.churnRatePercent ?? 0}%
                            </span>
                        </div>
                    </div>

                    {/* Health Note */}
                    <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-300 space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                            <AlertTriangle className="w-4 h-4 text-amber-600" />
                            <span>Phân tích giữ chân người dùng (Retention)</span>
                        </div>
                        <p className="text-[11px] leading-relaxed">
                            Có <strong>{data?.growth.inactiveWorkspacesCount ?? 0}</strong> workspace không kích hoạt sync trong 14 ngày qua. Đội ngũ BD nên gửi email hỗ trợ thiết lập Google Sheets Add-on.
                        </p>
                    </div>
                </div>

                {/* Plan Distribution Breakdown */}
                <div className="p-6 md:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-5 lg:col-span-2">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-indigo-600" />
                        <span>Phân Bổ Gói Đăng Ký (Plan Tier Distribution)</span>
                    </h3>

                    <div className="space-y-3">
                        {data?.growth.planDistribution &&
                            Object.entries(data.growth.planDistribution).map(([plan, count]) => {
                                const total = data.growth.totalWorkspaces || 1;
                                const pct = Math.round((count / total) * 100);
                                return (
                                    <div key={plan} className="space-y-1 text-xs">
                                        <div className="flex justify-between font-semibold">
                                            <span className="uppercase text-slate-700 dark:text-slate-300">
                                                {plan === "free" ? "Free Trial" : plan}
                                            </span>
                                            <span className="text-slate-500">
                                                {count} ({pct}%)
                                            </span>
                                        </div>
                                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${
                                                    plan === "professional"
                                                        ? "bg-cyan-500"
                                                        : plan === "starter"
                                                        ? "bg-emerald-500"
                                                        : plan === "enterprise"
                                                        ? "bg-indigo-600"
                                                        : "bg-slate-400"
                                                }`}
                                                style={{ width: `${pct}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            </div>

            {/* ── SECTION 3: LIVE TRANSACTIONS & APPROVAL LEDGER ────────────── */}
            <div className="p-6 md:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                            <QrCode className="w-5 h-5 text-emerald-600" />
                            <span>Sổ Nhật Ký Giao Dịch VietQR &amp; Thanh Toán (Ledger)</span>
                        </h3>
                        <p className="text-xs text-slate-500">
                            Các mã thanh toán VietQR Napas 24/7 được tạo và trạng thái đối soát từ ngân hàng.
                        </p>
                    </div>
                </div>

                {!data?.finance.recentTransactions || data.finance.recentTransactions.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                        Chưa có giao dịch thanh toán nào được ghi nhận.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold">
                                    <th className="py-3 px-3">Mã Đơn</th>
                                    <th className="py-3 px-3">Gói Dịch Vụ</th>
                                    <th className="py-3 px-3">Số Tiền</th>
                                    <th className="py-3 px-3">Nội Dung CK</th>
                                    <th className="py-3 px-3">Thời Gian</th>
                                    <th className="py-3 px-3">Trạng Thái</th>
                                    <th className="py-3 px-3 text-right">Duyệt</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-300">
                                {data.finance.recentTransactions.map((tx) => (
                                    <tr key={tx.orderCode} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                        <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                                            #{tx.orderCode}
                                        </td>
                                        <td className="py-3 px-3 uppercase font-semibold text-cyan-600">{tx.plan}</td>
                                        <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                                            {tx.amount.toLocaleString("vi-VN")} đ
                                        </td>
                                        <td className="py-3 px-3 font-mono font-bold text-emerald-600">{tx.memo}</td>
                                        <td className="py-3 px-3 text-slate-400">
                                            {new Date(tx.createdAt).toLocaleString("vi-VN")}
                                        </td>
                                        <td className="py-3 px-3">
                                            <span
                                                className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                                                    tx.status === "PAID"
                                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                                        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                                }`}
                                            >
                                                {tx.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-3 text-right">
                                            {tx.status === "PAID" ? (
                                                <span className="text-emerald-600 font-semibold flex items-center justify-end gap-1 text-[11px]">
                                                    <CheckCircle2 className="w-3.5 h-3.5" /> Đã Kích Hoạt
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    disabled={approvingCode === tx.orderCode}
                                                    onClick={() => handleApproveOrder(tx.orderCode)}
                                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-2xs transition-all disabled:opacity-50"
                                                >
                                                    {approvingCode === tx.orderCode ? "Đang duyệt..." : "Duyệt Kích Hoạt"}
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

            {/* ── SECTION 4: DATABASE & INFRASTRUCTURE HEALTH ──────────────── */}
            <div className="p-6 md:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <Server className="w-4 h-4 text-emerald-600" />
                        <span>Sức Khỏe Cơ Sở Dữ Liệu PostgreSQL &amp; Hạ Tầng ETL</span>
                    </h3>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4" /> Hệ thống sẵn sàng 99.9%
                    </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                        <span className="text-slate-400 block">Dữ liệu Ads (CampaignMetrics)</span>
                        <span className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                            {(data?.dbHealth.tables.campaignMetrics || 0).toLocaleString()} dòng
                        </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                        <span className="text-slate-400 block">Đơn hàng sàn (RetailOrders)</span>
                        <span className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                            {(data?.dbHealth.tables.retailOrders || 0).toLocaleString()} dòng
                        </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                        <span className="text-slate-400 block">Lịch sử Sync (SyncLogs)</span>
                        <span className="text-xl font-mono font-bold text-slate-900 dark:text-white">
                            {(data?.dbHealth.tables.syncLogs || 0).toLocaleString()} records
                        </span>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                        <span className="text-slate-400 block">Tỷ Lệ Sync Thành Công (24h)</span>
                        <span className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {data?.syncTelemetry.syncSuccessRate ?? 100}%
                        </span>
                    </div>
                </div>

                {/* Connections by Platform */}
                <div className="pt-2">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-3">
                        Số lượng kết nối theo nền tảng
                    </span>
                    <div className="flex flex-wrap gap-3">
                        {data?.syncTelemetry.connectionsByProvider &&
                            data.syncTelemetry.connectionsByProvider.map((c) => (
                                <div
                                    key={c.provider}
                                    className="px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-2"
                                >
                                    <span className="capitalize">{c.provider.replace(/_/g, " ")}</span>
                                    <span className="px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 font-bold text-cyan-600 shadow-2xs">
                                        {c.count}
                                    </span>
                                </div>
                            ))}
                    </div>
                </div>
            </div>
            </>
            )}
        </div>
    );
}
