"use client";

import Link from "next/link";
import { LogoMark } from "./Logo";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
    LayoutGrid,
    DatabaseZap,
    Database,
    LineChart,
    Settings,
    HelpCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Check,
    LogOut,
    KeyRound,
    Sun,
    Moon,
    Globe,
    Users,
    Download,
    Radio,
} from "lucide-react";
import useSWR from "swr";
import { useSession, signOut } from "next-auth/react";
import { useWorkspaceStore } from "@/store/workspace";
import { trackEvent } from "@/lib/analytics-events";
import { cn } from "@/lib/utils";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch data');
    }
    return data;
};

const SIDEBAR_COLLAPSED_KEY = "monstera-sidebar-collapsed";

interface SidebarProps {
    isOpen?: boolean;
    setIsOpen?: (v: boolean) => void;
    isDarkMode?: boolean;
    toggleDarkMode?: () => void;
    collapsed?: boolean;
    setCollapsed?: (v: boolean) => void;
}

function navIsActive(pathname: string, href: string): boolean {
    if (href === "/console") return pathname === "/console" || pathname.startsWith("/console/");
    if (href === "/settings") return pathname === "/settings" || pathname.startsWith("/settings/");
    if (href === "/admin/signal") return pathname === "/admin/signal" || pathname.startsWith("/admin/signal");
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
    isOpen = false,
    setIsOpen,
    isDarkMode,
    toggleDarkMode,
    collapsed = false,
    setCollapsed,
}: SidebarProps) {
    const { data: session } = useSession();
    const pathname = usePathname();
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    const toggleCollapsed = () => {
        const next = !collapsed;
        setCollapsed?.(next);
        try {
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
        } catch {
            /* ignore quota / storage access error */
        }
    };

    const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStore();
    const { data: workspaces } = useSWR("/api/workspaces", fetcher);

    useEffect(() => {
        if (!Array.isArray(workspaces) || workspaces.length === 0) return;
        const memberIds = new Set(workspaces.map((w: { id: string }) => w.id));
        if (!activeWorkspaceId || !memberIds.has(activeWorkspaceId)) {
            const w = workspaces[0];
            setActiveWorkspaceId(w.id);
            if (w.createdAt) {
                const ageMs = Date.now() - new Date(w.createdAt).getTime();
                if (ageMs < 15000) {
                    trackEvent("workspace_created", { workspaceId: w.id });
                }
            }
        }
    }, [workspaces, activeWorkspaceId, setActiveWorkspaceId]);

    const activeWorkspace = Array.isArray(workspaces)
        ? workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0]
        : null;

    const workspaceRef = useRef<HTMLDivElement>(null);
    const profileRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (workspaceRef.current && !workspaceRef.current.contains(event.target as Node)) {
                setIsWorkspaceOpen(false);
            }
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setIsProfileOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const isAdmin = Boolean((session?.user as any)?.isAdmin);

    type NavItem = { name: string; href: string; icon: typeof LayoutGrid };
    const navGroups: { label: string; items: NavItem[] }[] = [
        {
            label: "Overview",
            items: [
                { name: "Dashboard", href: "/console", icon: LayoutGrid },
            ],
        },
        {
            label: "Pipelines",
            items: [
                { name: "Sources", href: "/sources", icon: DatabaseZap },
                { name: "Sync activity", href: "/reports", icon: LineChart },
            ],
        },
        {
            label: "Data",
            items: [
                { name: "Warehouse", href: "/explorer", icon: Database },
                { name: "Exports & API", href: "/exports", icon: Download },
            ],
        },
        {
            label: "Management",
            items: [
                { name: "Clients", href: "/clients", icon: Users },
                { name: "Settings", href: "/settings", icon: Settings },
            ],
        },
        ...(isAdmin
            ? [
                  {
                      label: "Executive Operations",
                      items: [
                          { name: "Finance & Admin", href: "/admin", icon: LineChart },
                          { name: "Signal Desk", href: "/admin/signal", icon: Radio },
                      ],
                  },
              ]
            : []),
    ];

    return (
        <aside
            aria-label="Application sidebar"
            className={cn(
                "fixed inset-y-0 left-0 z-50 flex flex-col overflow-x-hidden border-r border-line bg-canvas transition-[width,transform] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] select-none motion-reduce:transition-none lg:translate-x-0",
                collapsed ? "w-[68px]" : "w-64",
                isOpen ? "translate-x-0" : "-translate-x-full"
            )}
        >
            {/* ── 1. Workspace Control ────────────────────────────────────────── */}
            <div ref={workspaceRef} className="relative z-20 border-b border-line px-3.5 py-3.5">
                <button
                    type="button"
                    onClick={() => (collapsed ? toggleCollapsed() : setIsWorkspaceOpen(!isWorkspaceOpen))}
                    aria-expanded={isWorkspaceOpen}
                    aria-controls="workspace-menu"
                    aria-haspopup="menu"
                    aria-label={collapsed ? `Active workspace: ${activeWorkspace?.name || "Workspace"}` : undefined}
                    className="group relative flex h-10 w-full items-center rounded-lg border border-line bg-panel transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas"
                >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                        <LogoMark className="h-6 w-6 shrink-0" />
                    </div>

                    <div
                        className={cn(
                            "flex min-w-0 flex-1 items-center justify-between pr-2.5 transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
                            collapsed ? "opacity-0 -translate-x-2 pointer-events-none w-0 pr-0" : "opacity-100 translate-x-0"
                        )}
                    >
                        <div className="min-w-0 text-left">
                            <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                                    Workspace
                                </span>
                                {(activeWorkspace as { demoMockMode?: boolean } | null)?.demoMockMode ? (
                                    <span
                                        className="inline-flex items-center gap-1 rounded border border-line bg-white/[0.04] px-1 py-0.2 font-mono text-[8px] font-medium uppercase tracking-wide text-ink-mute"
                                        title="Demo mode active"
                                    >
                                        Demo
                                    </span>
                                ) : null}
                            </div>
                            <div className="truncate text-xs font-semibold text-ink">
                                {activeWorkspace?.name || "No Workspace"}
                            </div>
                        </div>

                        <ChevronDown
                            className={cn(
                                "h-3.5 w-3.5 text-ink-mute shrink-0 transition-transform duration-150",
                                isWorkspaceOpen && "rotate-180"
                            )}
                            strokeWidth={1.5}
                        />
                    </div>

                    {/* Tooltip on collapsed hover/focus */}
                    {collapsed && (
                        <div
                            role="tooltip"
                            className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                            {activeWorkspace?.name || "Workspace"}
                        </div>
                    )}
                </button>

                {/* Workspace Switcher Dropdown */}
                {isWorkspaceOpen && Array.isArray(workspaces) && (
                    <div
                        id="workspace-menu"
                        className="absolute left-3 right-3 top-[calc(100%+4px)] z-50 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-elevated"
                    >
                        <div className="mb-1 px-2 py-1 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-ink-mute">
                            Your Workspaces
                        </div>

                        {workspaces.map((ws: any) => (
                            <button
                                key={ws.id}
                                type="button"
                                onClick={() => {
                                    setActiveWorkspaceId(ws.id);
                                    setIsWorkspaceOpen(false);
                                }}
                                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium text-ink transition-colors hover:bg-white/[0.04]"
                            >
                                <div className="flex items-center min-w-0">
                                    <div className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-white/[0.04] font-mono text-[10px] font-medium text-ink">
                                        {ws.name.charAt(0).toUpperCase()}
                                    </div>
                                    <span className="truncate">{ws.name}</span>
                                </div>
                                {activeWorkspaceId === ws.id ? (
                                    <Check className="h-3.5 w-3.5 text-accent shrink-0" strokeWidth={1.5} />
                                ) : null}
                            </button>
                        ))}

                        <div className="my-1 h-px bg-line" />
                        <p className="px-2 py-1.5 text-[10px] text-ink-mute">
                            Pilot workspaces are managed by Monstera.
                        </p>
                    </div>
                )}
            </div>

            {/* ── 2. Website Link ─────────────────────────────────────────────── */}
            <div className="border-b border-line px-3.5 py-2">
                <Link
                    href="/"
                    aria-label="Public website"
                    className="group relative flex h-8 w-full items-center rounded-md text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas overflow-hidden"
                >
                    <div className="flex h-8 w-10 shrink-0 items-center justify-center">
                        <Globe className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                    </div>
                    <span
                        className={cn(
                            "truncate text-xs transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                            collapsed ? "opacity-0 -translate-x-1.5 pointer-events-none" : "opacity-100 translate-x-0"
                        )}
                    >
                        Website
                    </span>

                    {collapsed && (
                        <div
                            role="tooltip"
                            className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                            Website
                        </div>
                    )}
                </Link>
            </div>

            {/* ── 3. Main Navigation ──────────────────────────────────────────── */}
            <nav className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4" aria-label="Main navigation">
                {navGroups.map((group) => (
                    <div key={group.label}>
                        <div
                            className={cn(
                                "px-2.5 mb-1 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-ink-mute transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                                collapsed ? "opacity-0 -translate-x-1 pointer-events-none h-0 mb-0 overflow-hidden" : "opacity-100 translate-x-0"
                            )}
                        >
                            {group.label}
                        </div>
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const isActive = navIsActive(pathname, item.href);
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => {
                                            setIsWorkspaceOpen(false);
                                            setIsOpen?.(false);
                                        }}
                                        aria-current={isActive ? "page" : undefined}
                                        aria-label={collapsed ? item.name : undefined}
                                        className={cn(
                                            "group relative flex h-9 w-full items-center rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas overflow-hidden",
                                            isActive
                                                ? "bg-white/[0.06] text-ink font-semibold border border-line/40 shadow-sm"
                                                : "text-ink-mute hover:bg-white/[0.04] hover:text-ink border border-transparent"
                                        )}
                                    >
                                        <div className="flex h-9 w-10 shrink-0 items-center justify-center">
                                            <item.icon
                                                strokeWidth={1.5}
                                                className={cn(
                                                    "h-4 w-4 shrink-0 transition-colors duration-150",
                                                    isActive ? "text-ink" : "text-ink-mute group-hover:text-ink"
                                                )}
                                                aria-hidden
                                            />
                                        </div>
                                        <span
                                            className={cn(
                                                "truncate text-xs transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                                                collapsed ? "opacity-0 -translate-x-1.5 pointer-events-none" : "opacity-100 translate-x-0"
                                            )}
                                        >
                                            {item.name}
                                        </span>

                                        {collapsed && (
                                            <div
                                                role="tooltip"
                                                className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                                            >
                                                {item.name}
                                            </div>
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {/* ── 4. Desktop Collapse/Expand Control ──────────────────────────── */}
            <div className="hidden lg:block border-t border-line px-3.5 py-2">
                <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className="group relative flex h-8 w-full items-center rounded-md text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas overflow-hidden"
                >
                    <div className="flex h-8 w-10 shrink-0 items-center justify-center">
                        {collapsed ? (
                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-150" strokeWidth={1.5} />
                        ) : (
                            <ChevronLeft className="h-4 w-4 shrink-0 transition-transform duration-150" strokeWidth={1.5} />
                        )}
                    </div>
                    <span
                        className={cn(
                            "truncate text-xs transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                            collapsed ? "opacity-0 -translate-x-1.5 pointer-events-none" : "opacity-100 translate-x-0"
                        )}
                    >
                        Collapse
                    </span>

                    {collapsed && (
                        <div
                            role="tooltip"
                            className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                        >
                            Expand sidebar
                        </div>
                    )}
                </button>
            </div>

            {/* ── 5. Bottom Utilities & Profile ───────────────────────────────── */}
            <div className="border-t border-line px-3.5 py-3 space-y-2 bg-canvas relative z-30" ref={profileRef}>
                <div className="space-y-0.5 hidden lg:block">
                    <a
                        href="/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Help and documentation"
                        onClick={() => trackEvent("help_opened", { location: "sidebar" })}
                        className="group relative flex h-8 w-full items-center rounded-md text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas overflow-hidden"
                    >
                        <div className="flex h-8 w-10 shrink-0 items-center justify-center">
                            <HelpCircle strokeWidth={1.5} className="h-4 w-4 shrink-0" aria-hidden />
                        </div>
                        <span
                            className={cn(
                                "truncate text-xs transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                                collapsed ? "opacity-0 -translate-x-1.5 pointer-events-none" : "opacity-100 translate-x-0"
                            )}
                        >
                            Help &amp; docs
                        </span>

                        {collapsed && (
                            <div
                                role="tooltip"
                                className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                            >
                                Help &amp; docs
                            </div>
                        )}
                    </a>

                    <button
                        type="button"
                        onClick={toggleDarkMode}
                        aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
                        className="group relative flex h-8 w-full items-center rounded-md text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas overflow-hidden"
                    >
                        <div className="flex h-8 w-10 shrink-0 items-center justify-center">
                            {isDarkMode ? (
                                <Sun strokeWidth={1.5} className="h-4 w-4 shrink-0" aria-hidden />
                            ) : (
                                <Moon strokeWidth={1.5} className="h-4 w-4 shrink-0" aria-hidden />
                            )}
                        </div>
                        <span
                            className={cn(
                                "truncate text-xs transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                                collapsed ? "opacity-0 -translate-x-1.5 pointer-events-none" : "opacity-100 translate-x-0"
                            )}
                        >
                            {isDarkMode ? "Light Mode" : "Dark Mode"}
                        </span>

                        {collapsed && (
                            <div
                                role="tooltip"
                                className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                            >
                                {isDarkMode ? "Light Mode" : "Dark Mode"}
                            </div>
                        )}
                    </button>
                </div>

                {/* Profile Button & Menu */}
                <div className="relative pt-1">
                    {isProfileOpen && (
                        <div
                            id="profile-menu"
                            className="absolute bottom-[calc(100%+8px)] left-0 w-56 rounded-lg border border-line bg-panel p-1.5 shadow-elevated z-50"
                        >
                            <Link
                                href="/settings"
                                onClick={() => {
                                    setIsOpen?.(false);
                                    setIsProfileOpen(false);
                                }}
                                className="flex items-center w-full px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04] rounded-md transition-colors"
                            >
                                <Settings className="w-3.5 h-3.5 mr-2 text-ink-mute" strokeWidth={1.5} /> Settings
                            </Link>
                            <Link
                                href="/settings"
                                onClick={() => {
                                    setIsOpen?.(false);
                                    setIsProfileOpen(false);
                                }}
                                className="flex items-center w-full px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04] rounded-md transition-colors"
                            >
                                <KeyRound className="w-3.5 h-3.5 mr-2 text-ink-mute" strokeWidth={1.5} /> API Keys
                            </Link>

                            <div className="lg:hidden">
                                <div className="h-px bg-line my-1" />
                                <button
                                    type="button"
                                    onClick={() => {
                                        toggleDarkMode?.();
                                        setIsProfileOpen(false);
                                    }}
                                    className="flex items-center w-full px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04] rounded-md transition-colors"
                                >
                                    {isDarkMode ? <Sun className="w-3.5 h-3.5 mr-2 text-ink-mute" strokeWidth={1.5} /> : <Moon className="w-3.5 h-3.5 mr-2 text-ink-mute" strokeWidth={1.5} />}
                                    {isDarkMode ? "Light Mode" : "Dark Mode"}
                                </button>
                            </div>

                            <div className="h-px bg-line my-1" />
                            <button
                                type="button"
                                onClick={() => signOut({ callbackUrl: "/login" })}
                                className="flex items-center w-full px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/30 rounded-md transition-colors"
                            >
                                <LogOut className="w-3.5 h-3.5 mr-2" strokeWidth={1.5} /> Log out
                            </button>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => (collapsed ? toggleCollapsed() : setIsProfileOpen(!isProfileOpen))}
                        aria-expanded={isProfileOpen}
                        aria-controls="profile-menu"
                        aria-haspopup="menu"
                        aria-label={collapsed ? `User profile: ${session?.user?.name || "User"}` : undefined}
                        className="group relative flex h-10 w-full items-center rounded-lg border border-line bg-panel transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas"
                    >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-white/[0.04] text-[11px] font-semibold text-ink">
                                {session?.user?.name
                                    ? session.user.name
                                          .split(" ")
                                          .map((n: string) => n[0])
                                          .join("")
                                          .substring(0, 2)
                                    : "U"}
                            </div>
                        </div>

                        <div
                            className={cn(
                                "flex flex-1 items-center justify-between min-w-0 pr-2.5 transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
                                collapsed ? "opacity-0 -translate-x-2 pointer-events-none w-0 pr-0" : "opacity-100 translate-x-0"
                            )}
                        >
                            <div className="min-w-0 text-left">
                                <div className="truncate text-xs font-semibold text-ink leading-tight">
                                    {session?.user?.name || "User"}
                                </div>
                                <div className="truncate text-[10px] text-ink-mute">
                                    {session?.user?.email || "No email"}
                                </div>
                            </div>

                            <ChevronDown
                                className={cn(
                                    "h-3.5 w-3.5 text-ink-mute shrink-0 transition-transform duration-150",
                                    isProfileOpen && "rotate-180"
                                )}
                                strokeWidth={1.5}
                            />
                        </div>

                        {collapsed && (
                            <div
                                role="tooltip"
                                className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-50 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-ink shadow-elevated whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
                            >
                                {session?.user?.name || "User"}
                            </div>
                        )}
                    </button>
                </div>
            </div>
        </aside>
    );
}
