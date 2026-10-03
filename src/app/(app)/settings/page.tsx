"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useState, useEffect, useCallback } from 'react';
import { SettingsExperience } from "@/components/settings/SettingsExperience";
import { settingsSections, type SettingsSectionId } from "@/components/settings/settings-sections";
import { useWorkspaceStore } from "@/store/workspace";
import useSWR from "swr";
import { toast } from "sonner";

import { WorkspaceTab } from "@/components/settings/WorkspaceTab";
import { ClientsTab } from "@/components/settings/ClientsTab";
import { TeamTab } from "@/components/settings/TeamTab";
import { BillingTab } from "@/components/settings/BillingTab";
import { ApiKeysTab } from "@/components/settings/ApiKeysTab";
import { SessionsTab } from "@/components/settings/SessionsTab";
import { DataQualityTab } from "@/components/settings/DataQualityTab";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to fetch');
    return data;
};

export default function SettingsPage({ previewAccessory }: { previewAccessory?: React.ReactNode } = {}) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const tabs = settingsSections.map(section => section.id);
    type SettingsTab = SettingsSectionId;
    const requestedTab = searchParams.get('tab');
    const activeTab: SettingsTab = tabs.includes(requestedTab as SettingsTab) ? requestedTab as SettingsTab : 'overview';
    const setActiveTab = (tab: SettingsTab) => {
        const query = new URLSearchParams(searchParams.toString());
        query.set('tab', tab);
        router.push(`${pathname}?${query}`, { scroll: false });
    };
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
            const storageKey = `monstera:api-key:create:${activeWorkspaceId}`;
            const idempotencyKey = sessionStorage.getItem(storageKey) || crypto.randomUUID();
            sessionStorage.setItem(storageKey, idempotencyKey);
            const res = await fetch("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ workspaceId: activeWorkspaceId, name: "Pilot API key" }) });
            if (res.ok) {
                const data = await res.json();
                setNewlyGeneratedKey(data.key);
                sessionStorage.removeItem(storageKey);
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

    const handleRotateKey = async (id: string) => {
        if (!confirm("Rotate this API key? The old secret stops working immediately — update Looker/Sheets configs right away.")) return;
        try {
            const storageKey = `monstera:api-key:rotate:${activeWorkspaceId}:${id}`;
            const idempotencyKey = sessionStorage.getItem(storageKey) || crypto.randomUUID();
            sessionStorage.setItem(storageKey, idempotencyKey);
            const res = await fetch("/api/settings/api-keys/rotate", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ workspaceId: activeWorkspaceId, id }) });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setNewlyGeneratedKey(data.key);
                sessionStorage.removeItem(storageKey);
                fetchApiKeys();
                toast.success("API Key rotated — copy the new secret now");
            } else {
                toast.error(data.error || "Failed to rotate key");
            }
        } catch { toast.error("Failed to rotate key"); }
    };

    const handlePinKey = async (id: string, enabled: boolean) => {
        if (enabled && !confirm("Pin this key to your current network? It will stop working everywhere else — only use this for static office IPs, never for Looker scheduled refresh.")) return;
        try {
            const res = await fetch("/api/settings/api-keys/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: activeWorkspaceId, id, enabled }) });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                fetchApiKeys();
                toast.success(enabled ? "Key pinned to this network" : "Pin removed");
            } else {
                toast.error(data.error || "Failed to update pin");
            }
        } catch { toast.error("Failed to update pin"); }
    };

    return (
        <SettingsExperience active={activeTab} onSelect={setActiveTab} workspaceName={activeWorkspace?.name} role={activeWorkspace?.role} previewAccessory={previewAccessory}>
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
                    {activeTab === 'sessions' && <SessionsTab />}
                    {activeTab === 'api' && (
                        <ApiKeysTab
                            apiKeys={apiKeys}
                            newlyGeneratedKey={newlyGeneratedKey}
                            isGenerating={isGenerating}
                            canManage={canManage}
                            handleGenerateKey={handleGenerateKey}
                            handleDeleteKey={handleDeleteKey}
                            handleRotateKey={handleRotateKey}
                            handlePinKey={handlePinKey}
                        />
                    )}
        </SettingsExperience>
    );
}
