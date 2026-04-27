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
    
    // Determine color based on health percentage
    const getColor = (pct: number) => {
        if (pct === 100) return { bg: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-200 dark:ring-emerald-500/30" };
        if (pct >= 85) return { bg: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-200 dark:ring-amber-500/30" };
        return { bg: "bg-red-500", text: "text-red-600 dark:text-red-400", ring: "ring-red-200 dark:ring-red-500/30" };
    };

    const colors = getColor(percentage);
    
    // Sizes
    const sizeMap = {
        sm: { container: "w-12 h-12", text: "text-xs", label: "text-[10px]" },
        md: { container: "w-16 h-16", text: "text-sm", label: "text-xs" },
        lg: { container: "w-20 h-20", text: "text-base", label: "text-xs" },
    };

    const dimensions = sizeMap[size];
    const circumference = 2 * Math.PI * 18; // r=18 for a 40px diameter circle
    const offset = circumference * ((100 - percentage) / 100);

    return (
        <div className="flex flex-col items-center gap-2">
            <div
                className={cn(
                    "relative flex items-center justify-center rounded-full ring-2",
                    dimensions.container,
                    colors.ring,
                    "bg-gray-50 dark:bg-slate-800"
                )}
            >
                <svg
                    viewBox="0 0 40 40"
                    className="absolute -rotate-90"
                    style={{ width: "100%", height: "100%" }}
                >
                    {/* Background circle */}
                    <circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="text-gray-200 dark:text-slate-700"
                    />
                    {/* Progress circle */}
                    <circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeDasharray={circumference}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className={cn(colors.bg, "transition-all duration-500 ease-out")}
                        style={animated ? { "--offset": offset } as React.CSSProperties : undefined}
                    />
                </svg>
                
                {/* Center text */}
                <div className="flex flex-col items-center text-center">
                    <span className={cn(dimensions.text, "font-bold", colors.text)}>
                        {Math.round(percentage)}%
                    </span>
                    {size !== "sm" && (
                        <span className={cn(dimensions.label, "text-gray-500 dark:text-gray-400")}>
                            healthy
                        </span>
                    )}
                </div>
            </div>

            {showLabel && size !== "sm" && (
                <div className="text-center text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-semibold">{healthyCount}</span>
                    <span className="text-gray-400 dark:text-gray-600">/</span>
                    <span>{totalPipelines}</span>
                </div>
            )}
        </div>
    );
}
