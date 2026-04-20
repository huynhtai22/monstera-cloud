"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from "next/link";
import { Settings2, Building2, Users, CreditCard, KeyRound, Save, Plus, AlertCircle, CheckCircle2, Copy, Briefcase, Trash2, Activity, Database, ShieldAlert, MessageCircle, Pencil, Search, Sparkles } from "lucide-react";
import { MOCK_TEAM } from "@/lib/mock-console-data";
import { useWorkspaceStore } from "@/store/workspace";
import useSWR, { useSWRConfig } from "swr";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to fetch');
    return data;
};

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<'workspace' | 'clients' | 'team' | 'billing' | 'api'>('workspace');
    const { activeWorkspaceId } = useWorkspaceStore();
    const { mutate: globalMutate } = useSWRConfig();
    const { data: session } = useSession();
    const { data: workspaces } = useSWR("/api/workspaces", fetcher);
    const activeWorkspace = Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0] : null;
    const userPlan = (session?.user as any)?.plan || 'free';

    const [telegramChatDraft, setTelegramChatDraft] = useState("");
    const [telegramSaving, setTelegramSaving] = useState(false);
    const [telegramTesting, setTelegramTesting] = useState(false);
    const [unassignedSearch, setUnassignedSearch] = useState("");
    const [editingClientId, setEditingClientId] = useState<string | null>(null);
    const [editClientNameValue, setEditClientNameValue] = useState("");

    const [demoMaster, setDemoMaster] = useState(false);
    const [demoMeta, setDemoMeta] = useState(false);
    const [demoShopee, setDemoShopee] = useState(false);
    const [demoGoogleAds, setDemoGoogleAds] = useState(false);
    const [demoSaving, setDemoSaving] = useState(false);
    
    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Client Management State
    const [clients, setClients] = useState<any[]>([]);
    const [unassignedConns, setUnassignedConns] = useState<any[]>([]);
    const [isAddingClient, setIsAddingClient] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    useEffect(() => {
        if (typeof window === "undefined") return;
        const tab = new URLSearchParams(window.location.search).get("tab");
        if (
            tab === "workspace" ||
            tab === "clients" ||
            tab === "team" ||
            tab === "billing" ||
            tab === "api"
        ) {
            setActiveTab(tab);
        }
        const demo = new URLSearchParams(window.location.search).get("demo");
        if (demo === "1" || demo === "true") {
            setActiveTab("workspace");
            setTimeout(() => {
                window.history.replaceState(null, "", "/settings?tab=workspace#product-demo");
                document.getElementById("product-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 150);
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || activeTab !== "workspace") return;
        if (window.location.hash !== "#product-demo") return;
        requestAnimationFrame(() => {
            document.getElementById("product-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }, [activeTab]);

    useEffect(() => {
        if (!activeWorkspace) return;
        setTelegramChatDraft(
            (activeWorkspace as { telegramChatId?: string | null }).telegramChatId ?? ""
        );
        const w = activeWorkspace as {
            demoMockMode?: boolean;
            demoMockMeta?: boolean;
            demoMockShopee?: boolean;
            demoMockGoogleAds?: boolean;
        };
        setDemoMaster(!!w.demoMockMode);
        setDemoMeta(!!w.demoMockMeta);
        setDemoShopee(!!w.demoMockShopee);
        setDemoGoogleAds(!!w.demoMockGoogleAds);
    }, [
        activeWorkspace?.id,
        (activeWorkspace as { telegramChatId?: string | null })?.telegramChatId,
        (activeWorkspace as { demoMockMode?: boolean })?.demoMockMode,
        (activeWorkspace as { demoMockMeta?: boolean })?.demoMockMeta,
        (activeWorkspace as { demoMockShopee?: boolean })?.demoMockShopee,
        (activeWorkspace as { demoMockGoogleAds?: boolean })?.demoMockGoogleAds,
    ]);

    useEffect(() => {
        if (activeTab === 'api' && activeWorkspaceId) {
            fetchApiKeys();
        }
        if (activeTab === 'clients' && activeWorkspaceId) {
            fetchClients();
            fetchUnassigned();
        }
    }, [activeTab, activeWorkspaceId]);

    const fetchUnassigned = async () => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections?unassigned=true`);
            if (res.ok) {
                const data = await res.json();
                setUnassignedConns(data);
            }
        } catch (e) {
            console.error("Failed to fetch unassigned connections");
        }
    };

    const handleAssignClient = async (connId: string, clientId: string) => {
        try {
            const res = await fetch(`/api/connections/${connId}/assign-client`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, workspaceId: activeWorkspaceId })
            });
            if (res.ok) {
                fetchUnassigned();
                fetchClients();
            }
        } catch (e) {
            console.error("Failed to assign client");
        }
    };

    const fetchClients = async () => {
        try {
            const res = await fetch(`/api/clients?workspaceId=${activeWorkspaceId}`);
            if (res.ok) {
                const data = await res.json();
                setClients(data);
            }
        } catch (error) {
            console.error("Failed to fetch clients");
        }
    };

    const handleAddClient = async () => {
        if (!activeWorkspaceId || !newClientName.trim()) return;
        setIsAddingClient(true);
        try {
            const res = await fetch('/api/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    workspaceId: activeWorkspaceId, 
                    name: newClientName 
                })
            });
            if (res.ok) {
                setNewClientName('');
                toast.success("Client added.");
                fetchClients();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(typeof err.error === "string" ? err.error : "Could not add client.");
            }
        } catch (error) {
            toast.error("Could not add client.");
        }
        setIsAddingClient(false);
    };

    const handleDeleteClient = async (id: string, isDemo?: boolean) => {
        if (isDemo) {
            toast.error("Demo clients can’t be removed — turn off demo mode in Workspace settings.");
            return;
        }
        if (!activeWorkspaceId || !confirm("Are you sure you want to remove this client? This won't delete their data, but they will no longer be grouped.")) return;
        try {
            const res = await fetch(`/api/clients?id=${id}&workspaceId=${activeWorkspaceId}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                toast.success("Client removed.");
                fetchClients();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(typeof err.error === "string" ? err.error : "Could not remove client.");
            }
        } catch (error) {
            toast.error("Could not remove client.");
        }
    };

    const handleRenameClient = async (clientId: string) => {
        if (!activeWorkspaceId || !editClientNameValue.trim()) return;
        try {
            const res = await fetch("/api/clients", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: clientId,
                    workspaceId: activeWorkspaceId,
                    name: editClientNameValue.trim(),
                }),
            });
            if (res.ok) {
                toast.success("Client updated.");
                setEditingClientId(null);
                fetchClients();
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(typeof err.error === "string" ? err.error : "Update failed.");
            }
        } catch {
            toast.error("Update failed.");
        }
    };

    const filteredUnassigned = useMemo(() => {
        const q = unassignedSearch.trim().toLowerCase();
        if (!q) return unassignedConns;
        return unassignedConns.filter(
            (c: { name?: string; provider?: string }) =>
                (c.name && c.name.toLowerCase().includes(q)) ||
                (c.provider && c.provider.toLowerCase().includes(q))
        );
    }, [unassignedConns, unassignedSearch]);

    const saveTelegramChat = async () => {
        if (!activeWorkspaceId) return;
        setTelegramSaving(true);
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    telegramChatId: telegramChatDraft.trim() || null,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
            toast.success("Notification settings saved.");
            await globalMutate("/api/workspaces");
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Save failed.");
        } finally {
            setTelegramSaving(false);
        }
    };

    const saveDemoSettings = async (opts?: {
        master?: boolean;
        meta?: boolean;
        shopee?: boolean;
        googleAds?: boolean;
    }) => {
        if (!activeWorkspaceId) return;
        const master = opts?.master ?? demoMaster;
        const m = opts?.meta ?? demoMeta;
        const s = opts?.shopee ?? demoShopee;
        const g = opts?.googleAds ?? demoGoogleAds;
        setDemoSaving(true);
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    demoMockMode: master,
                    demoMockMeta: master ? m : false,
                    demoMockShopee: master ? s : false,
                    demoMockGoogleAds: master ? g : false,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Save failed");
            setDemoMaster(master);
            if (!master) {
                setDemoMeta(false);
                setDemoShopee(false);
                setDemoGoogleAds(false);
            } else {
                setDemoMeta(m);
                setDemoShopee(s);
                setDemoGoogleAds(g);
            }
            toast.success("Demo / mock settings saved.");
            await globalMutate("/api/workspaces");
            if (activeWorkspaceId) {
                await globalMutate(`/api/workspaces/${activeWorkspaceId}/health-stats`);
                await globalMutate(
                    `/api/attribution/snapshots?workspaceId=${activeWorkspaceId}&days=14`
                );
            }
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Save failed.");
        } finally {
            setDemoSaving(false);
        }
    };

    const testTelegramAlert = async () => {
        if (!activeWorkspaceId) return;
        setTelegramTesting(true);
        try {
            const res = await fetch(
                `/api/workspaces/${activeWorkspaceId}/test-telegram`,
                { method: "POST" }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Test failed");
            toast.success("Sent — check Telegram.");
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Test failed.");
        } finally {
            setTelegramTesting(false);
        }
    };

    const fetchApiKeys = async () => {
        try {
            const res = await fetch(`/api/settings/api-keys?workspaceId=${activeWorkspaceId}`);
            if (res.ok) {
                const data = await res.json();
                setApiKeys(data);
            }
        } catch (error) {
            console.error("Failed to fetch API keys");
        }
    };

    const handleGenerateKey = async () => {
        if (!activeWorkspaceId) return;
        setIsGenerating(true);
        try {
            const res = await fetch('/api/settings/api-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: activeWorkspaceId, name: "Google Sheets™ Add-on Key" })
            });
            if (res.ok) {
                const newKey = await res.json();
                setNewlyGeneratedKey(newKey.key); // Show the raw key just once
                fetchApiKeys(); // Refresh list
            } else {
                const errData = await res.json().catch(() => ({}));
                alert(`Failed to generate key: ${errData.error || res.statusText}`);
            }
        } catch (error: any) {
            console.error("Failed to generate key", error);
            alert(`Network or server error: ${error.message}`);
        }
        setIsGenerating(false);
    };

    const handleRevokeKey = async (id: string) => {
        if (!activeWorkspaceId) return;
        try {
            const res = await fetch(`/api/settings/api-keys?id=${id}&workspaceId=${activeWorkspaceId}`, {
                method: 'DELETE'
            });
            if (res.ok) fetchApiKeys();
        } catch (error) {
            console.error("Failed to revoke key");
        }
    };

    const copyToClipboard = () => {
        if (newlyGeneratedKey) {
            navigator.clipboard.writeText(newlyGeneratedKey);
            alert("API Key copied to clipboard! Keep it safe.");
            setNewlyGeneratedKey(null); // Hide after copy
        }
    };

    const goToProductDemo = () => {
        setActiveTab("workspace");
        if (typeof window === "undefined") return;
        window.history.replaceState(null, "", "/settings?tab=workspace#product-demo");
        setTimeout(() => {
            document.getElementById("product-demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
    };

    return (
        <div className="relative max-w-5xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Liquid Glass Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[10%] left-[20%] w-[30%] h-[30%] rounded-full bg-slate-200/40 dark:bg-slate-800/40 blur-[100px]" />
            </div>

            {/* Header Section */}
            <div className="mb-8 relative z-10">
                <div className="flex items-center space-x-3 mb-2">
                    <div className="w-10 h-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-gray-200/60 dark:border-slate-700 rounded-xl flex items-center justify-center shadow-sm text-gray-700 dark:text-slate-300">
                        <Settings2 className="w-5 h-5" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Settings</h1>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                    Manage your workspace, clients, team members, billing, and developer configuration.
                </p>
                <button
                    type="button"
                    onClick={goToProductDemo}
                    className="mt-4 flex w-full max-w-xl items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50/90 px-4 py-3 text-left text-sm shadow-sm transition hover:bg-violet-100/90 dark:border-violet-800/60 dark:bg-violet-950/40 dark:hover:bg-violet-950/60 sm:max-w-none"
                >
                    <Sparkles className="h-5 w-5 shrink-0 text-violet-600 dark:text-violet-300" />
                    <span>
                        <span className="font-semibold text-violet-900 dark:text-violet-100">Product demo (mock data)</span>
                        <span className="mt-0.5 block text-xs text-violet-800/80 dark:text-violet-200/90">
                            Turn on sample Meta / Shopee / Google Ads metrics for screenshots — opens Workspace → Product demo
                        </span>
                    </span>
                </button>
            </div>

            <div className="flex flex-col md:flex-row gap-8 relative z-10">

                {/* Settings Sidebar Nav */}
                <div className="w-full md:w-64 shrink-0">
                    <nav className="space-y-1">
                        <button
                            onClick={() => setActiveTab('workspace')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'workspace' ? 'bg-white dark:bg-slate-800 shadow-sm border border-gray-200/60 dark:border-slate-700 text-cyan-700 dark:text-cyan-400' : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white border border-transparent'}`}
                        >
                            <Building2 className={`w-4 h-4 mr-3 ${activeTab === 'workspace' ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400'}`} />
                            Workspace
                        </button>
                        <button
                            type="button"
                            onClick={goToProductDemo}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                                activeTab === "workspace"
                                    ? "border-violet-200/80 bg-violet-50/90 text-violet-900 dark:border-violet-800/50 dark:bg-violet-950/35 dark:text-violet-100"
                                    : "border-transparent text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <Sparkles className={`w-4 h-4 mr-3 ${activeTab === "workspace" ? "text-violet-600 dark:text-violet-300" : "text-gray-400"}`} />
                            Product demo
                        </button>
                        <button
                            onClick={() => setActiveTab('clients')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'clients' ? 'bg-white dark:bg-slate-800 shadow-sm border border-gray-200/60 dark:border-slate-700 text-cyan-700 dark:text-cyan-400' : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white border border-transparent'}`}
                        >
                            <Briefcase className={`w-4 h-4 mr-3 ${activeTab === 'clients' ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400'}`} />
                            Clients
                        </button>
                        <button
                            onClick={() => setActiveTab('team')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'team' ? 'bg-white dark:bg-slate-800 shadow-sm border border-gray-200/60 dark:border-slate-700 text-cyan-700 dark:text-cyan-400' : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white border border-transparent'}`}
                        >
                            <Users className={`w-4 h-4 mr-3 ${activeTab === 'team' ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400'}`} />
                            Team
                        </button>
                        <button
                            onClick={() => setActiveTab('billing')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'billing' ? 'bg-white dark:bg-slate-800 shadow-sm border border-gray-200/60 dark:border-slate-700 text-cyan-700 dark:text-cyan-400' : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white border border-transparent'}`}
                        >
                            <CreditCard className={`w-4 h-4 mr-3 ${activeTab === 'billing' ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400'}`} />
                            Billing
                        </button>
                        <button
                            onClick={() => setActiveTab('api')}
                            className={`flex items-center w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === 'api' ? 'bg-white dark:bg-slate-800 shadow-sm border border-gray-200/60 dark:border-slate-700 text-cyan-700 dark:text-cyan-400' : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white border border-transparent'}`}
                        >
                            <KeyRound className={`w-4 h-4 mr-3 ${activeTab === 'api' ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-400'}`} />
                            API Keys
                        </button>
                    </nav>
                </div>

                {/* Main Settings Content area */}
                <div className="flex-1 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/80 dark:border-slate-700/60 rounded-3xl shadow-sm p-6 sm:p-8 animate-in fade-in duration-300">

                    {activeTab === 'workspace' && (
                        <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Workspace Profile</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Update your company name and workspace URL.</p>

                                <div className="space-y-5 max-w-lg">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Workspace Name</label>
                                        <input
                                            type="text"
                                            defaultValue={activeWorkspace?.name || ''}
                                            placeholder="Your workspace name"
                                            className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-900 dark:text-white text-sm rounded-xl focus:ring-cyan-500 focus:border-cyan-500 block p-2.5 shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Workspace URL</label>
                                        <div className="flex bg-white rounded-xl shadow-sm border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-cyan-500 focus-within:border-cyan-500">
                                            <span className="inline-flex items-center px-3 text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-slate-800 border-r border-gray-200 dark:border-slate-700">
                                                monsteracloud.com/
                                            </span>
                                            <input
                                                type="text"
                                                defaultValue={activeWorkspace?.name?.toLowerCase().replace(/\s+/g, '-') || ''}
                                                placeholder="your-workspace"
                                                className="flex-1 min-w-0 block w-full px-3 py-2.5 sm:text-sm text-gray-900 dark:text-white dark:bg-slate-800 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-cyan-100/90 bg-cyan-50/50 dark:bg-cyan-950/25 dark:border-cyan-900/45 p-5 sm:p-6">
                                <div className="flex items-start gap-3">
                                    <MessageCircle className="w-5 h-5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1 space-y-3">
                                        <div>
                                            <h3 className="text-base font-bold text-gray-900 dark:text-white">
                                                Sync failure alerts (Telegram)
                                            </h3>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                Pipeline sync errors can notify a Telegram chat. Configure{" "}
                                                <span className="font-mono text-xs">TELEGRAM_BOT_TOKEN</span> in server
                                                env, then set this workspace&apos;s chat ID (or use env{" "}
                                                <span className="font-mono text-xs">TELEGRAM_CHAT_ID</span> as fallback).
                                                Zalo and other channels are not wired in-app yet — use email alerts from
                                                scheduled jobs or a webhook in your stack if needed.
                                            </p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                                Telegram chat ID (optional)
                                            </label>
                                            <input
                                                type="text"
                                                value={telegramChatDraft}
                                                onChange={(e) => setTelegramChatDraft(e.target.value)}
                                                placeholder="e.g. -1001234567890"
                                                className="w-full max-w-md bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-900 dark:text-white text-sm rounded-xl focus:ring-cyan-500 focus:border-cyan-500 p-2.5 shadow-sm font-mono"
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void saveTelegramChat()}
                                                disabled={telegramSaving}
                                                className="inline-flex items-center px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                                            >
                                                {telegramSaving ? "Saving…" : "Save alert settings"}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void testTelegramAlert()}
                                                disabled={telegramTesting}
                                                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 text-gray-800 dark:text-slate-200 text-sm font-semibold rounded-xl transition-colors"
                                            >
                                                {telegramTesting ? "Sending…" : "Send test message"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-200/60 dark:border-slate-700" />

                            <div
                                id="product-demo"
                                className="rounded-2xl border border-violet-100/90 bg-violet-50/40 dark:bg-violet-950/20 dark:border-violet-900/40 p-5 sm:p-6 scroll-mt-24"
                            >
                                <div className="flex items-start gap-3">
                                    <Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
                                    <div className="min-w-0 flex-1 space-y-4">
                                        <div>
                                            <h3 className="text-base font-bold text-gray-900 dark:text-white">
                                                Product demo (mock data)
                                            </h3>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                                Overlay sample clients, team roster, ingestion charts, and ROAS for slides
                                                or QA. Turning the master switch off removes all demo overlays. Platform
                                                toggles control which channels contribute to metrics (Meta Ads, Shopee
                                                commerce metrics, Google Ads) — dimensions and labels match each
                                                integration.
                                            </p>
                                        </div>

                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-violet-100/80 bg-white/80 dark:bg-slate-900/50 dark:border-violet-900/35 px-4 py-3">
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                    Demo mode
                                                </p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Master switch for console mock data
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={demoMaster}
                                                onClick={() => void saveDemoSettings({ master: !demoMaster })}
                                                disabled={demoSaving}
                                                className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
                                                    demoMaster ? "bg-cyan-500" : "bg-gray-200 dark:bg-slate-600"
                                                } disabled:opacity-50`}
                                            >
                                                <span
                                                    className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                                                        demoMaster ? "translate-x-6" : "translate-x-0"
                                                    }`}
                                                />
                                            </button>
                                        </div>

                                        <div className={`space-y-3 ${!demoMaster ? "opacity-50 pointer-events-none" : ""}`}>
                                            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                Sample data by platform
                                            </p>
                                            {(
                                                [
                                                    {
                                                        key: "meta",
                                                        label: "Meta Ads",
                                                        sub: "Campaign / ad set metrics (impressions, spend, ROAS)",
                                                        on: demoMeta,
                                                        set: setDemoMeta,
                                                    },
                                                    {
                                                        key: "shopee",
                                                        label: "Shopee",
                                                        sub: "Store & order-style signals (GMV-weighted ingestion)",
                                                        on: demoShopee,
                                                        set: setDemoShopee,
                                                    },
                                                    {
                                                        key: "gads",
                                                        label: "Google Ads",
                                                        sub: "Customer ID campaigns (cost, conv. value, search)",
                                                        on: demoGoogleAds,
                                                        set: setDemoGoogleAds,
                                                    },
                                                ] as const
                                            ).map((row) => (
                                                <div
                                                    key={row.key}
                                                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-gray-100 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 px-4 py-3"
                                                >
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                                                            {row.label}
                                                        </p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {row.sub}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={row.on}
                                                        onClick={() => row.set(!row.on)}
                                                        disabled={!demoMaster || demoSaving}
                                                        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors self-end sm:self-auto ${
                                                            row.on ? "bg-cyan-500" : "bg-gray-200 dark:bg-slate-600"
                                                        }`}
                                                    >
                                                        <span
                                                            className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                                                                row.on ? "translate-x-6" : "translate-x-0"
                                                            }`}
                                                        />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setDemoMaster(true);
                                                    setDemoMeta(true);
                                                    setDemoShopee(true);
                                                    setDemoGoogleAds(true);
                                                    void saveDemoSettings({
                                                        master: true,
                                                        meta: true,
                                                        shopee: true,
                                                        googleAds: true,
                                                    });
                                                }}
                                                disabled={demoSaving}
                                                className="inline-flex items-center px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                                            >
                                                Enable all sample platforms
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void saveDemoSettings({
                                                        master: demoMaster,
                                                        meta: demoMeta,
                                                        shopee: demoShopee,
                                                        googleAds: demoGoogleAds,
                                                    })
                                                }
                                                disabled={demoSaving || !demoMaster}
                                                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50 text-gray-800 dark:text-slate-200 text-sm font-semibold rounded-xl transition-colors"
                                            >
                                                {demoSaving ? "Saving…" : "Save platform toggles"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-gray-200/60 dark:border-slate-700" />

                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Data Retention</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Configure how long Monstera stores temporary sync logs.</p>

                                <div className="max-w-lg">
                                    <select className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-900 dark:text-white text-sm rounded-xl focus:ring-cyan-500 focus:border-cyan-500 block p-2.5 shadow-sm">
                                        <option>7 Days (Default)</option>
                                        <option>30 Days</option>
                                        <option>90 Days</option>
                                    </select>
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <button className="flex items-center px-6 py-2.5 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-xl shadow-sm transition-colors">
                                    <Save className="w-4 h-4 mr-2" />
                                    Save Changes
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'clients' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Client Management</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Group your pipelines and connections by agency client.</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input 
                                        type="text"
                                        value={newClientName}
                                        onChange={(e) => setNewClientName(e.target.value)}
                                        placeholder="Client name (e.g. Nike VN)"
                                        className="bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 text-gray-900 dark:text-white text-xs rounded-xl p-2 w-48 shadow-sm focus:ring-cyan-500 focus:border-cyan-500"
                                    />
                                    <button 
                                        onClick={handleAddClient}
                                        disabled={isAddingClient || !newClientName.trim()}
                                        className="flex items-center px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50">
                                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                                        {isAddingClient ? "Adding..." : "Add Client"}
                                    </button>
                                </div>
                            </div>

                            {clients.length === 0 ? (
                                <div className="text-center py-16 border-2 border-dashed border-gray-100 dark:border-slate-800 rounded-3xl">
                                    <Briefcase className="w-10 h-10 text-gray-200 dark:text-slate-700 mx-auto mb-4" />
                                    <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs mx-auto">
                                        No clients added yet. Grouping by client makes it easier to manage large agency portfolios.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {clients.map((client: { id: string; name: string; isDemo?: boolean; _count?: { pipelines?: number; connections?: number } }) => (
                                        <div key={client.id} className="p-5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-sm flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                {client.isDemo ? (
                                                    <span className="mb-2 inline-flex items-center rounded-full bg-violet-100 dark:bg-violet-950/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200">
                                                        Demo
                                                    </span>
                                                ) : null}
                                                {editingClientId === client.id ? (
                                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                                        <input
                                                            type="text"
                                                            value={editClientNameValue}
                                                            onChange={(e) => setEditClientNameValue(e.target.value)}
                                                            className="w-full bg-white dark:bg-slate-900 border border-cyan-200 dark:border-cyan-900 text-gray-900 dark:text-white text-sm rounded-lg px-2 py-1.5"
                                                            autoFocus
                                                        />
                                                        <div className="flex gap-2 shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleRenameClient(client.id)}
                                                                className="text-xs font-semibold text-cyan-600 hover:underline"
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingClientId(null);
                                                                }}
                                                                className="text-xs font-semibold text-gray-500 hover:underline"
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <h4 className="font-bold text-gray-900 dark:text-white mb-1 truncate">
                                                        {client.name}
                                                    </h4>
                                                )}
                                                <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                                                    <span className="flex items-center gap-1">
                                                        <Activity className="w-3 h-3" />
                                                        {client._count?.pipelines || 0} Pipelines
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Database className="w-3 h-3" />
                                                        {client._count?.connections || 0} Sources
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {!client.isDemo ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            title="Rename client"
                                                            onClick={() => {
                                                                setEditingClientId(client.id);
                                                                setEditClientNameValue(client.name);
                                                            }}
                                                            className="p-2 text-gray-500 hover:text-cyan-600 transition-colors rounded-lg hover:bg-cyan-50 dark:hover:bg-cyan-950/40"
                                                        >
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            title="Remove client"
                                                            onClick={() => handleDeleteClient(client.id, false)}
                                                            className="p-2 text-gray-500 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 px-2">
                                                        Sample
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {unassignedConns.length > 0 && (
                                <div className="mt-12">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <ShieldAlert className="w-4 h-4 text-amber-500" />
                                            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-tight">
                                                Organize Unassigned Connections
                                            </h3>
                                        </div>
                                        <div className="relative max-w-xs w-full">
                                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input
                                                type="search"
                                                value={unassignedSearch}
                                                onChange={(e) => setUnassignedSearch(e.target.value)}
                                                placeholder="Filter by name or provider…"
                                                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-amber-200/80 bg-white dark:bg-slate-900 dark:border-amber-900/50 text-gray-900 dark:text-white"
                                            />
                                        </div>
                                    </div>
                                    <div className="bg-amber-50/50 border border-amber-100 rounded-3xl p-6">
                                        <div className="space-y-3">
                                            {filteredUnassigned.length === 0 ? (
                                                <p className="text-sm text-amber-800/80 dark:text-amber-200/80 text-center py-4">
                                                    No connections match your search.
                                                </p>
                                            ) : null}
                                            {filteredUnassigned.map((conn: { id: string; name: string; provider: string }) => (
                                                <div key={conn.id} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 shadow-sm">
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 bg-gray-50 rounded-lg">
                                                            <Database className="w-3.5 h-3.5 text-gray-400" />
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-bold text-gray-900 dark:text-white">{conn.name}</p>
                                                            <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter">{conn.provider}</p>
                                                        </div>
                                                    </div>
                                                    <select 
                                                        onChange={(e) => handleAssignClient(conn.id, e.target.value)}
                                                        className="text-[10px] font-bold bg-gray-50 border-none rounded-lg focus:ring-cyan-500"
                                                        defaultValue=""
                                                    >
                                                        <option value="" disabled>Select Client...</option>
                                                        {clients
                                                            .filter((c: { isDemo?: boolean }) => !c.isDemo)
                                                            .map((c: { id: string; name: string }) => (
                                                                <option key={c.id} value={c.id}>
                                                                    {c.name}
                                                                </option>
                                                            ))}
                                                    </select>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'team' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Team Members</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Manage who has access to this workspace.</p>
                            </div>

                            {demoMaster ? (
                                <div className="rounded-2xl border border-violet-100 dark:border-violet-900/40 bg-violet-50/30 dark:bg-violet-950/15 p-5 mb-4">
                                    <p className="text-xs font-bold uppercase tracking-wider text-violet-800 dark:text-violet-200 mb-3">
                                        Demo roster (screenshots)
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {MOCK_TEAM.map((m) => (
                                            <div
                                                key={m.id}
                                                className="rounded-xl border border-white/80 dark:border-slate-700 bg-white dark:bg-slate-900/80 p-4 shadow-sm"
                                            >
                                                <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                                                    {m.name}
                                                </p>
                                                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                                                    {m.email}
                                                </p>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    <span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-gray-100 dark:bg-slate-800 px-2 py-0.5 text-gray-600 dark:text-gray-300">
                                                        {m.role}
                                                    </span>
                                                    <span className="text-[10px] font-medium text-violet-700 dark:text-violet-300">
                                                        {m.title}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : null}

                            <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl px-4">
                                <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider mb-3">Coming Soon</span>
                                <p className="text-gray-500 dark:text-gray-400 text-sm text-center max-w-md leading-relaxed">
                                    Invites and workspace roles (owner / admin / member) will land here.{" "}
                                    <span className="text-gray-600 dark:text-gray-300 font-medium">
                                        Per-client permissions
                                    </span>{" "}
                                    are a larger change (data model + audits); for now, access is per workspace — use
                                    clients for grouping only.
                                    {demoMaster ? (
                                        <>
                                            {" "}
                                            The cards above are fictional people for demo mode only.
                                        </>
                                    ) : null}
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'billing' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Current Plan</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400">You are currently on the <span className="font-semibold capitalize">{userPlan}</span> plan.</p>
                            </div>

                            <div className="bg-gradient-to-br from-cyan-900 to-cyan-800 rounded-3xl p-8 text-white relative overflow-hidden shadow-xl shadow-cyan-900/10">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>

                                <div className="relative z-10">
                                    <div className="inline-flex items-center px-3 py-1 bg-white/10 rounded-full text-xs font-semibold tracking-wider uppercase mb-4 border border-white/20">
                                        {userPlan} Plan
                                    </div>
                                    <p className="text-cyan-200 text-sm max-w-sm mb-4">
                                        {userPlan === 'free'
                                            ? 'Upgrade to unlock more connections and faster refresh rates.'
                                            : `You have access to all ${userPlan}-tier features including TikTok Ads reports and Shopee data.`}
                                    </p>
                                    <Link href="/pricing" className="inline-flex items-center px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold border border-white/20 transition-colors">
                                        {userPlan === 'free' ? 'Upgrade Plan' : 'View Plans'}
                                    </Link>
                                </div>
                            </div>

                            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl">
                                <span className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider mb-3">Coming Soon</span>
                                <p className="text-gray-500 dark:text-gray-400 text-sm text-center max-w-sm">Payment history, invoice downloads, and subscription management will appear here.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'api' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Developer API Keys</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Create programmatic access tokens for the Monstera API (e.g., Google Sheets™ Add-on).</p>
                                </div>
                                <button 
                                    onClick={handleGenerateKey}
                                    disabled={isGenerating}
                                    className="flex items-center px-4 py-2 bg-gray-900 hover:bg-black text-white text-sm font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50">
                                    <Plus className="w-4 h-4 mr-2" />
                                    {isGenerating ? "Generating..." : "Generate Key"}
                                </button>
                            </div>

                            <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5 mb-6 flex items-start space-x-3">
                                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="font-semibold text-blue-900 text-sm mb-1">Keep your keys secure</h4>
                                    <p className="text-sm text-blue-700">API keys grant full access to your workspace data. Do not commit them to public repositories or client-side code.</p>
                                </div>
                            </div>

                            {newlyGeneratedKey && (
                                <div className="bg-cyan-50/50 border border-cyan-200 rounded-2xl p-5 mb-6">
                                    <h4 className="font-semibold text-cyan-900 text-sm mb-2 flex items-center">
                                        <CheckCircle2 className="w-4 h-4 mr-1 text-cyan-600" /> Key Generated Successfully
                                    </h4>
                                    <p className="text-sm text-cyan-700 mb-3">Please copy this value now. You won't be able to see it again.</p>
                                    <div className="flex items-center space-x-2">
                                        <code className="flex-1 bg-white border border-cyan-100 px-3 py-2 rounded-lg text-sm text-cyan-900 font-mono select-all">
                                            {newlyGeneratedKey}
                                        </code>
                                        <button onClick={copyToClipboard} className="p-2 border border-cyan-200 bg-white rounded-lg text-cyan-700 hover:bg-cyan-100 transition-colors">
                                            <Copy className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {apiKeys.length === 0 ? (
                                <div className="text-center py-10 border border-dashed border-gray-200 rounded-2xl">
                                    <KeyRound className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500 text-sm">No API Keys generated yet.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {apiKeys.map((keyObj) => (
                                        <div key={keyObj.id} className="bg-white border border-gray-200/60 rounded-2xl shadow-sm overflow-hidden p-4 flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-bold text-gray-900 mb-1">{keyObj.name}</div>
                                                <div className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                                    {keyObj.keyMasked}
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-3">
                                                <div className="text-[11px] font-medium text-gray-400">
                                                    Created {new Date(keyObj.createdAt).toLocaleDateString()}
                                                </div>
                                                <button 
                                                    onClick={() => handleRevokeKey(keyObj.id)}
                                                    className="text-sm font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors">
                                                    Revoke
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
