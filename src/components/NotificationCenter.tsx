"use client";

import React, { useMemo, useState, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bell, AlertCircle, CheckCircle2, X } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useClientContextNavigation } from "@/components/client-context/useClientContextNavigation";
import type { OperationsSummary } from "@/lib/operations-summary";
import { consoleNotifications } from "@/lib/console-notifications";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed");
    return data;
};

export function NotificationCenter() {
    return <Suspense fallback={null}><NotificationInbox /></Suspense>;
}

function NotificationInbox() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { requestedRaw, hrefFor } = useClientContextNavigation();
    const [open, setOpen] = useState(false);
    const [shouldRenderPanel, setShouldRenderPanel] = useState(false);
    const [isPanelVisible, setIsPanelVisible] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const query = new URLSearchParams();
    if (activeWorkspaceId) query.set("workspaceId", activeWorkspaceId);
    if (requestedRaw) query.set("clientId", requestedRaw);
    const { data, error, isLoading, isValidating } = useSWR<OperationsSummary>(activeWorkspaceId ? `/api/operations/summary?${query}` : null, fetcher, { refreshInterval: 60_000, keepPreviousData: false });
    const scoped = data?.workspaceId === activeWorkspaceId && (data?.clientContext?.client?.id ?? "all") === (requestedRaw || "all");
    const items = useMemo(() => !error && scoped && data?.sections ? consoleNotifications(data) : [], [data, error, scoped]);
    const unavailable = Boolean(error || (!isLoading && activeWorkspaceId && !scoped));
    const checking = isLoading || isValidating || !activeWorkspaceId;

    useEffect(() => {
        if (open) {
            setShouldRenderPanel(true);
            const raf = requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsPanelVisible(true));
            });
            return () => cancelAnimationFrame(raf);
        }
        setIsPanelVisible(false);
        const t = setTimeout(() => setShouldRenderPanel(false), 180);
        return () => clearTimeout(t);
    }, [open]);

    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, [open]);

    const count = items.length;

    return (
        <div className="relative" ref={panelRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-panel text-ink-mute transition-colors hover:border-white/20 hover:text-ink",
                    open && "border-white/20 text-ink"
                )}
                aria-expanded={open}
                aria-label={count ? `Notifications, ${count} issues` : "Notifications"}
            >
                <Bell className="h-4 w-4" strokeWidth={1.5} />
                {count > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-sm bg-red-500 px-1 font-mono text-[9px] font-semibold text-white">
                        {count > 9 ? "9+" : count}
                    </span>
                ) : null}
            </button>

            {shouldRenderPanel ? (
                <div className={cn(
                    "absolute right-0 top-[calc(100%+8px)] z-50 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-lg border border-line bg-panel",
                    "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                    isPanelVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1.5 pointer-events-none"
                )}>
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                        <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-mute">Inbox</p>
                            <span className="text-sm font-semibold text-ink">Notifications</span>
                        </div>
                        <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-mute hover:bg-white/[0.04] hover:text-ink" aria-label="Close">
                            <X className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                    </div>
                    <div className="max-h-[min(70vh,24rem)] overflow-y-auto p-1.5">
                        {unavailable || checking ? <div className="px-3 py-8 text-center text-xs text-ink-mute" role="status">{unavailable ? "Could not verify current issues. Open Operations to retry." : "Checking current issues…"}</div> : items.length === 0 ? (
                            <div className="flex flex-col items-center px-3 py-10 text-center">
                                <CheckCircle2 className="mb-2 h-5 w-5 text-accent" strokeWidth={1.5} />
                                <p className="text-sm font-medium text-ink">All clear</p>
                                <p className="mt-1 text-xs text-ink-mute">No next actions in the current scope.</p>
                            </div>
                        ) : (
                            <ul className="space-y-0.5">
                                {items.slice(0, 12).map((it) => (
                                    <li key={it.id}>
                                        {it.href ? (
                                            <Link
                                                href={it.href}
                                                onClick={() => setOpen(false)}
                                                className="flex gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                                            >
                                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" strokeWidth={1.5} />
                                                <span>
                                                    <span className="block text-sm font-medium text-ink">{it.title}</span>
                                                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-mute">{it.detail}</span>
                                                </span>
                                            </Link>
                                        ) : (
                                            <div className="flex gap-2 rounded-md px-3 py-2.5">
                                                <CheckCircle2 className="h-4 w-4 text-accent" strokeWidth={1.5} />
                                                <span className="text-sm text-ink">{it.title}</span>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="border-t border-line px-3 py-2.5">
                        <Link href={hrefFor("/operations")} onClick={() => setOpen(false)} className="block text-center font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-mute hover:text-ink">
                            {items.length > 12 ? `View all ${items.length} actions in Operations` : "Open Operations"}
                        </Link>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
