"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface HealthGaugeProps {
    healthyCount: number;
    totalPipelines: number;
    size?: "sm" | "md" | "lg";
    showLabel?: boolean;
    animated?: boolean;
}

export function HealthGauge({
    healthyCount,
    totalPipelines,
    size = "md",
    showLabel = true,
    animated = true,
}: HealthGaugeProps) {
    const percentage = totalPipelines > 0 ? (healthyCount / totalPipelines) * 100 : 0;
    
    // Center label + ring tint (SVG stroke uses separate currentColor classes below)
    const getColor = (pct: number) => {
        if (pct === 100)
            return { text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-200/80 dark:ring-emerald-500/25" };
        if (pct >= 85)
            return { text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-200/80 dark:ring-amber-500/25" };
        return { text: "text-red-600 dark:text-red-400", ring: "ring-red-200/80 dark:ring-red-500/25" };
    };

    const colors = getColor(percentage);
    
    // Ring + label scale together: the previous md size was too small for bold % text.
    const sizeMap = {
        sm: {
            box: "h-12 w-12",
            viewBox: 40,
            r: 16,
            stroke: 2,
            pct: "text-[10px] font-semibold leading-none",
            sub: "text-[7px] font-medium leading-none",
            ratio: "text-[9px] font-semibold tabular-nums",
        },
        md: {
            box: "h-[5.5rem] w-[5.5rem]",
            viewBox: 40,
            r: 16,
            stroke: 2.5,
            pct: "text-xs font-bold leading-none tracking-tight",
            sub: "text-[9px] font-medium leading-none text-slate-500 dark:text-slate-400",
            ratio: "text-[10px] font-semibold tabular-nums",
        },
        lg: {
            box: "h-24 w-24",
            viewBox: 40,
            r: 16,
            stroke: 2.5,
            pct: "text-sm font-extrabold leading-none",
            sub: "text-[10px] font-medium leading-none",
            ratio: "text-xs font-semibold tabular-nums",
        },
    } as const;

    const s = sizeMap[size];
    const c = s.viewBox / 2;
    const circumference = 2 * Math.PI * s.r;
    const offset = circumference * ((100 - percentage) / 100);
    // stroke color for SVG — bg-* on circle stroke doesn't work; use currentColor
    const strokeClass =
        percentage === 100
            ? "text-emerald-500 dark:text-emerald-400"
            : percentage >= 85
              ? "text-amber-500 dark:text-amber-400"
              : "text-red-500 dark:text-red-400";

    return (
        <div className="flex flex-col items-center gap-1.5">
            <div
                className={cn(
                    "relative flex items-center justify-center rounded-full p-0.5 ring-1",
                    s.box,
                    colors.ring,
                    "bg-gradient-to-b from-white to-slate-50/90 shadow-sm ring-inset dark:from-slate-800 dark:to-slate-900/90"
                )}
            >
                <svg
                    viewBox={`0 0 ${s.viewBox} ${s.viewBox}`}
                    className="absolute -rotate-90"
                    style={{ width: "100%", height: "100%" }}
                >
                    <circle
                        cx={c}
                        cy={c}
                        r={s.r}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={s.stroke}
                        className="text-slate-200/90 dark:text-slate-600"
                    />
                    <circle
                        cx={c}
                        cy={c}
                        r={s.r}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={s.stroke + 0.2}
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className={cn(
                            strokeClass,
                            animated && "transition-[stroke-dashoffset] duration-500 ease-out",
                        )}
                    />
                </svg>
                
                {/* Center text */}
                <div className="flex flex-col items-center justify-center px-1.5 text-center">
                    <span className={cn(s.pct, colors.text)}>{Math.round(percentage)}%</span>
                    {size !== "sm" && <span className={cn("mt-0.5", s.sub)}>healthy</span>}
                </div>
            </div>

            {showLabel && size !== "sm" && (
                <div
                    className={cn(
                        "text-center text-slate-500 dark:text-slate-400",
                        s.ratio
                    )}
                >
                    <span className="text-slate-700 dark:text-slate-200">{healthyCount}</span>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span>{totalPipelines}</span>
                </div>
            )}
        </div>
    );
}
