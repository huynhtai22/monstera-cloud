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
        color: "text-cyan-500",
        bg: "bg-cyan-500/10 border-cyan-500/20",
        title: "1. Connect your ad platforms",
        body: "Link Meta Ads, Google Ads, and TikTok for Business via OAuth in the Data Sources console. Monstera requests read-only access — it never touches your ad budgets or campaigns.",
    },
    {
        icon: RefreshCw,
        color: "text-violet-400",
        bg: "bg-violet-500/10 border-violet-500/20",
        title: "2. Sync your data",
        body: "Trigger a manual sync or set a schedule. Monstera pulls campaign-level metrics (spend, impressions, clicks, conversions, revenue) into your workspace. Each run is logged with row counts and any errors.",
    },
    {
        icon: Key,
        color: "text-amber-400",
        bg: "bg-amber-500/10 border-amber-500/20",
        title: "3. Create a workspace API key",
        body: "Go to Settings → API Keys and generate a key scoped to your workspace. This key authenticates the Looker Studio connector and the Google Sheets add-on — no separate OAuth inside either tool.",
    },
    {
        icon: BarChart3,
        color: "text-emerald-400",
        bg: "bg-emerald-500/10 border-emerald-500/20",
        title: "4. Build reports",
        body: "Add the Monstera community connector in Looker Studio, paste your API key, choose a date range, and start building dashboards. Or use the Google Sheets add-on to pull the same data into a spreadsheet.",
    },
];

const capabilities = [
    {
        icon: Clock,
        title: "Scheduled syncs",
        body: "Run pipelines on a cron schedule — from daily to hourly on Pro plans. Monstera handles retries and rate-limit back-off automatically.",
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
        <div className="mx-auto max-w-4xl px-6 pt-28 pb-24">
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">
                How it works
            </p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
                Ad data, where you already work
            </h1>
            <p className="mt-4 text-base text-slate-300 leading-relaxed max-w-2xl">
                Monstera connects your ad platforms to the reporting tools your team already uses —
                Looker Studio and Google Sheets — without a data warehouse or custom ETL pipeline.
            </p>

            {/* Steps */}
            <div className="mt-14 space-y-4">
                {steps.map((step) => {
                    const Icon = step.icon;
                    return (
                        <div
                            key={step.title}
                            className={`flex gap-5 rounded-2xl border p-6 ${step.bg}`}
                        >
                            <Icon className={`h-6 w-6 shrink-0 mt-0.5 ${step.color}`} aria-hidden />
                            <div>
                                <h2 className="text-sm font-bold text-white">{step.title}</h2>
                                <p className="mt-1 text-sm text-slate-400 leading-relaxed">{step.body}</p>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Capabilities */}
            <h2 className="mt-20 text-xl font-bold text-white">What's included</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {capabilities.map((cap) => {
                    const Icon = cap.icon;
                    return (
                        <div
                            key={cap.title}
                            className="rounded-xl border border-slate-800 bg-slate-950/40 p-5"
                        >
                            <Icon className="h-5 w-5 text-cyan-500 mb-3" aria-hidden />
                            <h3 className="text-sm font-semibold text-white">{cap.title}</h3>
                            <p className="mt-1 text-xs text-slate-400 leading-relaxed">{cap.body}</p>
                        </div>
                    );
                })}
            </div>

            {/* CTA */}
            <div className="mt-16 flex flex-col sm:flex-row gap-4">
                <Link
                    href="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 px-6 py-3 text-sm font-semibold text-white transition-colors"
                >
                    Start free
                    <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                    href="/looker-studio"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 hover:border-slate-500 px-6 py-3 text-sm font-semibold text-slate-300 hover:text-white transition-colors"
                >
                    Looker Studio guide
                </Link>
            </div>
        </div>
    );
}
