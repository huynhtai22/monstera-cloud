"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
    LayoutGrid,
    DatabaseZap,
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
    Compass,
    Radio,
} from "lucide-react";
import useSWR from "swr";
import { useSession, signOut } from "next-auth/react";
import { useWorkspaceStore } from "@/store/workspace";
import { trackEvent } from "@/lib/analytics-events";

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

export function Sidebar({ isOpen = false, setIsOpen, isDarkMode, toggleDarkMode, collapsed = false, setCollapsed }: SidebarProps) {
    const { data: session } = useSession();
    const pathname = usePathname();
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);

    const toggleCollapsed = () => {
        const next = !collapsed;
        setCollapsed?.(next);
        try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch {}
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
            ],
        },
        {
            label: "Analytics",
            items: [
                { name: "Data explorer", href: "/explorer", icon: Compass },
                { name: "Sync activity", href: "/reports", icon: LineChart },
            ],
        },
        {
            label: "Management",
            items: [
                { name: "Clients", href: "/clients", icon: Users },
                { name: "Settings", href: "/settings", icon: Settings },
                { name: "Exports & API", href: "/exports", icon: Download },
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
        <div
            className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-canvas lg:translate-x-0 ${collapsed ? "w-[68px]" : "w-64"} ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
            style={{ transition: "width 220ms cubic-bezier(0.25,0.1,0.25,1), transform 300ms ease-in-out" }}
        >
            <div ref={workspaceRef} className={`relative z-20 border-b border-line ${collapsed ? "px-2 py-4" : "px-3 py-4"}`}>
                <button
                    type="button"
                    onClick={() => collapsed ? toggleCollapsed() : setIsWorkspaceOpen(!isWorkspaceOpen)}
                    aria-expanded={isWorkspaceOpen}
                    aria-controls="workspace-menu"
                    aria-haspopup="menu"
                    className={`group flex w-full items-center rounded-lg border border-line bg-panel governed-hover ${collapsed ? "justify-center p-2" : "justify-between px-3 py-2"}`}
                    title={collapsed ? (activeWorkspace?.name || "Workspace") : undefined}
                >
                    <div className={`flex items-center ${collapsed ? "justify-center" : ""}`}>
                        <div className={collapsed ? "flex items-center justify-center" : "mr-3 origin-left scale-95"}>
                            <Logo className="w-8 h-8" textClassName="hidden" />
                        </div>
                        {!collapsed && (
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">
                                        Workspace
                                    </span>
                                    {(activeWorkspace as { demoMockMode?: boolean } | null)?.demoMockMode ? (
                                        <span
                                            className="inline-flex items-center gap-1 rounded border border-line bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-wide text-ink-mute"
                                            title="Demo / mock data is enabled for this workspace"
                                        >
                                            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                                            Demo
                                        </span>
                                    ) : null}
                                </div>
                                <div className="truncate text-sm font-semibold text-ink">
                                    {activeWorkspace?.name || "No Workspace"}
                                </div>
                            </div>
                        )}
                    </div>
                    {!collapsed && (
                        <ChevronDown
                            className={`h-4 w-4 text-ink-mute transition-transform ${isWorkspaceOpen ? "rotate-180" : ""}`}
                            strokeWidth={1.5}
                        />
                    )}
                </button>

                {isWorkspaceOpen && Array.isArray(workspaces) && (
                    <div
                        id="workspace-menu"
                        className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel p-1.5"
                    >
                        <div className="mb-1 px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-mute">
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
                                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-medium text-ink governed-hover"
                            >
                                <div className="flex items-center">
                                    <div className="mr-2 flex h-6 w-6 items-center justify-center rounded border border-line bg-white/[0.04] font-mono text-[11px] font-medium text-ink">
                                        {ws.name.charAt(0).toUpperCase()}
                                    </div>
                                    {ws.name}
                                </div>
                                {activeWorkspaceId === ws.id ? <Check className="h-4 w-4 text-accent" strokeWidth={1.5} /> : null}
                            </button>
                        ))}

                        <div className="my-1 h-px bg-line" />
                        <p className="px-2 py-2 text-xs text-ink-mute">Pilot workspaces are created by a Monstera operator.</p>
                    </div>
                )}
            </div>

            <div className={`border-b border-line ${collapsed ? "px-2 py-2" : "px-3 py-2"}`}>
                <Link
                    href="/"
                    className={`flex items-center rounded-md py-2 text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink ${collapsed ? "justify-center px-0" : "gap-2 px-3"}`}
                    title={collapsed ? "Website" : undefined}
                >
                    <Globe className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                    {!collapsed && "Website"}
                </Link>
            </div>

            <nav className={`flex-1 overflow-y-auto py-4 ${collapsed ? "space-y-1 px-2" : "space-y-6 px-3"}`} aria-label="Main">
                {navGroups.map((group) => (
                    <div key={group.label}>
                        {!collapsed && (
                            <div className="mb-2 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-mute">
                                {group.label}
                            </div>
                        )}
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
                                        title={collapsed ? item.name : undefined}
                                        className={`group flex items-center rounded-md py-2 text-sm font-medium transition-colors ${collapsed ? "justify-center px-0" : "px-3"} ${isActive
                                            ? "bg-white/[0.06] text-ink"
                                            : "text-ink-mute hover:bg-white/[0.04] hover:text-ink"
                                            }`}
                                    >
                                        <item.icon
                                            strokeWidth={1.5}
                                            className={`h-[18px] w-[18px] shrink-0 ${collapsed ? "" : "mr-3"} ${isActive ? "text-ink" : "text-ink-mute group-hover:text-ink"}`}
                                        />
                                        {!collapsed && item.name}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {/* Collapse toggle — desktop only, integrated row */}
            <div className={`hidden lg:block border-t border-line ${collapsed ? "px-2 py-2" : "px-3 py-2"}`}>
                <button
                    type="button"
                    onClick={toggleCollapsed}
                    className={`group flex w-full items-center rounded-md py-2 text-xs font-medium text-ink-mute transition-colors hover:bg-white/[0.04] hover:text-ink ${collapsed ? "justify-center px-0" : "gap-2 px-3"}`}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed
                        ? <ChevronRight className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                        : <><ChevronLeft className="w-4 h-4 shrink-0" strokeWidth={1.5} /><span>Collapse</span></>
                    }
                </button>
            </div>

            <div className={`border-t border-line space-y-2 bg-canvas overflow-visible relative z-30 ${collapsed ? "p-2" : "p-3"}`} ref={profileRef}>
                <div className={`space-y-1 mb-4 hidden lg:block`}>
                    <a
                        href="/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Help and documentation"
                        onClick={() => trackEvent("help_opened", { location: "sidebar" })}
                        className={`flex items-center w-full py-2 rounded-md text-sm font-medium text-ink-mute hover:bg-white/[0.04] hover:text-ink transition-colors group ${collapsed ? "justify-center px-0" : "px-3"}`}
                        title={collapsed ? "Help & docs" : undefined}
                    >
                        <HelpCircle strokeWidth={1.5} className={`w-[18px] h-[18px] shrink-0 ${collapsed ? "" : "mr-3"}`} />
                        {!collapsed && <>Help &amp; docs</>}
                    </a>
                    <button
                        onClick={toggleDarkMode}
                        className={`flex items-center w-full py-2 rounded-md text-sm font-medium text-ink-mute hover:bg-white/[0.04] hover:text-ink transition-colors group ${collapsed ? "justify-center px-0" : "px-3"}`}
                        title={collapsed ? (isDarkMode ? "Light Mode" : "Dark Mode") : undefined}
                    >
                        {isDarkMode ? <Sun strokeWidth={1.5} className={`w-[18px] h-[18px] shrink-0 ${collapsed ? "" : "mr-3"}`} /> : <Moon strokeWidth={1.5} className={`w-[18px] h-[18px] shrink-0 ${collapsed ? "" : "mr-3"}`} />}
                        {!collapsed && (isDarkMode ? 'Light Mode' : 'Dark Mode')}
                    </button>
                </div>

                <div className="relative">
                    {isProfileOpen && (
                        <div
                            id="profile-menu"
                            className="absolute bottom-[calc(100%+8px)] left-0 w-full bg-panel border border-line rounded-lg p-1.5 z-50"
                        >
                            <Link href="/settings" onClick={() => { setIsOpen?.(false); setIsProfileOpen(false); }} className="flex items-center w-full px-3 py-2 text-sm font-medium text-ink hover:bg-white/[0.04] rounded-md transition-colors">
                                <Settings className="w-4 h-4 mr-2 text-ink-mute" strokeWidth={1.5} /> Settings
                            </Link>
                            <Link href="/settings" onClick={() => { setIsOpen?.(false); setIsProfileOpen(false); }} className="flex items-center w-full px-3 py-2 text-sm font-medium text-ink hover:bg-white/[0.04] rounded-md transition-colors">
                                <KeyRound className="w-4 h-4 mr-2 text-ink-mute" strokeWidth={1.5} /> API Keys
                            </Link>

                            <div className="lg:hidden">
                                <div className="h-px bg-line my-1"></div>
                                <button onClick={() => { toggleDarkMode?.(); setIsProfileOpen(false); }} className="flex items-center w-full px-3 py-2 text-sm font-medium text-ink hover:bg-white/[0.04] rounded-md transition-colors">
                                    {isDarkMode ? <Sun className="w-4 h-4 mr-2 text-ink-mute" strokeWidth={1.5} /> : <Moon className="w-4 h-4 mr-2 text-ink-mute" strokeWidth={1.5} />}
                                    {isDarkMode ? 'Light Mode' : 'Dark Mode'}
                                </button>
                            </div>

                            <div className="h-px bg-line my-1"></div>
                            <button
                                type="button"
                                onClick={() => signOut({ callbackUrl: "/login" })}
                                className="flex items-center w-full px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-950/30 rounded-md transition-colors"
                            >
                                <LogOut className="w-4 h-4 mr-2" strokeWidth={1.5} /> Log out
                            </button>
                        </div>
                    )}

                    <button
                        onClick={() => collapsed ? toggleCollapsed() : setIsProfileOpen(!isProfileOpen)}
                        aria-expanded={isProfileOpen}
                        aria-controls="profile-menu"
                        aria-haspopup="menu"
                        title={collapsed ? (session?.user?.name || "User") : undefined}
                        className={`flex items-center w-full bg-panel rounded-lg border border-line governed-hover ${collapsed ? "justify-center p-1.5" : "justify-between p-2"}`}
                    >
                        <div className={`flex items-center ${collapsed ? "justify-center" : "flex-1"}`}>
                            <div className={`${collapsed ? "w-8 h-8 text-xs" : "w-9 h-9 text-sm mr-3"} rounded-md bg-white/[0.04] text-ink font-semibold flex items-center justify-center border border-line`}>
                                {session?.user?.name ? session.user.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2) : 'U'}
                            </div>
                            {!collapsed && (
                                <div className="text-left w-24">
                                    <div className="text-sm font-semibold text-ink leading-tight truncate">
                                        {session?.user?.name || "User"}
                                    </div>
                                    <div className="text-[10px] text-ink-mute truncate">
                                        {session?.user?.email || "No email"}
                                    </div>
                                </div>
                            )}
                        </div>
                        {!collapsed && <ChevronDown className={`w-4 h-4 text-ink-mute shrink-0 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} strokeWidth={1.5} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
