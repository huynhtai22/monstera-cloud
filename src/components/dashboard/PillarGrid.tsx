"use client";

import { useMemo } from "react";
import { GitMerge, Plug, Send, FileBarChart2 } from "lucide-react";
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

    const { recentLogs, successCount, errorCount, pipelineItems } = useMemo(() => {
        const sorted = [...syncLogs].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        let successes = 0;
        let errors = 0;
        for (const l of syncLogs) {
            if (l.status === "success") successes++;
            else if (l.status === "error") errors++;
        }
        // Deduplicate by pipeline — show each pipeline once with its latest run status
        const seen = new Set<string>();
        const pItems: OverviewLineItem[] = [];
        for (const l of sorted) {
            const key = l.pipeline?.id ?? l.id;
            if (!seen.has(key)) {
                seen.add(key);
                pItems.push({
                    id: l.id,
                    label: l.pipeline?.name ?? "Pipeline sync",
                    sub: timeAgo(l.createdAt),
                    status: l.status === "success" ? "ok" : l.status === "error" ? "error" : "pending",
                });
            }
            if (pItems.length >= 3) break;
        }
        return {
            recentLogs: sorted.slice(0, 3),
            successCount: successes,
            errorCount: errors,
            pipelineItems: pItems,
        };
    }, [syncLogs]);

    const reportItems: OverviewLineItem[] = recentLogs.map((l) => ({
        id: l.id,
        label: l.pipeline?.name ?? "Pipeline sync",
        sub: timeAgo(l.createdAt),
        status: l.status === "success" ? "ok" : l.status === "error" ? "error" : "pending",
    }));

    const noReportsYet = syncLogs.length === 0;

    return (
        <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="pillar-fade" style={{ animationDelay: "0ms" }}>
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

            <div className="pillar-fade" style={{ animationDelay: "60ms" }}>
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

            <div className="pillar-fade md:col-span-2" style={{ animationDelay: "120ms" }}>
                <SectionOverviewCard
                    icon={<GitMerge className="h-5 w-5" />}
                    title="Pipelines"
                    subtitle="Active sync jobs"
                    emphasis
                    kpi={
                        totalPipelines > 0
                            ? { label: "Healthy", value: `${healthyCount}/${totalPipelines}` }
                            : undefined
                    }
                    items={pipelineItems}
                    emptyHint="Pipelines are created automatically when you connect a source and a destination."
                    ctaLabel={totalPipelines ? "See sync history" : undefined}
                    ctaHref={totalPipelines ? "/reports" : undefined}
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
                />
            </div>
        </div>
    );
}
