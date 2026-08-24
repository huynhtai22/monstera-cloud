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
    if (pathname === "/admin/signal" || pathname.startsWith("/admin/signal")) return "Signal Desk";
    const first = pathname.split("/").filter(Boolean)[0] ?? "";
    const map: Record<string, string> = {
        sources: "Sources",
        destinations: "Destinations",
        reports: "Reports",
        settings: "Settings",
        console: "Dashboard",
        explorer: "Warehouse",
        transformations: "Transformations",
        "internal-templates": "Templates",
        "google-ads": "Google Ads",
        "meta-ads": "Meta Ads",
        "tiktok-ads": "TikTok Ads",
        shopee: "Shopee",
        ops: "Operations",
        admin: "Admin",
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
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    /** After first client read of localStorage — avoids stripping .dark before preference is restored (e.g. layout remount on route change). */
    const themeReady = useRef(false);

    // Restore theme + sidebar state on mount
    useLayoutEffect(() => {
        try {
            const s = localStorage.getItem(THEME_STORAGE_KEY);
            const dark = s === "light" ? false : true;
            setIsDarkMode(dark);
        } catch {
            setIsDarkMode(true);
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

    if (pathname?.startsWith("/invite/")) return <>{children}</>;

    return (
        <KeyboardShortcutsProvider>
        <WorkspaceSessionSync />
        {/* Mount only while auth is resolving — keeps a fixed z-[9999] layer out of the DOM after load (avoids blocking clicks). */}
        {loading ? <GlobeLoader visible /> : null}
        <div className="flex min-h-screen bg-canvas font-sans text-ink">
            {/* Mobile Header (only visible on small screens) */}
            <div className="fixed top-0 z-30 flex h-14 w-full items-center justify-between gap-2 border-b border-line bg-canvas px-3 lg:hidden">
                <div className="flex min-w-0 flex-1 items-center">
                    <button
                        type="button"
                        onClick={() => setIsSidebarOpen(true)}
                        className="-ml-2 p-2 text-ink-mute hover:text-ink"
                        aria-label="Open menu"
                    >
                        <Menu className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                    <div className="ml-1 flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">
                            Monstera
                        </span>
                        <span className="truncate text-sm font-semibold text-ink">{mobileTitle}</span>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <NotificationCenter />
                    <button
                        type="button"
                        onClick={toggleDarkMode}
                        className="p-2 text-ink-mute hover:text-ink"
                        aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                    >
                        {isDarkMode ? <Sun className="h-4 w-4" strokeWidth={1.5} /> : <Moon className="h-4 w-4" strokeWidth={1.5} />}
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

            <div
                className={`relative flex min-w-0 flex-1 flex-col bg-canvas text-ink transition-[padding-left] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${sidebarCollapsed ? "lg:pl-[68px]" : "lg:pl-64"}`}
            >
                <div className="h-14 shrink-0 lg:hidden" />
                {/* pointer-events-none: sticky bar spans full width above main (z-10); without this, flex “gaps” steal clicks from content scrolling underneath. */}
                <div className="pointer-events-none z-20 hidden items-center justify-between gap-3 border-b border-line bg-canvas/90 px-6 py-2.5 backdrop-blur-md lg:sticky lg:top-0 lg:flex">
                    <nav className="pointer-events-auto flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
                        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">Monstera</span>
                        <ChevronRight className="h-3.5 w-3.5 text-line" strokeWidth={1.5} aria-hidden />
                        <span className="font-medium text-ink">{mobileTitle}</span>
                    </nav>
                    <div className="pointer-events-auto">
                        <NotificationCenter />
                    </div>
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
                    className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity motion-reduce:transition-none lg:pointer-events-none lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <Toaster
                theme={isDarkMode ? "dark" : "light"}
                closeButton
                position="top-center"
                toastOptions={{
                    className: "mc-dialog !shadow-none",
                }}
            />
        </div>
        </KeyboardShortcutsProvider>
    );
}
