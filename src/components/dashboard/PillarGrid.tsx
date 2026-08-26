"use client";

import { Database, KeyRound, Plug, ArrowRight, ChevronRight, FileSpreadsheet, BarChart2, ShieldCheck, HardDrive } from "lucide-react";
import { SectionOverviewCard, type OverviewLineItem } from "@/components/dashboard/SectionOverviewCard";
import { logoPathForConnectionProvider, INTEGRATION_LOGOS } from "@/lib/integration-logos";
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

export function PillarGrid({
    connections,
    healthyCount,
}: PillarGridProps) {
    const sources = connections.filter((c) => c.type === "source");

    // 01 · SOURCES LINE ITEMS
    const sourceItems: OverviewLineItem[] = sources.slice(0, 4).map((c) => {
        const health = healthStatus(c);
        const timeInfo = timeAgo(c.lastSyncAt, { staleThresholdMins: STALE_MINUTES });
        const subText = health === "error"
            ? "Sync error"
            : health === "stale"
            ? `Sync stale · ${timeInfo.text ?? "unknown"}`
            : timeInfo.text ?? "Pending first sync";

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
            href: `/sources/${c.id}`,
            badge: health === "healthy" ? "LIVE" : health === "error" ? "ERROR" : "PENDING",
        };
    });

    // 02 · WAREHOUSE LINE ITEMS
    const warehouseItems: OverviewLineItem[] = [
        {
            id: "ad_insights_daily",
            label: "ad_insights_daily",
            sub: "Normalized performance schema",
            status: healthyCount > 0 ? "ok" : "pending",
            badge: "DUCKDB / PG",
            href: "/explorer?table=ad_insights_daily",
        },
        {
            id: "campaign_metrics_hourly",
            label: "campaign_metrics_hourly",
            sub: "Hourly pacing & attribution",
            status: healthyCount > 0 ? "ok" : "pending",
            badge: "HOURLY",
            href: "/explorer?table=campaign_metrics_hourly",
        },
        {
            id: "multi_tenant_isolation",
            label: "Schema Guard & Isolation",
            sub: "Multi-tenant tenant query guard",
            status: "ok",
            badge: "ACTIVE",
            href: "/reports",
        },
    ];

    // 03 · EXPORTS & API LINE ITEMS
    const exportItems: OverviewLineItem[] = [
        {
            id: "dest_google_sheets",
            label: "Google Sheets™ Add-on",
            sub: "On-demand pull & hourly refresh",
            logoSrc: INTEGRATION_LOGOS.googleSheets,
            status: "ok",
            badge: "PRIVATE BETA",
            href: "/exports",
        },
        {
            id: "dest_looker_studio",
            label: "Looker Studio™ Connector",
            sub: "Direct warehouse analytics feed",
            logoSrc: INTEGRATION_LOGOS.looker,
            status: "ok",
            badge: "CONNECTOR",
            href: "/exports",
        },
        {
            id: "dest_workspace_api",
            label: "Workspace API Keys",
            sub: "REST warehouse query endpoints",
            status: "ok",
            badge: "REST V1",
            href: "/settings?tab=api",
        },
    ];

    return (
        <div className="relative z-10">
            {/* Header Title with Subtitle */}
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold tracking-tight text-ink">
                        Pipeline Architecture
                    </h2>
                    <p className="text-xs text-ink-mute mt-0.5">
                        End-to-end data flow from advertising channels to warehouse and downstream reporting tools.
                    </p>
                </div>
            </div>

            {/* 3-Node Connected Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 relative items-stretch">
                
                {/* ── STAGE 01: SOURCES ────────────────────────────────────────────── */}
                <div className="relative min-w-0">
                    <SectionOverviewCard
                        stepNumber="01"
                        stepLabel="Ingestion"
                        icon={<Plug className="h-4 w-4" />}
                        title="Sources"
                        subtitle="Connected ad networks & channels"
                        kpi={{ label: "Connected", value: `${sources.length}` }}
                        items={sourceItems}
                        emptyHint="No ad sources connected yet."
                        emptyAction={{ label: "Connect Source", href: "/sources" }}
                        ctaLabel={sources.length ? "Manage sources" : "Connect a source"}
                        ctaHref="/sources"
                    />
                    
                    {/* Desktop Connector Stream to Stage 2 */}
                    <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-20 h-6 w-6 items-center justify-center rounded-full bg-panel border border-line text-ink-mute shadow-2xs">
                        <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                </div>

                {/* ── STAGE 02: WAREHOUSE ─────────────────────────────────────────── */}
                <div className="relative min-w-0">
                    <SectionOverviewCard
                        stepNumber="02"
                        stepLabel="Warehouse"
                        icon={<Database className="h-4 w-4" />}
                        title="Normalized Tables"
                        subtitle="Zero-loss data warehouse storage"
                        emphasis
                        kpi={
                            sources.length > 0
                                ? { label: "Fresh", value: `${healthyCount}/${sources.length}` }
                                : { label: "Engine", value: "PostgreSQL" }
                        }
                        items={warehouseItems}
                        emptyHint="Run the first source import to populate the warehouse."
                        ctaLabel="Open SQL Workbench"
                        ctaHref="/explorer?tab=warehouse"
                    />

                    {/* Desktop Connector Stream to Stage 3 */}
                    <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-20 h-6 w-6 items-center justify-center rounded-full bg-panel border border-line text-ink-mute shadow-2xs">
                        <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                </div>

                {/* ── STAGE 03: EXPORTS & DESTINATIONS ────────────────────────────── */}
                <div className="relative min-w-0">
                    <SectionOverviewCard
                        stepNumber="03"
                        stepLabel="Activation"
                        icon={<KeyRound className="h-4 w-4" />}
                        title="Exports & Connectors"
                        subtitle="Google Sheets, Looker Studio & API"
                        kpi={{ label: "Channels", value: "3 Active" }}
                        items={exportItems}
                        emptyHint="Issue a workspace API key or install the Google Sheets Add-on."
                        ctaLabel="Configure exports"
                        ctaHref="/exports"
                    />
                </div>

            </div>
        </div>
    );
}
