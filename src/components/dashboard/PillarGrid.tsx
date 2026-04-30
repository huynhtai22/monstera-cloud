"use client";

import { useMemo } from "react";
import { GitMerge, Plug, Send, FileBarChart2 } from "lucide-react";
import { SectionOverviewCard, type OverviewLineItem } from "@/components/dashboard/SectionOverviewCard";
import { logoPathForConnectionProvider } from "@/lib/integration-logos";
import { timeAgo } from "@/lib/time-format";

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

const STALE_MINUTES = 6 * 60; // 6 hours = stale for marketplace sources

function isStale(updatedAt?: string | null, provider?: string): boolean {
    if (!updatedAt) return true;
    const mins = Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000));
    // Ad platforms (frequent updates) vs marketplaces (batch syncs)
    const threshold = provider?.includes("shop") || provider === "shopee" || provider === "lazada" 
        ? STALE_MINUTES 
        : 60; // 1 hour for ads
    return mins > threshold;
}

function healthStatus(c: Connection): "healthy" | "stale" | "error" | "unknown" {
    if (c.status === "error") return "error";
    if (c.status !== "connected") return "unknown";
    return isStale(c.updatedAt, c.provider) ? "stale" : "healthy";
}

function prettyProvider(provider: string) {
    return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

// Note: timeAgo and formatSyncTime now imported from @/lib/time-format

export function PillarGrid({
    connections,
    syncLogs,
    healthyCount,
    totalPipelines,
}: PillarGridProps) {
    const sources = connections.filter((c) => c.type === "source");
    const destinations = connections.filter((c) => c.type === "destination");

    const sourceItems: OverviewLineItem[] = sources.slice(0, 3).map((c) => {
        const health = healthStatus(c);
        
        // P1: Use timezone-aware formatting for last sync
        const timeInfo = timeAgo(c.updatedAt, { staleThresholdMins: STALE_MINUTES });
        const subText = health === "error" 
            ? "Connection error"
            : health === "stale"
            ? `Last sync ${timeInfo.text ?? "unknown"}`
            : timeInfo.text ?? "Pending first sync";
        
        // P1: Extract account information from name for multi-account sources
        const accountHint = c.name?.includes("(")
            ? c.name.split("(")[1]?.replace(")", "")
            : undefined;
        const accountCountMatch = c.name?.match(/(\d+)\s*account/);
        const accountCount = accountCountMatch ? parseInt(accountCountMatch[1]) : undefined;

        return {
            id: c.id,
            label: c.name?.trim() ? c.name! : prettyProvider(c.provider),
            sub: subText,
            logoSrc: logoPathForConnectionProvider(c.provider),
            status: health === "error" ? "error" : health === "healthy" ? "ok" : "pending",
            accountCount: accountCount && accountCount > 1 ? accountCount : undefined,
            accountHint: accountHint,
        };
    });

    const destinationItems: OverviewLineItem[] = destinations.slice(0, 3).map((c) => {
        const health = healthStatus(c);
        const timeInfo = timeAgo(c.updatedAt);
        const subText = health === "error"
            ? "Connection error"
            : health === "stale"
            ? `Last used ${timeInfo.text ?? "unknown"}`
            : c.status === "connected" ? "Connected" : c.status ?? "Pending";
        return {
            id: c.id,
            label: c.name?.trim() ? c.name! : prettyProvider(c.provider),
            sub: subText,
            logoSrc: logoPathForConnectionProvider(c.provider),
            status: health === "error" ? "error" : health === "healthy" ? "ok" : "pending",
        };
    });

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
                const timeInfo = timeAgo(l.createdAt);
                pItems.push({
                    id: l.id,
                    label: l.pipeline?.name ?? "Pipeline sync",
                    sub: timeInfo.text,
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

    const reportItems: OverviewLineItem[] = recentLogs.map((l) => {
        const timeInfo = timeAgo(l.createdAt);
        return {
            id: l.id,
            label: l.pipeline?.name ?? "Pipeline sync",
            sub: timeInfo.text,
            status: l.status === "success" ? "ok" : l.status === "error" ? "error" : "pending",
        };
    });

    const noReportsYet = syncLogs.length === 0;

    return (
        <div className="relative z-10 stagger-list grid grid-cols-1 gap-4 md:grid-cols-2" style={{ gridAutoRows: "minmax(160px, auto)" }}>
            <div className="stagger-item min-w-0">
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

            <div className="stagger-item min-w-0">
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

            <div className="stagger-item min-w-0">
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

            <div className="stagger-item min-w-0">
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
