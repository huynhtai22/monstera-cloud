"use client";

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Sidebar } from './Sidebar';
import { GlobeLoader } from './GlobeLoader';
import { WorkspaceSessionSync } from './WorkspaceSessionSync';
import { DemoModeBanner } from './DemoModeBanner';
import { KeyboardShortcutsProvider } from './KeyboardShortcutsProvider';
import { NotificationCenter } from './NotificationCenter';
import { UpgradeNudge } from './UpgradeNudge';
import { Menu, Moon, Sun, ChevronRight } from 'lucide-react';
import { Toaster } from 'sonner';
import { rememberAppPath } from "@/lib/app-return-path";

const THEME_STORAGE_KEY = "monstera-theme";
const SIDEBAR_COLLAPSED_KEY = "monstera-sidebar-collapsed";

function mobileSectionTitle(pathname: string | null): string {
    if (!pathname) return "Home";
    if (pathname === "/console" || pathname.startsWith("/console/")) return "Dashboard";
    if (pathname.startsWith("/sources/") && pathname !== "/sources") return "Source";
    const first = pathname.split("/").filter(Boolean)[0] ?? "";
    const map: Record<string, string> = {
        sources: "Sources",
        destinations: "Destinations",
        reports: "Reports",
        settings: "Settings",
        console: "Dashboard",
        explorer: "Explorer",
        transformations: "Transformations",
        "internal-templates": "Templates",
        "google-ads": "Google Ads",
        "meta-ads": "Meta Ads",
        "tiktok-ads": "TikTok Ads",
        shopee: "Shopee",
    };
    if (map[first]) return map[first];
    return first ? first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, " ") : "Home";
}

export function AppLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { status } = useSession();
    const loading = status === 'loading';
    const mobileTitle = useMemo(() => mobileSectionTitle(pathname), [pathname]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    /** After first client read of localStorage — avoids stripping .dark before preference is restored (e.g. layout remount on route change). */
    const themeReady = useRef(false);

    // Restore theme + sidebar state on mount
    useLayoutEffect(() => {
        try {
            const s = localStorage.getItem(THEME_STORAGE_KEY);
            const dark =
                s === "dark" ? true : s === "light" ? false : window.matchMedia("(prefers-color-scheme: dark)").matches;
            setIsDarkMode(dark);
        } catch {
            setIsDarkMode(false);
        } finally {
            themeReady.current = true;
        }
        try {
            setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
        } catch {}
    }, []);

    // Sync .dark on <html> and persist; skip until initial read above has run so we don't flash light.
    useEffect(() => {
        if (!themeReady.current) return;
        const root = document.documentElement;
        root.classList.add("disable-transitions");
        requestAnimationFrame(() => {
            if (isDarkMode) {
                root.classList.add("dark");
            } else {
                root.classList.remove("dark");
            }
            try {
                localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "dark" : "light");
            } catch {
                /* ignore quota / private mode */
            }
            requestAnimationFrame(() => {
                root.classList.remove("disable-transitions");
            });
        });
    }, [isDarkMode]);

    const toggleDarkMode = () => setIsDarkMode((v) => !v);

    useEffect(() => {
        if (status !== "authenticated" || !pathname) return;
        rememberAppPath(pathname);
    }, [pathname, status]);

    return (
        <KeyboardShortcutsProvider>
        <WorkspaceSessionSync />
        {/* Mount only while auth is resolving — keeps a fixed z-[9999] layer out of the DOM after load (avoids blocking clicks). */}
        {loading ? <GlobeLoader visible /> : null}
        <div className="flex min-h-screen font-sans">
            {/* Mobile Header (only visible on small screens) */}
            <div className="fixed top-0 z-30 flex h-16 w-full items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950 lg:hidden">
                <div className="flex min-w-0 flex-1 items-center">
                    <button
                        type="button"
                        onClick={() => setIsSidebarOpen(true)}
                        className="-ml-2 p-2 text-gray-600 dark:text-gray-300"
                        aria-label="Open menu"
                    >
                        <Menu className="h-6 w-6" />
                    </button>
                    <div className="ml-1 flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Monstera
                        </span>
                        <span className="truncate text-base font-bold text-gray-900 dark:text-white">{mobileTitle}</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <NotificationCenter />
                    <button
                        type="button"
                        onClick={toggleDarkMode}
                        className="p-2 text-gray-500 dark:text-gray-400"
                        aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                    >
                        {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            <Sidebar
                isOpen={isSidebarOpen}
                setIsOpen={setIsSidebarOpen}
                isDarkMode={isDarkMode}
                toggleDarkMode={toggleDarkMode}
                collapsed={sidebarCollapsed}
                setCollapsed={setSidebarCollapsed}
            />

            <div className={`relative flex min-w-0 flex-1 flex-col bg-gray-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 ${sidebarCollapsed ? "lg:pl-[68px]" : "lg:pl-64"}`} style={{ transition: "padding-left 220ms cubic-bezier(0.25,0.1,0.25,1)" }}>
                <div className="h-16 shrink-0 lg:hidden" />
                <div className="z-20 hidden items-center justify-between gap-3 border-b border-gray-200/80 bg-gray-50 px-6 py-2.5 dark:border-slate-700/80 dark:bg-slate-950 lg:sticky lg:top-0 lg:flex">
                    <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
                        <span className="font-medium text-gray-400 dark:text-slate-500">Monstera</span>
                        <ChevronRight className="h-3.5 w-3.5 text-gray-300 dark:text-slate-600" aria-hidden />
                        <span className="font-medium text-gray-700 dark:text-slate-200">{mobileTitle}</span>
                    </nav>
                    <NotificationCenter />
                </div>
                <UpgradeNudge />
                <main className="relative z-10 flex-1 overflow-x-hidden">
                    <DemoModeBanner />
                    {children}
                </main>
            </div>

            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div
                    aria-hidden
                    className="fixed inset-0 z-40 bg-gray-900/60 backdrop-blur-sm transition-opacity lg:pointer-events-none lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <Toaster richColors closeButton position="top-center" />
        </div>
        </KeyboardShortcutsProvider>
    );
}
