"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import {
    LayoutGrid,
    DatabaseZap,
    Send,
    LineChart,
    Settings,
    HelpCircle,
    ChevronDown,
    Check,
    LogOut,
    KeyRound,
    Sun,
    Moon,
    Globe,
    Users,
} from "lucide-react";
import useSWR, { mutate } from "swr";
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

interface SidebarProps {
    isOpen?: boolean;
    setIsOpen?: (v: boolean) => void;
    isDarkMode?: boolean;
    toggleDarkMode?: () => void;
}

function navIsActive(pathname: string, href: string): boolean {
    if (href === "/console") return pathname === "/console" || pathname.startsWith("/console/");
    if (href === "/settings") return pathname === "/settings" || pathname.startsWith("/settings/");
    return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ isOpen = false, setIsOpen, isDarkMode, toggleDarkMode }: SidebarProps) {
    const { data: session } = useSession();
    const pathname = usePathname();
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);

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

    type NavItem = { name: string; href: string; icon: typeof LayoutGrid };
    const navGroups: { label: string; items: NavItem[] }[] = [
        {
            label: "Data",
            items: [
                { name: "Dashboard", href: "/console", icon: LayoutGrid },
                { name: "Clients", href: "/clients", icon: Users },
                { name: "Sources", href: "/sources", icon: DatabaseZap },
                { name: "Destinations", href: "/destinations", icon: Send },
            ],
        },
        {
            label: "Insights",
            items: [{ name: "Reports", href: "/reports", icon: LineChart }],
        },
        {
            label: "Workspace",
            items: [{ name: "Settings", href: "/settings", icon: Settings }],
        },
    ];

    return (
        <div
            className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-slate-50 shadow-[4px_0_24px_rgba(0,0,0,0.02)] transition-transform duration-300 ease-in-out dark:border-slate-700/90 dark:bg-slate-950 dark:shadow-[4px_0_32px_rgba(0,0,0,0.45)] lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
            <div ref={workspaceRef} className="relative z-20 border-b border-gray-200/60 px-4 py-5 dark:border-slate-800">
                <button
                    type="button"
                    onClick={() => setIsWorkspaceOpen(!isWorkspaceOpen)}
                    aria-expanded={isWorkspaceOpen}
                    aria-controls="workspace-menu"
                    aria-haspopup="menu"
                    className="group flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm transition-all hover:border-cyan-500/30 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-cyan-500/50"
                >
                    <div className="flex items-center">
                        <div className="mr-3 origin-left scale-95">
                            <Logo className="w-8 h-8" textClassName="hidden" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Workspace
                                </span>
                                {(activeWorkspace as { demoMockMode?: boolean } | null)?.demoMockMode ? (
                                    <span
                                        className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-950/80 dark:text-violet-200"
                                        title="Demo / mock data is enabled for this workspace"
                                    >
                                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />
                                        Demo
                                    </span>
                                ) : null}
                            </div>
                            <div className="truncate text-sm font-bold text-gray-900 dark:text-white">
                                {activeWorkspace?.name || "No Workspace"}
                            </div>
                        </div>
                    </div>
                    <ChevronDown
                        className={`h-4 w-4 text-gray-400 transition-transform group-hover:text-cyan-600 dark:text-gray-500 dark:group-hover:text-cyan-600 ${isWorkspaceOpen ? "rotate-180" : ""}`}
                    />
                </button>

                {isWorkspaceOpen && Array.isArray(workspaces) && (
                    <div
                        id="workspace-menu"
                        className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200 dark:border-slate-700 dark:bg-slate-800"
                    >
                        <div className="mb-1 px-2 py-1 text-xs font-bold uppercase text-gray-400 dark:text-gray-500">
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
                                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:text-white dark:hover:bg-slate-700"
                            >
                                <div className="flex items-center">
                                    <div className="mr-2 flex h-6 w-6 items-center justify-center rounded bg-cyan-100 text-xs font-bold text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-400">
                                        {ws.name.charAt(0).toUpperCase()}
                                    </div>
                                    {ws.name}
                                </div>
                                {activeWorkspaceId === ws.id ? <Check className="h-4 w-4 text-cyan-600" /> : null}
                            </button>
                        ))}

                        <div className="my-1 h-px bg-gray-100 dark:bg-slate-700" />
                        <button
                            type="button"
                            onClick={async () => {
                                const name = typeof window !== "undefined" ? window.prompt("Workspace name:") : null;
                                if (!name || !name.trim()) return;
                                try {
                                    const res = await fetch("/api/workspaces", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ name: name.trim() }),
                                    });
                                    if (res.ok) {
                                        mutate("/api/workspaces");
                                    }
                                } catch {
                                    // silently fail
                                }
                            }}
                            className="flex w-full items-center rounded-lg px-2 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-700"
                        >
                            <div className="mr-2 flex h-6 w-6 items-center justify-center rounded border border-dashed border-gray-300 dark:border-gray-500">
                                <span className="text-lg leading-none text-gray-400">+</span>
                            </div>
                            Create New Workspace
                        </button>
                    </div>
                )}
            </div>

            <div className="border-b border-gray-200/60 px-4 py-2 dark:border-slate-800">
                <Link
                    href="/"
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-cyan-700 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-cyan-300"
                >
                    <Globe className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                    Website
                </Link>
            </div>

            <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-4" aria-label="Main">
                {navGroups.map((group) => (
                    <div key={group.label}>
                        <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">
                            {group.label}
                        </div>
                        <div className="space-y-1">
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
                                        className={`group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-all ${isActive
                                            ? "bg-cyan-50 text-cyan-800 dark:bg-cyan-950/55 dark:text-cyan-100 dark:ring-1 dark:ring-cyan-700/50"
                                            : "text-gray-600 hover:bg-gray-50/80 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                                            }`}
                                    >
                                        <item.icon
                                            className={`mr-3 h-4 w-4 transition-colors ${isActive ? "text-cyan-600 dark:text-cyan-300" : "text-gray-400 group-hover:text-gray-500 dark:text-slate-500 dark:group-hover:text-slate-300"}`}
                                        />
                                        {item.name}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            <div className="p-4 border-t border-gray-200/60 dark:border-slate-800 space-y-2 bg-white/50 dark:bg-slate-900 overflow-visible relative z-30" ref={profileRef}>
                <div className="space-y-1 mb-4 hidden lg:block">
                    <a
                        href="/docs"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Help and documentation"
                        onClick={() => trackEvent("help_opened", { location: "sidebar" })}
                        className="flex items-center w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white transition-colors group"
                    >
                        <HelpCircle className="w-5 h-5 mr-3 text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400" />
                        Help &amp; docs
                    </a>
                    <button onClick={toggleDarkMode} className="flex items-center w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-white transition-colors group">
                        {isDarkMode ? <Sun className="w-5 h-5 mr-3 text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400" /> : <Moon className="w-5 h-5 mr-3 text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400" />}
                        {isDarkMode ? 'Light Mode' : 'Dark Mode'}
                    </button>
                </div>

                <div className="relative">
                    {isProfileOpen && (
                        <div
                            id="profile-menu"
                            className="absolute bottom-[calc(100%+8px)] left-0 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg p-2 animate-in fade-in slide-in-from-bottom-2 duration-200 z-50"
                        >
                            <Link href="/settings" onClick={() => { setIsOpen && setIsOpen(false); setIsProfileOpen(false); }} className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                                <Settings className="w-4 h-4 mr-2 text-gray-400 dark:text-gray-500" /> Settings
                            </Link>
                            <Link href="/settings" onClick={() => { setIsOpen && setIsOpen(false); setIsProfileOpen(false); }} className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                                <KeyRound className="w-4 h-4 mr-2 text-gray-400 dark:text-gray-500" /> API Keys
                            </Link>

                            <div className="lg:hidden">
                                <div className="h-px bg-gray-100 dark:bg-slate-700 my-1"></div>
                                <button onClick={() => { toggleDarkMode && toggleDarkMode(); setIsProfileOpen(false); }} className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg transition-colors">
                                    {isDarkMode ? <Sun className="w-4 h-4 mr-2 text-gray-400 dark:text-gray-500" /> : <Moon className="w-4 h-4 mr-2 text-gray-400 dark:text-gray-500" />}
                                    {isDarkMode ? 'Light Mode' : 'Dark Mode'}
                                </button>
                            </div>

                            <div className="h-px bg-gray-100 dark:bg-slate-700 my-1"></div>
                            <button
                                type="button"
                                onClick={() => signOut({ callbackUrl: "/login" })}
                                className="flex items-center w-full px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                                <LogOut className="w-4 h-4 mr-2" /> Log out
                            </button>
                        </div>
                    )}

                    <button
                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                        aria-expanded={isProfileOpen}
                        aria-controls="profile-menu"
                        aria-haspopup="menu"
                        className="flex justify-between items-center w-full p-2 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                    >
                        <div className="flex items-center flex-1">
                            <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 font-bold flex items-center justify-center mr-3 shadow-inner text-sm border border-indigo-200 dark:border-indigo-800">
                                {session?.user?.name ? session.user.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2) : 'U'}
                            </div>
                            <div className="text-left w-24">
                                <div className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
                                    {session?.user?.name || "User"}
                                </div>
                                <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                                    {session?.user?.email || "No email"}
                                </div>
                            </div>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
                    </button>
                </div>
            </div>
        </div>
    );
}
