"use client";

import Link from "next/link";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to fetch");
    return data;
};

/**
 * Sticky strip when workspace demo/mock data is enabled — clarifies that metrics may include samples.
 */
export function DemoModeBanner() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: workspaces } = useSWR("/api/workspaces", fetcher);
    const active = Array.isArray(workspaces)
        ? workspaces.find((w: { id: string }) => w.id === activeWorkspaceId) || workspaces[0]
        : null;
    const demoOn = !!(active as { demoMockMode?: boolean } | null)?.demoMockMode;

    if (!demoOn) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="sticky top-0 z-30 flex w-full items-center justify-center gap-2 border-b border-violet-200/90 bg-violet-50/95 px-3 py-2 text-center shadow-sm backdrop-blur-sm dark:border-violet-900/60 dark:bg-violet-950/85 sm:justify-between sm:px-4 sm:text-left"
        >
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 sm:justify-start">
                <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60 dark:bg-violet-300" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-600 dark:bg-violet-400" />
                </span>
                <p className="min-w-0 text-xs font-medium text-violet-950 dark:text-violet-100">
                    <span className="font-semibold">Demo data on</span>
                    <span className="hidden sm:inline">
                        {" "}
                        — charts, ROAS, and client lists may include sample rows. Real connections are unchanged.
                    </span>
                    <span className="sm:hidden"> — sample data mixed in.</span>
                </p>
            </div>
            <Link
                href="/settings?tab=workspace#product-demo"
                className="shrink-0 rounded-lg border border-violet-300/80 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-violet-900 shadow-sm transition hover:bg-violet-100 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-100 dark:hover:bg-violet-950/80"
            >
                Settings
            </Link>
        </div>
    );
}
