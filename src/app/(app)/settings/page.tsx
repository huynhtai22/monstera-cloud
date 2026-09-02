"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Settings2, Building2, Users, CreditCard, KeyRound, Briefcase, Bell } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { WorkspaceTab } from "@/components/settings/WorkspaceTab";
import { ClientsTab } from "@/components/settings/ClientsTab";
import { TeamTab } from "@/components/settings/TeamTab";
import { BillingTab } from "@/components/settings/BillingTab";
import { ApiKeysTab } from "@/components/settings/ApiKeysTab";
import { DataQualityTab } from "@/components/settings/DataQualityTab";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to fetch');
    return data;
};

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState<'workspace' | 'clients' | 'team' | 'alerts' | 'billing' | 'api'>('workspace');
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: workspaces } = useSWR("/api/workspaces", fetcher);
    const activeWorkspace = Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0] : null;
    const workspacePlan = activeWorkspace?.plan || 'pilot';
    const canManage = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

    // Shared UI State
    const [unassignedSearch, setUnassignedSearch] = useState("");
    const [editingClientId, setEditingClientId] = useState<string | null>(null);
    const [editClientNameValue, setEditClientNameValue] = useState("");

    const [apiKeys, setApiKeys] = useState<any[]>([]);
    const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    // Client Management State
    const [clients, setClients] = useState<any[]>([]);
    const [unassignedConns, setUnassignedConns] = useState<any[]>([]);
    const [isAddingClient, setIsAddingClient] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    // Data Quality State
    const [qualityData, setQualityData] = useState<{ rules: any[]; violations: any[]; telegramChatId: string }>({
        rules: [],
        violations: [],
        telegramChatId: "",
    });

    // Persistence of Tab
    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab") as any;
        if (['workspace', 'clients', 'team', 'alerts', 'billing', 'api'].includes(tab)) {
            setActiveTab(tab);
        }
    }, []);

    // --- API Handlers ---

    const fetchQualityData = useCallback(async () => {
        if (!activeWorkspaceId) return;
        try {
            const res = await fetch(`/api/settings/data-quality?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
            if (res.ok) setQualityData(await res.json());
        } catch {
            toast.error("Failed to fetch quality rules");
        }
    }, [activeWorkspaceId]);

    const fetchApiKeys = useCallback(async () => {
        try {
            const res = await fetch(`/api/settings/api-keys?workspaceId=${encodeURIComponent(activeWorkspaceId!)}`);
            if (res.ok) setApiKeys(await res.json());
        } catch {
            toast.error("Failed to fetch API keys");
        }
    }, [activeWorkspaceId]);

    const fetchClients = useCallback(async () => {
        try {
            const res = await fetch(`/api/clients?workspaceId=${encodeURIComponent(activeWorkspaceId!)}`);
            if (res.ok) setClients(await res.json());
        } catch {
            toast.error("Failed to fetch clients");
        }
    }, [activeWorkspaceId]);

    const fetchUnassigned = useCallback(async () => {
        try {
            const res = await fetch(`/api/workspaces/${activeWorkspaceId}/connections?unassigned=true`);
            if (res.ok) setUnassignedConns(await res.json());
        } catch {
            console.error("Failed to fetch unassigned connections");
        }
    }, [activeWorkspaceId]);

    useEffect(() => {
        if (activeTab === 'alerts' && activeWorkspaceId) void fetchQualityData();
        if (activeTab === 'api' && activeWorkspaceId) void fetchApiKeys();
        if (activeTab === 'clients' && activeWorkspaceId) {
            void fetchClients();
            void fetchUnassigned();
        }
    }, [activeTab, activeWorkspaceId, fetchQualityData, fetchApiKeys, fetchClients, fetchUnassigned]);

    const handleAddClient = async () => {
        if (!newClientName.trim()) return;
        try {
            const res = await fetch(`/api/clients`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspaceId: activeWorkspaceId, name: newClientName }),
            });
            if (res.ok) {
                setNewClientName('');
                setIsAddingClient(false);
                fetchClients();
                toast.success("Client added");
            }
        } catch { toast.error("Failed to add client"); }
    };

    const handleUpdateClient = async (id: string) => {
        try {
            const res = await fetch(`/api/clients`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, workspaceId: activeWorkspaceId, name: editClientNameValue }),
            });
            if (res.ok) {
                setEditingClientId(null);
                fetchClients();
                toast.success("Client updated");
            }
        } catch { toast.error("Failed to update client"); }
    };

    const handleDeleteClient = async (id: string) => {
        if (!confirm("Are you sure? This will unassign all connections.")) return;
        try {
            const res = await fetch(`/api/clients?id=${encodeURIComponent(id)}&workspaceId=${encodeURIComponent(activeWorkspaceId!)}`, { method: "DELETE" });
            if (res.ok) { fetchClients(); fetchUnassigned(); toast.success("Client deleted"); }
        } catch { toast.error("Failed to delete client"); }
    };

    const handleAssignClient = async (connId: string, clientId: string) => {
        try {
            const res = await fetch(`/api/connections/${connId}/assign-client`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId, workspaceId: activeWorkspaceId }),
            });
            if (res.ok) { fetchClients(); fetchUnassigned(); toast.success("Assigned successfully"); }
        } catch { toast.error("Assignment failed"); }
    };

    const handleUnassignClient = async (connId: string) => {
        try {
            const res = await fetch(`/api/connections/${connId}/assign-client`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ clientId: null, workspaceId: activeWorkspaceId }),
            });
            if (res.ok) { fetchClients(); fetchUnassigned(); toast.success("Unassigned"); }
        } catch { toast.error("Failed to unassign"); }
    };

    const handleGenerateKey = async () => {
        setIsGenerating(true);
        try {
            const res = await fetch("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: activeWorkspaceId, name: "Pilot API key" }) });
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
            const res = await fetch(`/api/settings/api-keys?id=${encodeURIComponent(id)}&workspaceId=${encodeURIComponent(activeWorkspaceId!)}`, { method: "DELETE" });
            if (res.ok) { fetchApiKeys(); toast.success("API Key deleted"); }
        } catch { toast.error("Failed to delete key"); }
    };

    return (
        <div className="w-full px-6 py-8 sm:px-10 sm:py-10 lg:px-12">
            <div className="mb-6 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-panel">
                    <Settings2 className="w-4 h-4 text-ink" strokeWidth={1.5} />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-ink tracking-tight">Settings</h1>
                    <p className="text-xs text-ink-mute">Workspace, team &amp; billing</p>
                </div>
            </div>

            <div className="rounded-lg border border-line bg-panel">
                <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr]">
                    <div className="border-b border-line bg-canvas px-3 py-4 lg:border-b-0 lg:border-r">
                        <nav className="space-y-0.5 lg:sticky lg:top-8">
                            {[
                                { id: 'workspace', label: 'Workspace', icon: Building2 },
                                { id: 'clients', label: 'Clients', icon: Briefcase },
                                { id: 'team', label: 'Team', icon: Users },
                                { id: 'alerts', label: 'Alerts & Quality', icon: Bell },
                                { id: 'billing', label: 'Billing', icon: CreditCard },
                                { id: 'api', label: 'API Keys', icon: KeyRound },
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={cn(
                                        "flex items-center w-full px-3 py-2.5 rounded-md text-sm transition-colors",
                                        activeTab === tab.id
                                            ? "bg-white/[0.06] font-semibold text-ink"
                                            : "font-medium text-ink-mute hover:bg-white/[0.04] hover:text-ink"
                                    )}
                                >
                                    <tab.icon strokeWidth={1.5} className={cn("w-4 h-4 mr-2.5 shrink-0", activeTab === tab.id ? "text-ink" : "text-ink-mute")} />
                                    {tab.label}
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Content panel */}
                    <div className="min-w-0 px-6 py-5">
                    {activeTab === 'workspace' && (
                        <WorkspaceTab activeWorkspace={activeWorkspace} />
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
                    {activeTab === 'team' && <TeamTab workspaceId={activeWorkspaceId} currentRole={activeWorkspace?.role} />}
                    {activeTab === 'alerts' && (
                        <DataQualityTab
                            workspaceId={activeWorkspaceId!}
                            canManage={canManage}
                            rules={qualityData.rules}
                            violations={qualityData.violations}
                            telegramChatId={qualityData.telegramChatId}
                            onRefresh={fetchQualityData}
                        />
                    )}
                    {activeTab === 'billing' && <BillingTab workspacePlan={workspacePlan} workspaceStatus={activeWorkspace?.status} workspaceId={activeWorkspace?.id} subscriptionEndsAt={activeWorkspace?.subscriptionEndsAt} isOwner={activeWorkspace?.role === 'owner'} />}
                    {activeTab === 'api' && (
                        <ApiKeysTab
                            apiKeys={apiKeys}
                            newlyGeneratedKey={newlyGeneratedKey}
                            isGenerating={isGenerating}
                            canManage={canManage}
                            handleGenerateKey={handleGenerateKey}
                            handleDeleteKey={handleDeleteKey}
                        />
                    )}
                    </div>{/* end content panel */}
                </div>{/* end grid */}
            </div>{/* end bento */}
        </div>
    );
}
