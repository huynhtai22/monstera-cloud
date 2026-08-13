"use client";

import { Database, KeyRound, Plug } from "lucide-react";
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
    lastSyncAt?: string | null;
};

type PillarGridProps = {
    connections: Connection[];
    healthyCount: number;
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

const STALE_MINUTES = 26 * 60;

function isStale(lastSyncAt?: string | null): boolean {
    if (!lastSyncAt) return true;
    const mins = Math.max(0, Math.round((Date.now() - new Date(lastSyncAt).getTime()) / 60000));
    return mins > STALE_MINUTES;
}

function healthStatus(c: Connection): "healthy" | "stale" | "error" | "unknown" {
    if (c.status === "error") return "error";
    if (c.status !== "connected") return "unknown";
    return isStale(c.lastSyncAt) ? "stale" : "healthy";
}

function prettyProvider(provider: string) {
    return PROVIDER_LABELS[provider] ?? provider.replace(/_/g, " ");
}

// Note: timeAgo and formatSyncTime now imported from @/lib/time-format

export function PillarGrid({
    connections,
    healthyCount,
}: PillarGridProps) {
    const sources = connections.filter((c) => c.type === "source");

    const sourceItems: OverviewLineItem[] = sources.slice(0, 3).map((c) => {
        const health = healthStatus(c);
        
        // P1: Use timezone-aware formatting for last sync
        const timeInfo = timeAgo(c.lastSyncAt, { staleThresholdMins: STALE_MINUTES });
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



    return (
        <div className="relative z-10 stagger-list flex flex-col gap-5">
            <div className="stagger-item min-w-0">
                <SectionOverviewCard
                    icon={<Plug className="h-5 w-5" />}
                    title="Sources"
                    subtitle="Where data comes from"
                    accent="emerald"
                    kpi={{ label: "Connected", value: String(sources.length) }}
                    items={sourceItems}
                    emptyHint="No sources connected. Add TikTok, Meta, or Shopee to start syncing."
                    ctaLabel={sources.length ? "Manage sources" : "Connect a source"}
                    ctaHref="/sources"
                />
            </div>



            <div className="stagger-item min-w-0">
                <SectionOverviewCard
                    icon={<Database className="h-5 w-5" />}
                    title="Warehouse"
                    subtitle="Imported source freshness"
                    emphasis
                    accent="cyan"
                    kpi={
                        sources.length > 0
                            ? { label: "Fresh", value: `${healthyCount}/${sources.length}` }
                            : undefined
                    }
                    items={sourceItems}
                    emptyHint="Run the first source import to populate the warehouse."
                    ctaLabel="Open Data Explorer"
                    ctaHref="/explorer?tab=warehouse"
                />
            </div>

            <div className="stagger-item min-w-0">
                <SectionOverviewCard
                    icon={<KeyRound className="h-5 w-5" />}
                    title="Exports & API"
                    subtitle="Sheets, Looker Studio, and API access"
                    accent="indigo"
                    items={[]}
                    emptyHint="Choose this workspace explicitly in Sheets or Looker Studio, or issue a workspace API key."
                    ctaLabel="Configure access"
                    ctaHref="/settings?tab=api"
                />
            </div>
        </div>
    );
}
