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
                            <h4 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">Native Looker Integration</h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                Monstera Cloud acts as a data bridge for Looker Studio. Looker pulls metrics from Monstera using your workspace API key below.
                            </p>
                        </div>
                        <div className="space-y-4 rounded-xl border border-cyan-100 bg-cyan-50/50 p-5 dark:border-cyan-900/40 dark:bg-cyan-950/20">
                            <div>
                                <label className="mb-1.5 flex items-center text-sm font-semibold text-gray-900 dark:text-white">
                                    <Lock className="mr-2 h-4 w-4 text-cyan-600" />
                                    Your Workspace API Key
                                </label>
                                <p className="mb-2 text-xs text-gray-500">
                                    The full key is never shown here after creation. Open{" "}
                                    <Link
                                        href="/settings?tab=api"
                                        className="font-semibold text-cyan-700 underline underline-offset-2 hover:text-cyan-800 dark:text-cyan-400 dark:hover:text-cyan-300"
                                    >
                                        Settings → API
                                    </Link>{" "}
                                    to generate a key and copy it once, then paste it into the Looker Studio connector.
                                </p>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                                    <div className="flex min-w-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-slate-600">
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
                                className="inline-flex items-center text-sm font-medium text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
                            >
                                Looker Studio connector guide <ChevronRight className="ml-1 h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                ) : isListView ? (
                    <div className="flex-1 space-y-3 overflow-y-auto px-6 py-6">
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {activeConnections.map((conn: any) => (
                                <div
                                    key={conn.id}
                                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 dark:border-slate-800 dark:bg-slate-800/40 px-4 py-3"
                                >
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{conn.name}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500">Active · syncing</p>
                                    </div>
                                    <button
                                        onClick={() => handleDisconnect(conn.id, conn.name)}
                                        disabled={disconnectingId === conn.id}
                                        className="shrink-0 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50 px-1 py-0.5"
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
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-ring/25 bg-primary-muted py-3 text-sm font-semibold text-slate-800 hover:bg-primary-muted/80 dark:text-slate-100 transition-colors"
                        >
                            <Plus className="h-4 w-4" />
                            Add Another Account
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Progress Bar */}
                        <div className="h-1 w-full bg-gray-100 dark:bg-slate-800 flex">
                            <div className={`h-full bg-cyan-500 transition-all duration-500 ${step === 1 ? 'w-1/3' : step === 2 ? 'w-2/3' : 'w-full'}`} />
                        </div>

                        <div className="flex-1 overflow-y-auto px-6 py-6">
                            {step === 1 && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="text-center mb-6">
                                        <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Sign in with Google</h4>
                                        <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">Monstera Cloud needs permission to create and manage spreadsheets in your Google Drive.</p>
                                    </div>

                                    <div className="bg-cyan-50/50 rounded-xl p-5 border border-cyan-100 space-y-3">
                                        <p className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                                            <Lock className="w-4 h-4 text-cyan-600 mr-2" />
                                            Required Permissions:
                                        </p>
                                        <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300 dark:text-gray-600 ml-6">
                                            <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-cyan-500 mr-2 shrink-0 mt-0.5" /> Create new spreadsheets</li>
                                            <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-cyan-500 mr-2 shrink-0 mt-0.5" /> Edit spreadsheets created by Monstera</li>
                                        </ul>
                                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 italic">* Monstera Cloud cannot read or delete spreadsheets it did not create.</p>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="mb-4">
                                        <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Destination Settings</h4>
                                        <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">Configure how data will be written to your spreadsheet.</p>
                                    </div>

                                    <div className="space-y-5">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5 border-none">Spreadsheet Name</label>
                                            <input
                                                type="text"
                                                defaultValue="Monstera Cloud Sync: User Data"
                                                className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-primary-ring/40 focus:border-primary-ring block p-2.5 shadow-sm"
                                            />
                                            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1.5">If a sheet with this name exists, data will be written to a new tab.</p>
                                        </div>

                                        <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700">
                                            <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2 flex items-center">
                                                <Settings2 className="w-4 h-4 mr-1.5 text-gray-500 dark:text-gray-400 dark:text-gray-500" /> Write Mode
                                            </label>
                                            <div className="space-y-2">
                                                <label className="flex items-center space-x-3 cursor-pointer">
                                                    <input type="radio" name="writemode" className="text-primary focus:ring-primary-ring/40 w-4 h-4" defaultChecked />
                                                    <span className="text-sm text-gray-700 dark:text-slate-300 font-medium">Append (Add new rows only)</span>
                                                </label>
                                                <label className="flex items-center space-x-3 cursor-pointer">
                                                    <input type="radio" name="writemode" className="text-primary focus:ring-primary-ring/40 w-4 h-4" />
                                                    <span className="text-sm text-gray-700 dark:text-slate-300">Upsert (Update existing, add new)</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="flex flex-col items-center space-y-6 py-6 animate-in zoom-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-cyan-100 bg-cyan-50 text-cyan-500 dark:border-cyan-900/50 dark:bg-cyan-950/40">
                                        <FileSpreadsheet className="h-10 w-10" />
                                    </div>
                                    <div className="text-center">
                                        <h4 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">Destination linked</h4>
                                        <p className="mx-auto max-w-md text-sm text-gray-500 dark:text-gray-400">
                                            Google Sheets is ready to receive data from your pipelines. Follow the steps below to install the add-on and run your first sync.
                                        </p>
                                    </div>
                                    <div className="mt-4 flex w-full flex-col gap-4">
                                        <button
                                            onClick={handleClose}
                                            className="group relative flex h-14 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-400 font-bold tracking-wide text-white shadow-[0_8px_30px_rgb(16,185,129,0.3)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgb(16,185,129,0.5)] active:scale-95"
                                        >
                                            <div className="absolute inset-0 bg-white/20 transition-transform -translate-x-full group-hover:translate-x-full duration-700 ease-out" />
                                            <CheckCircle2 className="mr-2 h-6 w-6" />
                                            Complete Setup & Close
                                        </button>
                                        <a
                                            href={DESTINATION_HELP_PATHS.docs}
                                            className="text-center text-xs font-medium text-slate-500 underline underline-offset-2 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                                        >
                                            Looking for the Google Sheets Add-on?
                                        </a>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* Footer actions for non-looker */}
                        <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex justify-end gap-3">
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
                                    className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
                                >
                                    {forceSetup && activeConnections.length > 0 ? "Back" : "Cancel"}
                                </button>
                            )}

                            {step === 1 && (
                                <button
                                    onClick={handleAuthenticate}
                                    disabled={isProcessing}
                                    className="px-5 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-xl hover:bg-primary-hover transition-all disabled:opacity-70 flex items-center shadow-sm"
                                >
                                    {isProcessing ? (
                                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Authenticating...</>
                                    ) : (
                                        <>Continue configuration <ChevronRight className="w-4 h-4 ml-1" /></>
                                    )}
                                </button>
                            )}

                            {step === 2 && (
                                <button
                                    onClick={handleCreateDestination}
                                    disabled={isProcessing}
                                    className="px-5 py-2.5 text-sm font-bold text-primary-foreground bg-primary rounded-xl hover:bg-primary-hover transition-all disabled:opacity-70 flex items-center shadow-md shadow-cyan-500/20"
                                >
                                    {isProcessing ? (
                                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                                    ) : (
                                        <>Save & Authorize Google <CheckCircle2 className="w-4 h-4 ml-2" /></>
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
