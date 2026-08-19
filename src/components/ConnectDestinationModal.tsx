"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { X, Loader2, CheckCircle2, ChevronRight, Settings2, FileSpreadsheet, Lock, Plus } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { signIn } from "next-auth/react";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { trackEvent } from "@/lib/analytics-events";

import { DESTINATION_HELP_PATHS } from "@/lib/destination-help-urls";
import { useMounted } from "@/hooks/useMounted";

const PANEL_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const PANEL_DURATION_MS = 360;

interface ConnectDestinationModalProps {
    isOpen: boolean;
    destinationId?: string | null;
    onClose: () => void;
}

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to fetch');
    return data;
};

export function ConnectDestinationModal({ isOpen, destinationId, onClose }: ConnectDestinationModalProps) {
    const mounted = useMounted();
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [isProcessing, setIsProcessing] = useState(false);

    // Hooks for network invalidation and global state
    const { mutate } = useSWRConfig();
    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
    
    const connectionsKey = activeWorkspaceId
        ? `/api/workspaces/${activeWorkspaceId}/connections?type=destination`
        : null;
    const { data: destinationConnections = [] } = useSWR(connectionsKey, fetcher);
    const { data: apiKeys = [] } = useSWR(
        activeWorkspaceId ? `/api/settings/api-keys?workspaceId=${activeWorkspaceId}` : null,
        fetcher,
    );

    const activeConnections = React.useMemo(() => {
        if (!Array.isArray(destinationConnections)) return [];
        let providerId = destinationId;
        if (destinationId === 'gsheets') providerId = 'google_sheets';
        return destinationConnections.filter((c: any) => c.provider === providerId);
    }, [destinationConnections, destinationId]);

    const [forceSetup, setForceSetup] = useState(false);
    const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

    // Animation state for enter/exit transitions
    const [shouldRender, setShouldRender] = useState(isOpen);
    const [isVisible, setIsVisible] = useState(isOpen);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
            const raf = requestAnimationFrame(() => {
                requestAnimationFrame(() => setIsVisible(true));
            });
            return () => cancelAnimationFrame(raf);
        }
        setIsVisible(false);
        const t = setTimeout(() => setShouldRender(false), PANEL_DURATION_MS);
        return () => clearTimeout(t);
    }, [isOpen]);

    // Reset internal state when modal closes
    React.useEffect(() => {
        if (!isOpen) {
            setForceSetup(false);
            setStep(1);
        }
    }, [isOpen]);

    React.useEffect(() => {
        if (!isOpen || destinationId !== "looker") return;
        trackEvent("destination_modal_looker_opened", { workspaceId: activeWorkspaceId });
    }, [isOpen, destinationId, activeWorkspaceId]);

    React.useEffect(() => {
        if (!isOpen || destinationId !== "gsheets" || step !== 3) return;
        trackEvent("destination_modal_sheets_success_viewed", { workspaceId: activeWorkspaceId });
    }, [isOpen, destinationId, step, activeWorkspaceId]);

    useEffect(() => {
        if (!isOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    const isListView = destinationId !== 'looker' && activeConnections.length > 0 && !forceSetup;
        
    const firstKey = Array.isArray(apiKeys) ? apiKeys[0] as { keyMasked?: string } | undefined : undefined;
    const apiKeyMasked = firstKey?.keyMasked ?? "";
    const hasApiKey = Boolean(firstKey);

    if (!shouldRender || !mounted) return null;

    const handleAuthenticate = () => {
        setStep(2); // Move to Configure step
    };

    const handleDisconnect = async (connectionId: string, displayName: string) => {
        const ok = window.confirm(`Disconnect "${displayName}"?\n\nThis will remove it from Monstera Cloud.`);
        if (!ok) return;
        setDisconnectingId(connectionId);
        try {
            const res = await fetch(`/api/connections/${connectionId}`, { method: "DELETE" });
            if (res.ok) {
                if (connectionsKey) await mutate(connectionsKey);
            }
        } catch (error) {
            console.error("Disconnect error", error);
        } finally {
            setDisconnectingId(null);
        }
    };

    const handleCreateDestination = async () => {
        setIsProcessing(true);

        try {
            const res = await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    name: "Google Sheets™",
                    type: "destination",
                    provider: "google_sheets",
                    credentials: JSON.stringify({ spreadsheetId: "target_spreadsheet" })
                })
            });

            if (res.ok) {
                // Invalidate cache first just in case
                if (connectionsKey) await mutate(connectionsKey);
                // Initiate real Google OAuth flow to grant permissions
                signIn('google', { callbackUrl: '/destinations?connected=true' }, { prompt: 'consent select_account' });
            } else {
                console.error("Failed to save connection to database");
                setIsProcessing(false);
            }
        } catch (error) {
            console.error("Network error:", error);
            setIsProcessing(false);
        }
    };

    const handleClose = () => {
        if (!isProcessing) {
            if (destinationId === "gsheets" && step === 3) {
                trackEvent("destination_sheets_flow_completed", { workspaceId: activeWorkspaceId });
            }
            onClose();
            setTimeout(() => {
                setStep(1);
            }, 300);
        }
    };

    const overlay = (
        <div
            className={cn(
                "fixed inset-0 z-[100] flex justify-end bg-slate-950/60 backdrop-blur-sm dark:bg-slate-950/80",
                "transition-opacity duration-200 ease-out",
                isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
            role="presentation"
            onClick={() => {
                if (!isProcessing) handleClose();
            }}
        >
            <div
                className={cn(
                    "relative flex h-full w-full max-w-md flex-col overflow-hidden rounded-l-2xl border-l border-gray-200 bg-white shadow-[-22px_0_56px_-14px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-slate-900",
                    "transition-transform duration-[360ms]",
                    isVisible ? "translate-x-0" : "translate-x-full"
                )}
                style={{ transitionTimingFunction: PANEL_EASE }}
                onClick={(e) => e.stopPropagation()}
            >

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
                    <IntegrationMark
                        src={destinationId === 'looker' ? INTEGRATION_LOGOS.looker : INTEGRATION_LOGOS.googleSheets}
                        alt={destinationId === 'looker' ? 'Looker Studio' : 'Google Sheets™'}
                        size="md"
                    />
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                            {destinationId === 'looker' ? 'Looker Studio™' : 'Google Sheets™'}
                        </h3>
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                            {isListView
                                ? `${activeConnections.length} account${activeConnections.length !== 1 ? 's' : ''} connected`
                                : destinationId === 'looker'
                                  ? 'Native data bridge — no sync needed'
                                  : 'Authorize access'}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        aria-label="Close"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50 shrink-0"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body content */}
                {destinationId === "looker" ? (
                    <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                        <div className="mb-4 text-center">
                            <h4 className="mb-2 text-xl font-bold text-ink">Native Looker Integration</h4>
                            <p className="text-sm text-ink-mute">
                                Monstera Cloud acts as a data bridge for Looker Studio. Looker pulls metrics from Monstera using your workspace API key below.
                            </p>
                        </div>
                        <div className="space-y-4 rounded-xl border border-line bg-panel p-5">
                            <div>
                                <label className="mb-1.5 flex items-center text-sm font-semibold text-ink">
                                    <Lock className="mr-2 h-4 w-4 text-ink-mute" />
                                    Your Workspace API Key
                                </label>
                                <p className="mb-2 text-xs text-ink-mute">
                                    The full key is never shown here after creation. Open{" "}
                                    <Link
                                        href="/settings?tab=api"
                                        className="font-semibold text-ink underline underline-offset-2 hover:text-ink-mute"
                                    >
                                        Settings → API
                                    </Link>{" "}
                                    to generate a key and copy it once, then paste it into the Looker Studio connector.
                                </p>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                    <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel shadow-sm">
                                        <input
                                            type="text"
                                            readOnly
                                            value={
                                                hasApiKey
                                                    ? apiKeyMasked
                                                    : "No key yet — generate one in Settings → API"
                                            }
                                            className="w-full min-w-0 bg-transparent px-3 py-2 text-sm text-gray-600 focus:outline-none dark:text-gray-300"
                                        />
                                    </div>
                                    <Link
                                        href="/settings?tab=api"
                                        onClick={() =>
                                            trackEvent("looker_open_api_settings", { workspaceId: activeWorkspaceId })
                                        }
                                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-ring/30 bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                                    >
                                        <Settings2 className="h-4 w-4" />
                                        {hasApiKey ? "Open API keys" : "Create API key"}
                                    </Link>
                                </div>
                            </div>
                        </div>

                        <div className="text-center">
                            <Link
                                href={DESTINATION_HELP_PATHS.lookerStudio}
                                onClick={() =>
                                    trackEvent("destination_help_link_click", {
                                        variant: "looker",
                                        href: DESTINATION_HELP_PATHS.lookerStudio,
                                    })
                                }
                                className="inline-flex items-center text-xs font-semibold text-white hover:text-neutral-300 transition-colors"
                            >
                                Looker Studio connector guide <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Link>
                        </div>
                    </div>
                ) : isListView ? (
                    <div className="flex-1 space-y-3 overflow-y-auto px-6 py-6">
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {activeConnections.map((conn: any) => (
                                <div
                                    key={conn.id}
                                    className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-3"
                                >
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-white" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-ink truncate">{conn.name}</p>
                                        <p className="text-[10px] text-ink-mute">Active · syncing</p>
                                    </div>
                                    <button
                                        onClick={() => handleDisconnect(conn.id, conn.name)}
                                        disabled={disconnectingId === conn.id}
                                        className="shrink-0 text-xs text-ink-mute hover:text-red-400 transition-colors disabled:opacity-50 px-1 py-0.5"
                                        title="Remove account"
                                    >
                                        {disconnectingId === conn.id
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : 'Remove'
                                        }
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={() => setForceSetup(true)}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-panel py-2.5 text-xs font-semibold text-ink hover:bg-white/[0.06] transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            Add Another Account
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Progress Bar */}
                        <div className="h-1 w-full bg-canvas border-b border-line flex">
                            <div className={`h-full bg-white transition-all duration-500 ${step === 1 ? 'w-1/3' : step === 2 ? 'w-2/3' : 'w-full'}`} />
                        </div>

                        <div className="flex-1 overflow-y-auto px-6 py-6">
                            {step === 1 && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="text-center mb-6">
                                        <h4 className="text-lg font-bold text-ink mb-1">Sign in with Google</h4>
                                        <p className="text-ink-mute text-xs">Monstera Cloud needs permission to create and manage spreadsheets in your Google Drive.</p>
                                    </div>

                                    <div className="bg-canvas rounded-lg p-5 border border-line space-y-3">
                                        <p className="font-semibold text-ink text-xs flex items-center">
                                            <Lock className="w-3.5 h-3.5 text-white mr-2" />
                                            Required Permissions:
                                        </p>
                                        <ul className="space-y-2 text-xs text-ink-mute ml-6">
                                            <li className="flex items-start"><CheckCircle2 className="w-3.5 h-3.5 text-white mr-2 shrink-0 mt-0.5" /> Create new spreadsheets</li>
                                            <li className="flex items-start"><CheckCircle2 className="w-3.5 h-3.5 text-white mr-2 shrink-0 mt-0.5" /> Edit spreadsheets created by Monstera</li>
                                        </ul>
                                        <p className="text-[10px] text-ink-mute mt-4 italic">* Monstera Cloud cannot read or delete spreadsheets it did not create.</p>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="mb-4">
                                        <h4 className="text-base font-bold text-ink mb-1">Destination Settings</h4>
                                        <p className="text-ink-mute text-xs">Configure how data will be written to your spreadsheet.</p>
                                    </div>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-medium text-ink mb-1.5 border-none">Spreadsheet Name</label>
                                            <input
                                                type="text"
                                                defaultValue="Monstera Cloud Sync: User Data"
                                                className="w-full bg-canvas border border-line text-ink text-xs rounded-md focus:ring-1 focus:ring-white focus:border-white block p-2.5 shadow-xs"
                                            />
                                            <p className="text-[10px] text-ink-mute mt-1.5">If a sheet with this name exists, data will be written to a new tab.</p>
                                        </div>

                                        <div className="p-4 bg-canvas rounded-lg border border-line">
                                            <label className="block text-xs font-medium text-ink mb-2 flex items-center">
                                                <Settings2 className="w-3.5 h-3.5 mr-1.5 text-ink-mute" /> Write Mode
                                            </label>
                                            <div className="space-y-2">
                                                <label className="flex items-center space-x-3 cursor-pointer">
                                                    <input type="radio" name="writemode" className="accent-white w-4 h-4" defaultChecked />
                                                    <span className="text-xs text-ink font-medium">Append (Add new rows only)</span>
                                                </label>
                                                <label className="flex items-center space-x-3 cursor-pointer">
                                                    <input type="radio" name="writemode" className="accent-white w-4 h-4" />
                                                    <span className="text-xs text-ink-mute">Upsert (Update existing, add new)</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="flex flex-col items-center space-y-6 py-6 animate-in zoom-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-panel text-white">
                                        <FileSpreadsheet className="h-8 w-8" />
                                    </div>
                                    <div className="text-center">
                                        <h4 className="mb-2 text-xl font-bold text-ink">Destination linked</h4>
                                        <p className="mx-auto max-w-md text-xs text-ink-mute">
                                            Google Sheets is ready to receive data from your pipelines. Follow the steps below to install the add-on and run your first sync.
                                        </p>
                                    </div>
                                    <div className="mt-4 flex w-full flex-col gap-4">
                                        <button
                                            onClick={handleClose}
                                            className="flex h-12 w-full items-center justify-center rounded-md bg-white text-black font-semibold text-xs transition-colors hover:bg-neutral-200 shadow-xs"
                                        >
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                            Complete Setup & Close
                                        </button>
                                        <a
                                            href={DESTINATION_HELP_PATHS.docs}
                                            className="text-center text-xs font-medium text-ink-mute underline underline-offset-2 transition-colors hover:text-white"
                                        >
                                            Looking for the Google Sheets Add-on?
                                        </a>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* Footer actions for non-looker */}
                        <div className="px-6 py-4 border-t border-line flex justify-end gap-3">
                            {step < 3 && (
                                <button
                                    onClick={() => {
                                        if (forceSetup && activeConnections.length > 0) {
                                            setForceSetup(false);
                                        } else {
                                            handleClose();
                                        }
                                    }}
                                    disabled={isProcessing}
                                    className="px-4 py-2 text-xs font-medium text-ink-mute hover:text-white transition-colors disabled:opacity-50"
                                >
                                    {forceSetup && activeConnections.length > 0 ? "Back" : "Cancel"}
                                </button>
                            )}

                            {step === 1 && (
                                <button
                                    onClick={handleAuthenticate}
                                    disabled={isProcessing}
                                    className="px-4 py-2 text-xs font-semibold text-black bg-white rounded-md hover:bg-neutral-200 transition-colors disabled:opacity-70 flex items-center shadow-xs"
                                >
                                    {isProcessing ? (
                                        <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Authenticating...</>
                                    ) : (
                                        <>Continue configuration <ChevronRight className="w-3.5 h-3.5 ml-1" /></>
                                    )}
                                </button>
                            )}

                            {step === 2 && (
                                <button
                                    onClick={handleCreateDestination}
                                    disabled={isProcessing}
                                    className="px-4 py-2 text-xs font-semibold text-black bg-white rounded-md hover:bg-neutral-200 transition-colors disabled:opacity-70 flex items-center shadow-xs"
                                >
                                    {isProcessing ? (
                                        <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Saving...</>
                                    ) : (
                                        <>Save & Authorize Google <CheckCircle2 className="w-3.5 h-3.5 ml-2" /></>
                                    )}
                                </button>
                            )}

                            {step === 3 && (
                                <button
                                    onClick={handleClose}
                                    className="w-full px-5 py-3 text-sm font-bold text-white bg-gray-900 dark:bg-slate-800 rounded-xl hover:bg-black transition-all shadow-sm"
                                >
                                    Close
                                </button>
                            )}
                        </div>
                    </>
                )}

            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
