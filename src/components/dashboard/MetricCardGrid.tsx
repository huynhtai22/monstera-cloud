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
                Run a sync to populate spend and ROAS cards.
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
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
                <div key={c.label} className={cn(tokens.card, "p-5")}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{c.label}</div>
                    <div className="mt-2 flex items-end justify-between gap-2">
                        <div className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">{c.value}</div>
                        {c.delta ? (
                            <span
                                className={cn(
                                    "inline-flex items-center gap-0.5 text-xs font-semibold",
                                    c.delta.positive ? "text-cyan-600 dark:text-cyan-400" : "text-red-600 dark:text-red-400"
                                )}
                            >
                                {c.delta.positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                                {c.delta.label}
                            </span>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
}
