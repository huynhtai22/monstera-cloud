"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Activity, Plug, Send, FileBarChart2, Zap } from "lucide-react";
import { SectionOverviewCard, type OverviewLineItem } from "@/components/dashboard/SectionOverviewCard";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";

type Connection = {
    id: string;
    type: string;
    provider: string;
    status?: string | null;
    name?: string | null;
    updatedAt?: string | null;
};

type SyncLog = {
    id: string;
    status: string;
    createdAt: string;
    pipeline?: { id: string; name: string } | null;
};

type PillarGridProps = {
    connections: Connection[];
    syncLogs: SyncLog[];
    healthyCount: number;
    totalPipelines: number;
    latestNetRoas: number | null;
};

const PROVIDER_LABELS: Record<string, string> = {
    tiktok_business: "TikTok Ads",
    tiktok_shop: "TikTok Shop",
    meta_ads: "Meta Ads",
    google_ads: "Google Ads",
    shopee: "Shopee",
    lazada: "Lazada",
    shopify: "Shopify",
    amazon: "Amazon SP",
    google_sheets: "Google Sheets",
    looker_studio: "Looker Studio",
    slack: "Slack",
};

function prettyProvider(provider: string) {
    return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

function timeAgo(iso?: string | null): string | undefined {
    if (!iso) return undefined;
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return undefined;
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
}

export function PillarGrid({
    connections,
    syncLogs,
    healthyCount,
    totalPipelines,
    latestNetRoas,
}: PillarGridProps) {
    const sources = connections.filter((c) => c.type === "source");
    const destinations = connections.filter((c) => c.type === "destination");

    const sourceItems: OverviewLineItem[] = sources.slice(0, 3).map((c) => ({
        id: c.id,
        label: c.name?.trim() ? c.name! : prettyProvider(c.provider),
        sub: timeAgo(c.updatedAt),
        logoSrc: logoPathForConnectionProvider(c.provider),
        status: c.status === "connected" ? "ok" : c.status === "error" ? "error" : "pending",
    }));

    const destinationItems: OverviewLineItem[] = destinations.slice(0, 3).map((c) => ({
        id: c.id,
        label: c.name?.trim() ? c.name! : prettyProvider(c.provider),
        sub: c.status === "connected" ? "Connected" : c.status ?? "Pending",
        logoSrc: logoPathForConnectionProvider(c.provider),
        status: c.status === "connected" ? "ok" : c.status === "error" ? "error" : "pending",
    }));

    const { recentLogs, successCount, errorCount } = useMemo(() => {
        const sorted = [...syncLogs].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        let successes = 0;
        let errors = 0;
        for (const l of syncLogs) {
            if (l.status === "success") successes++;
            else if (l.status === "error") errors++;
        }
        return { recentLogs: sorted.slice(0, 3), successCount: successes, errorCount: errors };
    }, [syncLogs]);

    const reportItems: OverviewLineItem[] = recentLogs.map((l) => ({
        id: l.id,
        label: l.pipeline?.name ?? "Pipeline sync",
        sub: timeAgo(l.createdAt),
        status: l.status === "success" ? "ok" : l.status === "error" ? "error" : "pending",
    }));

    const dashboardItems: OverviewLineItem[] = [
        {
            id: "health",
            label: `${healthyCount}/${totalPipelines || 0} pipelines healthy`,
            status: totalPipelines === 0 ? "pending" : healthyCount === totalPipelines ? "ok" : "error",
        },
        {
            id: "syncs",
            label: `${successCount} successful sync${successCount === 1 ? "" : "s"}`,
            sub: errorCount ? `${errorCount} failed` : undefined,
            status: errorCount ? "error" : successCount ? "ok" : "pending",
        },
        {
            id: "sources",
            label: `${sources.length} source${sources.length === 1 ? "" : "s"} · ${destinations.length} destination${destinations.length === 1 ? "" : "s"}`,
            status: sources.length && destinations.length ? "ok" : "pending",
        },
    ];

    const noReportsYet = syncLogs.length === 0;

    return (
        <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="pillar-fade md:col-span-2" style={{ animationDelay: "0ms" }}>
                <SectionOverviewCard
                    icon={<Activity className="h-5 w-5" />}
                    title="Dashboard"
                    subtitle="Health & performance"
                    emphasis
                    kpi={
                        latestNetRoas != null
                            ? { label: "Net ROAS", value: `${latestNetRoas.toFixed(2)}×` }
                            : undefined
                    }
                    items={dashboardItems}
                    ctaLabel="View health"
                    ctaHref="/reports"
                />
            </div>

            <div className="pillar-fade" style={{ animationDelay: "60ms" }}>
                <SectionOverviewCard
                    icon={<Plug className="h-5 w-5" />}
                    title="Sources"
                    subtitle="Where data comes from"
                    kpi={{ label: "Connected", value: String(sources.length) }}
                    items={sourceItems}
                    emptyHint="No sources connected. Add TikTok, Meta, or Shopee to start syncing."
                    ctaLabel={sources.length ? "Manage sources" : "Connect a source"}
                    ctaHref="/sources"
                />
            </div>

            <div className="pillar-fade" style={{ animationDelay: "120ms" }}>
                <SectionOverviewCard
                    icon={<Send className="h-5 w-5" />}
                    title="Destinations"
                    subtitle="Where data lands"
                    kpi={{ label: "Connected", value: String(destinations.length) }}
                    items={destinationItems}
                    emptyHint="No destinations yet. Pick Google Sheets or Looker Studio to deliver data."
                    ctaLabel={destinations.length ? "Manage destinations" : "Add a destination"}
                    ctaHref="/destinations"
                />
            </div>

            <div className="pillar-fade md:col-span-2" style={{ animationDelay: "180ms" }}>
                <SectionOverviewCard
                    icon={<FileBarChart2 className="h-5 w-5" />}
                    title="Reports"
                    subtitle="Latest sync activity"
                    kpi={{
                        label: "14d success",
                        value: `${successCount}/${successCount + errorCount}`,
                    }}
                    items={reportItems}
                    emptyHint="No sync logs yet. Reports will appear after your first run."
                    ctaLabel="Open reports"
                    ctaHref="/reports"
                    footerSlot={
                        noReportsYet ? (
                            <Link
                                href="/pipelines"
                                className="inline-flex items-center gap-1 rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-100 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
                            >
                                <Zap className="h-3 w-3" />
                                Run your first sync
                            </Link>
                        ) : null
                    }
                />
            </div>
        </div>
    );
}
