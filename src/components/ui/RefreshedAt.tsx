"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";

function useRelativeTime(date: Date | null): string {
    const [label, setLabel] = useState<string>("Just now");

    useEffect(() => {
        if (!date) return;
        const update = () => {
            const sec = Math.floor((Date.now() - date.getTime()) / 1000);
            if (sec < 60) setLabel("Just now");
            else if (sec < 3600) setLabel(`${Math.floor(sec / 60)}m ago`);
            else setLabel(`${Math.floor(sec / 3600)}h ago`);
        };
        update();
        const t = setInterval(update, 30_000);
        return () => clearInterval(t);
    }, [date]);

    return label;
}

type RefreshedAtProps = {
    onRefresh: () => void;
    loading?: boolean;
};

/**
 * X1 — small "Refreshed X ago · ↻" control.
 * Resets its internal clock whenever the parent calls onRefresh.
 * Pass loading=true while data is re-fetching to show the spinner.
 */
export function RefreshedAt({ onRefresh, loading = false }: RefreshedAtProps) {
    const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());
    const label = useRelativeTime(refreshedAt);

    const handleClick = useCallback(() => {
        onRefresh();
        setRefreshedAt(new Date());
    }, [onRefresh]);

    return (
        <button
            type="button"
            onClick={handleClick}
            title="Refresh page data"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-slate-500 dark:hover:bg-[#16181c] dark:hover:text-slate-300"
        >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refreshed</span> {label}
        </button>
    );
}
