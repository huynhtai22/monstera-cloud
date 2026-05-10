"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import tokens from "@/components/ui/system/tokens.module.css";

type Snapshot = { date: string; netRoas: number; adSpend: number; attributedRevenue: number };

function deltaPct(current: number, previous: number | null): { label: string; positive: boolean } | null {
    if (previous === null || !Number.isFinite(previous) || previous === 0) return null;
    const raw = ((current - previous) / Math.abs(previous)) * 100;
    if (!Number.isFinite(raw)) return null;
    const rounded = Math.round(raw * 10) / 10;
    return {
        label: `${rounded >= 0 ? "+" : ""}${rounded}% DoD`,
        positive: rounded >= 0,
    };
}

export function MetricCardGrid({ snapshots }: { snapshots: Snapshot[] }) {
    const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
    const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

    if (!latest) {
        return (
            <div className={cn(tokens["card-muted"], "mb-8 text-sm text-gray-500 dark:text-gray-400")}>
                Run a sync to populate spend and ROAS.
            </div>
        );
    }

    const spendDelta = deltaPct(latest.adSpend, prev?.adSpend ?? null);
    const roasDelta = deltaPct(latest.netRoas, prev?.netRoas ?? null);
    const revDelta = deltaPct(latest.attributedRevenue, prev?.attributedRevenue ?? null);

    const cards = [
        {
            label: "Ad spend",
            value: Number(latest.adSpend ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 }),
            delta: spendDelta,
        },
        {
            label: "Net ROAS",
            value: Number(latest.netRoas ?? 0).toFixed(2) + "×",
            delta: roasDelta,
        },
        {
            label: "Attributed revenue",
            value: Number(latest.attributedRevenue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 }),
            delta: revDelta,
        },
        {
            label: "Report date",
            value: new Date(latest.date).toLocaleDateString(),
            delta: null,
        },
    ];

    return (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c, idx) => (
                <div
                    key={c.label}
                    className={cn(
                        tokens.card,
                        "group relative overflow-hidden rounded-2xl p-5",
                        "border border-gray-200/80 dark:border-slate-600/50",
                        "shadow-sm hover:shadow-md hover:border-cyan-300/60 dark:hover:border-cyan-500/30",
                        "bg-gradient-to-br from-white to-gray-50/90 dark:from-slate-900/85 dark:to-slate-800/55",
                        "bento-hover",
                        "metric-card-enter"
                    )}
                    style={{ animationDelay: `${idx * 80}ms` }}
                >
                    {/* Accent glow on hover */}
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/0 to-primary/0 group-hover:from-primary/5 group-hover:to-primary/2 transition-all duration-300" />
                    
                    <div className="relative z-10">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {c.label}
                        </div>
                        <div className="mt-2 flex items-end justify-between gap-2">
                            <div className="text-xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
                                {c.value}
                            </div>
                            {c.delta ? (
                                <span
                                    className={cn(
                                        "inline-flex items-center gap-0.5 text-xs font-bold transition-all duration-200",
                                        c.delta.positive
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-red-600 dark:text-red-400"
                                    )}
                                >
                                    {c.delta.positive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                                    {c.delta.label}
                                </span>
                            ) : null}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
