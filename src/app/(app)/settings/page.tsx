"use client";

import React, { useState, useEffect } from 'react';
import { Settings2, Building2, Users, CreditCard, KeyRound, Briefcase } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import useSWR, { useSWRConfig } from "swr";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { WorkspaceTab } from "@/components/settings/WorkspaceTab";
import { ClientsTab } from "@/components/settings/ClientsTab";
import { TeamTab } from "@/components/settings/TeamTab";
import { BillingTab } from "@/components/settings/BillingTab";
import { ApiKeysTab } from "@/components/settings/ApiKeysTab";

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

    // Shared UI State
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
    const [revealKeyId, setRevealKeyId] = useState<string | null>(null);
    const [revealPassword, setRevealPassword] = useState("");
    const [revealBusy, setRevealBusy] = useState(false);
    const [revealError, setRevealError] = useState<string | null>(null);
    const [revealedKey, setRevealedKey] = useState<string | null>(null);

    const hasPassword = Boolean((session?.user as any)?.hasPassword);

    // Client Management State
    const [clients, setClients] = useState<any[]>([]);
    const [unassignedConns, setUnassignedConns] = useState<any[]>([]);
    const [isAddingClient, setIsAddingClient] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    // Persistence of Tab
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab") as any;
        if (['workspace', 'clients', 'team', 'billing', 'api'].includes(tab)) {
            setActiveTab(tab);
        }
    }, []);

    // Sync state with active workspace
    useEffect(() => {
        if (!activeWorkspace) return;
        setTelegramChatDraft(activeWorkspace.telegramChatId ?? "");
        setDemoMaster(!!activeWorkspace.demoMockMode);
        setDemoMeta(!!activeWorkspace.demoMockMeta);
        setDemoShopee(!!activeWorkspace.demoMockShopee);
        setDemoGoogleAds(!!activeWorkspace.demoMockGoogleAds);
    }, [activeWorkspace]);

    // Fetch data for active tab
    useEffect(() => {
        if (activeTab === 'api' && activeWorkspaceId) {
            fetchApiKeys();
        }
        if (activeTab === 'clients' && activeWorkspaceId) {
            fetchClients();
            fetchUnassigned();
        }
    }, [activeTab, activeWorkspaceId]);

    // --- API Handlers ---

    const fetchApiKeys = async () => {
        try {
            const res = await fetch("/api/settings/api-keys");
            if (res.ok) setApiKeys(await res.json());
        } catch (e) {
            toast.error("Failed to fetch API keys");
        }
    };

    const fetchClients = async () => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/clients`);
            if (res.ok) setClients(await res.json());
        } catch (e) {
            toast.error("Failed to fetch clients");
        }
    };

    const fetchUnassigned = async () => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections?unassigned=true`);
            if (res.ok) setUnassignedConns(await res.json());
        } catch (e) {
            console.error("Failed to fetch unassigned connections");
        }
    };

    const handleAddClient = async () => {
        if (!newClientName.trim()) return;
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/clients`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newClientName }),
            });
            if (res.ok) {
                setNewClientName('');
                setIsAddingClient(false);
                fetchClients();
                toast.success("Client added");
            }
        } catch (e) { toast.error("Failed to add client"); }
    };

    const handleUpdateClient = async (id: string) => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/clients/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: editClientNameValue }),
            });
            if (res.ok) {
                setEditingClientId(null);
                fetchClients();
                toast.success("Client updated");
            }
        } catch (e) { toast.error("Failed to update client"); }
    };

    const handleDeleteClient = async (id: string) => {
        if (!confirm("Are you sure? This will unassign all connections.")) return;
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/clients/${id}`, { method: "DELETE" });
            if (res.ok) { fetchClients(); fetchUnassigned(); toast.success("Client deleted"); }
        } catch (e) { toast.error("Failed to delete client"); }
    };

    const handleAssignClient = async (connId: string, clientId: string) => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections/${connId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId }),
            });
            if (res.ok) { fetchClients(); fetchUnassigned(); toast.success("Assigned successfully"); }
        } catch (e) { toast.error("Assignment failed"); }
    };

    const handleUnassignClient = async (connId: string) => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections/${connId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: null }),
            });
            if (res.ok) { fetchClients(); fetchUnassigned(); toast.success("Unassigned"); }
        } catch (e) { toast.error("Failed to unassign"); }
    };

    const handleGenerateKey = async () => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/settings/api-keys", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setNewlyGeneratedKey(data.key);
                fetchApiKeys();
                toast.success("API Key generated");
            }
        } finally { setIsGenerating(false); }
    };

    const handleDeleteKey = async (id: string) => {
        if (!confirm("Delete this API key? Apps using it will fail.")) return;
        try {
            const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
            if (res.ok) { fetchApiKeys(); toast.success("API Key deleted"); }
        } catch (e) { toast.error("Failed to delete key"); }
    };

    const handleRevealKey = async (id: string) => {
        setRevealBusy(true);
        setRevealError(null);
        try {
            const res = await fetch(`/api/settings/api-keys/${id}/reveal`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: revealPassword }),
            });
            const data = await res.json();
            if (res.ok) setRevealedKey(data.key);
            else setRevealError(data.error || "Failed to reveal");
        } finally { setRevealBusy(false); }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-4">
                <div className="flex items-center">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 mr-5">
                        <Settings2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Settings</h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-1 font-medium">Manage your workspace, team, and billing</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* Sidebar Navigation */}
                <div className="lg:col-span-3">
                    <nav className="space-y-1.5 sticky top-8">
                        {[
                            { id: 'workspace', label: 'Workspace', icon: Building2 },
                            { id: 'clients', label: 'Clients', icon: Briefcase },
                            { id: 'team', label: 'Team', icon: Users },
                            { id: 'billing', label: 'Billing', icon: CreditCard },
                            { id: 'api', label: 'API Keys', icon: KeyRound },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as any)}
                                className={cn(
                                    "flex items-center w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200",
                                    activeTab === tab.id
                                        ? "bg-white dark:bg-slate-800 shadow-md border border-gray-200/50 dark:border-slate-700 text-cyan-700 dark:text-cyan-400"
                                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-white border border-transparent"
                                )}
                            >
                                <tab.icon className={cn("w-4 h-4 mr-3", activeTab === tab.id ? "text-cyan-600 dark:text-cyan-400" : "text-gray-400")} />
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content Area */}
                <div className="lg:col-span-9">
                    {activeTab === 'workspace' && (
                        <WorkspaceTab
                            activeWorkspace={activeWorkspace}
                            activeWorkspaceId={activeWorkspaceId}
                            telegramChatDraft={telegramChatDraft}
                            setTelegramChatDraft={setTelegramChatDraft}
                            telegramSaving={telegramSaving}
                            setTelegramSaving={setTelegramSaving}
                            telegramTesting={telegramTesting}
                            setTelegramTesting={setTelegramTesting}
                            demoMaster={demoMaster}
                            setDemoMaster={setDemoMaster}
                            demoMeta={demoMeta}
                            setDemoMeta={setDemoMeta}
                            demoShopee={demoShopee}
                            setDemoShopee={setDemoShopee}
                            demoGoogleAds={demoGoogleAds}
                            setDemoGoogleAds={setDemoGoogleAds}
                            demoSaving={demoSaving}
                            setDemoSaving={setDemoSaving}
                        />
                    )}
                    {activeTab === 'clients' && (
                        <ClientsTab
                            clients={clients}
                            unassignedConns={unassignedConns}
                            unassignedSearch={unassignedSearch}
                            setUnassignedSearch={setUnassignedSearch}
                            isAddingClient={isAddingClient}
                            setIsAddingClient={setIsAddingClient}
                            newClientName={newClientName}
                            setNewClientName={setNewClientName}
                            editingClientId={editingClientId}
                            setEditingClientId={setEditingClientId}
                            editClientNameValue={editClientNameValue}
                            setEditClientNameValue={setEditClientNameValue}
                            handleAddClient={handleAddClient}
                            handleUpdateClient={handleUpdateClient}
                            handleDeleteClient={handleDeleteClient}
                            handleAssignClient={handleAssignClient}
                            handleUnassignClient={handleUnassignClient}
                        />
                    )}
                    {activeTab === 'team' && <TeamTab />}
                    {activeTab === 'billing' && <BillingTab userPlan={userPlan} />}
                    {activeTab === 'api' && (
                        <ApiKeysTab
                            apiKeys={apiKeys}
                            newlyGeneratedKey={newlyGeneratedKey}
                            isGenerating={isGenerating}
                            revealKeyId={revealKeyId}
                            setRevealKeyId={setRevealKeyId}
                            revealPassword={revealPassword}
                            setRevealPassword={setRevealPassword}
                            revealBusy={revealBusy}
                            revealError={revealError}
                            revealedKey={revealedKey}
                            hasPassword={hasPassword}
                            handleGenerateKey={handleGenerateKey}
                            handleDeleteKey={handleDeleteKey}
                            handleRevealKey={handleRevealKey}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
