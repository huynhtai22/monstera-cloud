"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bell, AlertCircle, CheckCircle2, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed");
    return data;
};

type NotifItem = { id: string; title: string; detail: string; href?: string; tone: "error" | "warn" | "info" };

export function NotificationCenter() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const [open, setOpen] = useState(false);
    const [shouldRenderPanel, setShouldRenderPanel] = useState(false);
    const [isPanelVisible, setIsPanelVisible] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const { data: workspaces } = useSWR("/api/workspaces", fetcher);
    const { data: errLogs } = useSWR(
        activeWorkspaceId ? `/api/sync-logs?workspaceId=${activeWorkspaceId}&status=error` : null,
        fetcher
    );

    useEffect(() => {
        if (open) {
            setShouldRenderPanel(true);
            const raf = requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsPanelVisible(true));
            });
            return () => cancelAnimationFrame(raf);
        }
        setIsPanelVisible(false);
        const t = setTimeout(() => setShouldRenderPanel(false), 150);
        return () => clearTimeout(t);
    }, [open]);

    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const items: NotifItem[] = useMemo(() => {
        const out: NotifItem[] = [];
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return out;
        const ws = workspaces.find((w: { id: string }) => w.id === activeWorkspaceId);
        if (ws?.health?.failingConnections > 0) {
            out.push({
                id: `workspace-${ws.id}`,
                title: `${ws.health.failingConnections} source${ws.health.failingConnections === 1 ? "" : "s"} need attention`,
                detail: "Open Sources for diagnostics and reconnection.",
                href: "/sources",
                tone: "error",
            });
        }
        const logs = (errLogs?.logs ?? []) as Array<{ id: string; errorMsg?: string; pipeline?: { name: string }; createdAt: string }>;
        for (const l of logs.slice(0, 8)) {
            out.push({
                id: `log-${l.id}`,
                title: `Sync failed: ${l.pipeline?.name ?? "Pipeline"}`,
                detail: (l.errorMsg ?? "").slice(0, 140),
                href: "/reports",
                tone: "error",
            });
        }
        return out.slice(0, 12);
    }, [workspaces, activeWorkspaceId, errLogs]);

    const count = items.length;

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-gray-300 dark:hover:bg-[#1d1f23]"
                aria-expanded={open}
                aria-label={count ? `Notifications, ${count} issues` : "Notifications"}
            >
                <Bell className="h-5 w-5" />
                {count > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                        {count > 9 ? "9+" : count}
                    </span>
                ) : null}
            </button>

            {shouldRenderPanel ? (
                <div className={cn(
                    "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(100vw-2rem,22rem)] rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-[#2f3336] dark:bg-[#000000]",
                    "transition-all duration-150 ease-out",
                    isPanelVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
                )}>
                    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-[#2f3336]">
                        <span className="text-sm font-bold text-gray-900 dark:text-white">Notifications</span>
                        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-[#16181c]" aria-label="Close">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="max-h-[min(70vh,24rem)] overflow-y-auto p-2">
                        {items.length === 0 ? (
                            <p className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No issues right now.</p>
                        ) : (
                            <ul className="space-y-1">
                                {items.map((it) => (
                                    <li key={it.id}>
                                        {it.href ? (
                                            <Link
                                                href={it.href}
                                                onClick={() => setOpen(false)}
                                                className={cn(
                                                    "flex gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-[#16181c]",
                                                    it.tone === "error" && "hover:bg-red-50/80 dark:hover:bg-red-950/30"
                                                )}
                                            >
                                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                                <span>
                                                    <span className="block text-sm font-semibold text-gray-900 dark:text-white">{it.title}</span>
                                                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{it.detail}</span>
                                                </span>
                                            </Link>
                                        ) : (
                                            <div className="flex gap-2 rounded-xl px-3 py-2.5">
                                                <CheckCircle2 className="h-4 w-4 text-cyan-500" />
                                                <span className="text-sm text-gray-700 dark:text-gray-300">{it.title}</span>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="border-t border-gray-100 px-3 py-2 dark:border-[#2f3336]">
                        <Link href="/reports" onClick={() => setOpen(false)} className="block text-center text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-300">
                            Open Reports & logs
                        </Link>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
