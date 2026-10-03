"use client";

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ConsoleAppearanceContext } from "@/components/settings/ConsoleAppearanceContext";
import { usePathname } from 'next/navigation';
import { flushSync } from 'react-dom';
import { useSession } from 'next-auth/react';
import { ConsoleRouteTransition } from './console/ConsoleMotion';
import { ConsoleSupportControl } from './LiveChatWidget';
import { LogoMark } from "./Logo";
import { ConsoleSectionGuide } from "./console/ConsoleSectionGuide";
import { Sidebar } from './Sidebar';
import { useWorkspaceStartupActions } from './WorkspaceStartup';
import { WorkspaceSessionSync } from './WorkspaceSessionSync';
import { SessionHeartbeat } from './SessionHeartbeat';
import { DemoModeBanner } from './DemoModeBanner';
import { KeyboardShortcutsProvider } from './KeyboardShortcutsProvider';
import { CommandPaletteTrigger } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { UpgradeNudge } from './UpgradeNudge';
import { ClientContextBarGate } from './client-context/ClientContextBarGate';
import { PendingNavigationProvider } from './client-context/PendingNavigationProvider';
import { Menu, Moon, Sun, ChevronRight } from 'lucide-react';
import { Toaster } from 'sonner';
import { rememberAppPath } from "@/lib/app-return-path";

import consoleTheme from "./ConsoleTheme.module.css";

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
        explorer: "Data explorer",
        transformations: "Transformations",
        "internal-templates": "Templates",
        "google-ads": "Google Ads",
        "meta-ads": "Meta Ads",
        "tiktok-ads": "TikTok Ads",
        shopee: "Shopee",
        ops: "Operations",
        operations: "Operations",
        admin: "Admin",
    };
    if (map[first]) return map[first];
    return first ? first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, " ") : "Home";
}

