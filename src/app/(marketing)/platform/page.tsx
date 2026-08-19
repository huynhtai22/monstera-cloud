import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plug, RefreshCw, BarChart3, Key, Clock, ShieldCheck } from "lucide-react";
import { PRODUCT_SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
    title: "How Monstera works",
    description: "Connect Meta Ads, Google Ads, and TikTok for Business to Looker Studio and Google Sheets with a workspace API key.",
    alternates: { canonical: `${PRODUCT_SITE_URL}/platform` },
};

const steps = [
    {
        icon: Plug,
        title: "1. Connect your ad platforms",
        body: "Link Meta Ads, Google Ads, and TikTok for Business via OAuth in the Data Sources console. Monstera requests read-only access — it never touches your ad budgets or campaigns.",
    },
    {
        icon: RefreshCw,
        title: "2. Sync your data",
        body: "Trigger a manual sync or set a schedule. Monstera pulls campaign-level metrics (spend, impressions, clicks, conversions, revenue) into your workspace. Each run is logged with row counts and any errors.",
    },
    {
        icon: Key,
        title: "3. Create a workspace API key",
        body: "Go to Settings → API Keys and generate a key scoped to your workspace. This key authenticates the Looker Studio connector and the Google Sheets add-on — no separate OAuth inside either tool.",
    },
    {
        icon: BarChart3,
        title: "4. Build reports",
        body: "Add the Monstera community connector in Looker Studio, paste your API key, choose a date range, and start building dashboards. Or use the Google Sheets add-on to pull the same data into a spreadsheet.",
    },
];

const capabilities = [
    {
        icon: Clock,
        title: "Scheduled syncs",
        body: "Refresh on demand or use the nightly warehouse run. Monstera handles retries and rate-limit back-off automatically.",
    },
    {
        icon: ShieldCheck,
        title: "Credential security",
        body: "OAuth tokens and API keys are encrypted at rest and scoped per workspace. Revoke any key from Settings at any time.",
    },
    {
        icon: BarChart3,
        title: "Multi-platform in one report",
        body: "Meta Ads, Google Ads, and TikTok data share a consistent schema — dimensions like date, platform, campaign, and ad set work the same way across all sources.",
    },
    {
        icon: RefreshCw,
        title: "Sync logs",
        body: "Every pipeline run records the number of rows synced, errors, and timestamps. Re-trigger any failed run directly from the console.",
    },
];

export default function PlatformPage() {
    return (
        <div className="mx-auto max-w-4xl px-6 pt-28 pb-24 font-sans text-ink">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                <span>How it works</span>
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                Ad data, where you already work
            </h1>
            <p className="mt-4 text-sm sm:text-base text-ink-mute leading-relaxed max-w-2xl font-normal">
                Monstera connects your ad platforms to the reporting tools your team already uses —
                Looker Studio and Google Sheets — without a data warehouse or custom ETL pipeline.
            </p>

            {/* Steps */}
            <div className="mt-12 space-y-4">
                {steps.map((step) => {
                    const Icon = step.icon;
                    return (
                        <div
                            key={step.title}
                            className="flex gap-4 rounded-lg border border-line bg-panel p-6"
                        >
                            <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center shrink-0 text-accent">
                                <Icon className="h-5 w-5" aria-hidden />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-ink">{step.title}</h2>
                                <p className="mt-1 text-xs text-ink-mute leading-relaxed">{step.body}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Capabilities */}
            <h2 className="mt-16 text-xl font-bold text-ink">What's included</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {capabilities.map((cap) => {
                    const Icon = cap.icon;
                    return (
                        <div
                            key={cap.title}
                            className="rounded-lg border border-line bg-panel p-5"
                        >
                            <Icon className="h-4 w-4 text-accent mb-3" aria-hidden />
                            <h3 className="text-sm font-semibold text-ink">{cap.title}</h3>
                            <p className="mt-1 text-xs text-ink-mute leading-relaxed">{cap.body}</p>
                        </div>
                    );
                })}
            </div>

            {/* CTA */}
            <div className="mt-14 flex flex-col sm:flex-row gap-3">
                <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-white hover:bg-neutral-200 px-6 py-2.5 text-xs font-semibold text-black transition-colors shadow-xs"
                >
                    Start free pilot
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
                <Link
                    href="/looker-studio"
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-panel hover:bg-[#16181c] px-6 py-2.5 text-xs font-semibold text-ink transition-colors"
                >
                    Looker Studio guide
                </Link>
            </div>
        </div>
    );
}
