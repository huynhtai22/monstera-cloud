"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

function isEditableTarget(t: EventTarget | null): boolean {
    if (!t || !(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (t.isContentEditable) return true;
    return false;
}

/**
 * P2: g s → Sources, g d → Dashboard, g r → Reports, ? → shortcut sheet
 */
export function KeyboardShortcutsProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [helpOpen, setHelpOpen] = useState(false);
    const gPending = useRef(false);
    const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearG = useCallback(() => {
        gPending.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);
        gTimer.current = null;
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (isEditableTarget(e.target)) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            if (e.key === "?" || (e.shiftKey && e.key === "/")) {
                e.preventDefault();
                setHelpOpen(true);
                clearG();
                return;
            }

            if (e.key === "g" || e.key === "G") {
                gPending.current = true;
                if (gTimer.current) clearTimeout(gTimer.current);
                gTimer.current = setTimeout(() => {
                    gPending.current = false;
                    gTimer.current = null;
                }, 700);
                return;
            }

            if (gPending.current) {
                const k = e.key.toLowerCase();
                if (k === "s") {
                    e.preventDefault();
                    router.push("/sources");
                    clearG();
                    return;
                }
                if (k === "d") {
                    e.preventDefault();
                    router.push("/");
                    clearG();
                    return;
                }
                if (k === "r") {
                    e.preventDefault();
                    router.push("/reports");
                    clearG();
                    return;
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            if (gTimer.current) clearTimeout(gTimer.current);
        };
    }, [router, clearG]);

    return (
        <>
            {children}
            {helpOpen ? (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="kbd-shortcuts-title">
                    <button type="button" className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-label="Close" onClick={() => setHelpOpen(false)} />
                    <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-4 flex items-start justify-between gap-2">
                            <h2 id="kbd-shortcuts-title" className="text-lg font-bold text-gray-900 dark:text-white">
                                Keyboard shortcuts
                            </h2>
                            <button type="button" onClick={() => setHelpOpen(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800" aria-label="Close">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                            <li className="flex justify-between gap-4">
                                <span>Go to Sources</span>
                                <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">g</kbd>{" "}
                                then <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">s</kbd>
                            </li>
                            <li className="flex justify-between gap-4">
                                <span>Go to Dashboard</span>
                                <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">g</kbd>{" "}
                                then <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">d</kbd>
                            </li>
                            <li className="flex justify-between gap-4">
                                <span>Go to Reports</span>
                                <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">g</kbd>{" "}
                                then <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">r</kbd>
                            </li>
                            <li className="flex justify-between gap-4">
                                <span>Open this help</span>
                                <kbd className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">?</kbd>
                            </li>
                        </ul>
                    </div>
                </div>
            ) : null}
        </>
    );
}