export function AppLayout({ children, visualPreview = false, previewTitle = "Dashboard", previewPath, previewHref, previewDirectory, previewDirectories }: { children: React.ReactNode; visualPreview?: boolean; previewTitle?: string; previewPath?: string; previewHref?: (href: string) => string; previewDirectory?: readonly { label: string; href: string }[]; previewDirectories?: Readonly<Record<string, readonly { label: string; href: string }[]>> }) {
    const pathname = usePathname();
    const { status } = useSession();
    const loading = status === 'loading';
    const mobileTitle = useMemo(() => visualPreview ? previewTitle : mobileSectionTitle(pathname), [pathname, visualPreview, previewTitle]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(true);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const startup = useWorkspaceStartupActions();
    const configureStartup = startup?.configure;
    useEffect(() => {
        configureStartup?.(status !== 'loading', Boolean(pathname?.endsWith('/console')), status === 'authenticated');
    }, [configureStartup, status, pathname]);
    /** After first client read of localStorage — avoids stripping .dark before preference is restored (e.g. layout remount on route change). */
    const [themeReady, setThemeReady] = useState(false);

    // Restore theme + sidebar state on mount
    useLayoutEffect(() => {
        try {
            const s = localStorage.getItem(THEME_STORAGE_KEY);
            const dark = s === "light" ? false : true;
            setIsDarkMode(dark);
        } catch {
            setIsDarkMode(true);
        } finally {
            setThemeReady(true);
        }
        try {
            setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
        } catch {}
    }, []);

    // Apply shell, portal tokens and Tailwind theme in the same commit, before paint.
    // Restoring a saved preference is immediate; only an explicit toggle animates.
    useLayoutEffect(() => {
        if (!themeReady) return;
        const root = document.documentElement;
        root.dataset.consoleTheme = isDarkMode ? "dark" : "light";
        root.classList.toggle("dark", isDarkMode);
        try { localStorage.setItem(THEME_STORAGE_KEY, isDarkMode ? "dark" : "light"); }
        catch { /* private mode / storage unavailable */ }
    }, [isDarkMode, themeReady]);

    const themeTransition = useRef<ViewTransition | null>(null);
    const themeFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        themeTransition.current?.skipTransition();
        if (themeFallbackTimer.current) clearTimeout(themeFallbackTimer.current);
        const root = document.documentElement;
        delete root.dataset.consoleTheme;
        delete root.dataset.consoleThemeMotion;
    }, []);

    const toggleDarkMode = () => {
        const root = document.documentElement;
        themeTransition.current?.skipTransition();
        if (themeFallbackTimer.current) clearTimeout(themeFallbackTimer.current);
        const apply = () => flushSync(() => setIsDarkMode((value) => !value));
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            delete root.dataset.consoleThemeMotion;
            apply();
            return;
        }
        if (typeof document.startViewTransition === "function") {
            root.dataset.consoleThemeMotion = "crossfade";
            const transition = document.startViewTransition(apply);
            themeTransition.current = transition;
            // A newer toggle owns cleanup when switching quickly.
            void transition.finished.catch(() => {}).finally(() => {
                if (themeTransition.current === transition) {
                    themeTransition.current = null;
                    delete root.dataset.consoleThemeMotion;
                }
            });
        } else {
            root.dataset.consoleThemeMotion = "colors";
            apply();
            themeFallbackTimer.current = setTimeout(() => {
                delete root.dataset.consoleThemeMotion;
                themeFallbackTimer.current = null;
            }, 320);
        }
    };

    useEffect(() => {
        if (status !== "authenticated" || !pathname) return;
        rememberAppPath(pathname);
    }, [pathname, status]);

    if (pathname?.startsWith("/invite/")) return <>{children}</>;

    return (
        <ConsoleAppearanceContext.Provider value={{ isDarkMode, toggleDarkMode, hrefFor: visualPreview && previewHref ? previewHref : (href) => href }}>
        <KeyboardShortcutsProvider hrefTransform={visualPreview ? previewHref : undefined}>
        <PendingNavigationProvider>
        {!visualPreview && <WorkspaceSessionSync />}
        {!visualPreview && <SessionHeartbeat />}
        <div data-workspace-shell data-console-theme={isDarkMode ? "dark" : "light"} aria-busy={loading} inert={loading} className={`${consoleTheme.root} flex min-h-screen bg-canvas font-sans text-ink`}>
            {/* Mobile Header (only visible on small screens) */}
            <div inert={isSidebarOpen} className="fixed top-0 z-30 flex h-14 w-full items-center justify-between gap-2 border-b border-line bg-canvas px-3 lg:hidden">
                <div className="flex min-w-0 flex-1 items-center">
                    <button
                        type="button"
                        onClick={() => setIsSidebarOpen(true)}
                        className="-ml-2 p-2 text-ink-mute hover:text-ink"
                        aria-label="Open menu"
                        aria-expanded={isSidebarOpen}
                        aria-controls="application-sidebar"
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
                    <ConsoleSupportControl />
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
                previewPath={visualPreview ? previewPath : undefined}
                previewDirectory={visualPreview ? previewDirectory : undefined}
                previewDirectories={visualPreview ? previewDirectories : undefined}
            />

            <div
                inert={isSidebarOpen}
                className={`relative flex min-w-0 flex-1 flex-col bg-canvas text-ink transition-[padding-left] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${sidebarCollapsed ? "lg:pl-[68px]" : "lg:pl-64"}`}
            >
                <div className="h-14 shrink-0 lg:hidden" />
                {/* pointer-events-none: sticky bar spans full width above main (z-10); without this, flex “gaps” steal clicks from content scrolling underneath. */}
                <div className="pointer-events-none z-20 hidden items-center justify-between gap-3 border-b border-line bg-canvas/70 px-6 py-2.5 backdrop-blur-md lg:sticky lg:top-0 lg:flex">
                    <nav className="pointer-events-auto flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
                        <LogoMark className="h-5 w-5 shrink-0" />
                        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">Monstera</span>
                        <ChevronRight className="h-3.5 w-3.5 text-line" strokeWidth={1.5} aria-hidden />
                        <span className="font-medium text-ink">{mobileTitle}</span>
                    </nav>
                    <div className="pointer-events-auto flex items-center gap-2">
                        <CommandPaletteTrigger />
                        <ConsoleSupportControl />
                        <NotificationCenter />
                    </div>
                </div>
                {!visualPreview && <UpgradeNudge />}
                {!visualPreview && <ConsoleSectionGuide />}
                {!visualPreview && <ClientContextBarGate />}
                <main className="relative z-10 flex-1 overflow-x-hidden">
                    <DemoModeBanner />
                    <ConsoleRouteTransition pathname={pathname ?? ""}>{children}</ConsoleRouteTransition>
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
        </PendingNavigationProvider>
        </KeyboardShortcutsProvider>
        </ConsoleAppearanceContext.Provider>
    );
}
