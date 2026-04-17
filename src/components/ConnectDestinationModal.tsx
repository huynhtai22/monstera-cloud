"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { X, Loader2, CheckCircle2, ChevronRight, Settings2, FileSpreadsheet, Lock, Globe, Copy, Plus } from 'lucide-react';
import useSWR, { useSWRConfig } from 'swr';
import { signIn } from 'next-auth/react';
import { useWorkspaceStore } from '@/store/workspace';
import { INTEGRATION_LOGOS } from '@/lib/integration-logos';

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
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [isProcessing, setIsProcessing] = useState(false);
    const [copied, setCopied] = useState(false);

    // Hooks for network invalidation and global state
    const { mutate } = useSWRConfig();
    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
    
    const { data: workspaces } = useSWR('/api/workspaces', fetcher);
    
    const workspace = Array.isArray(workspaces) 
        ? (workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0]) 
        : null;

    const activeConnections = React.useMemo(() => {
        if (!workspace?.connections) return [];
        let providerId = destinationId;
        if (destinationId === 'gsheets') providerId = 'google_sheets';
        return workspace.connections.filter((c: any) => c.type === 'destination' && c.provider === providerId);
    }, [workspace, destinationId]);

    const [forceSetup, setForceSetup] = useState(false);
    const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
    
    // Reset internal state when modal closes
    React.useEffect(() => {
        if (!isOpen) { 
            setForceSetup(false); 
            setStep(1); 
        }
    }, [isOpen]);

    const isListView = destinationId !== 'looker' && activeConnections.length > 0 && !forceSetup;
        
    const apiKey = workspace?.apiKeys?.[0]?.key || "Generate an API Key in Workspace Settings";

    if (!isOpen) return null;

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
                await mutate('/api/workspaces');
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
                await mutate('/api/workspaces');
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
            onClose();
            // Reset state after animation
            setTimeout(() => {
                setStep(1);
            }, 300);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 dark:bg-slate-800/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden relative animate-in zoom-in-95 duration-300 border border-gray-200 dark:border-slate-700">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                        <Image
                            src={destinationId === 'looker' ? INTEGRATION_LOGOS.looker : INTEGRATION_LOGOS.googleSheets}
                            alt={destinationId === 'looker' ? 'Looker Studio' : 'Google Sheets™'}
                            width={22}
                            height={22}
                            className="object-contain"
                        />
                    </div>
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
                {destinationId === 'looker' ? (
                    <div className="p-6 space-y-6">
                        <div className="text-center mb-4">
                            <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Native Looker Integration</h4>
                            <p className="text-gray-500 dark:text-gray-400 text-sm">Monstera Cloud acts as a native data bridge for Looker Studio. Data doesn't need to be synced outward—Looker pulls it directly from Monstera!</p>
                        </div>
                        <div className="bg-cyan-50/50 rounded-xl p-5 border border-cyan-100 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-1.5 flex items-center">
                                    <Lock className="w-4 h-4 text-cyan-600 mr-2" />
                                    Your Workspace API Key
                                </label>
                                <p className="text-xs text-gray-500 mb-2">Copy this key and paste it into the Looker Studio connector when prompted.</p>
                                <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                                    <input 
                                        type="password" 
                                        readOnly 
                                        value={apiKey} 
                                        className="w-full px-3 py-2 text-sm text-gray-600 focus:outline-none bg-transparent"
                                    />
                                    <button 
                                        onClick={() => {
                                            navigator.clipboard.writeText(apiKey);
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        }}
                                        className="px-3 border-l border-gray-200 text-cyan-600 hover:bg-cyan-50 flex items-center justify-center transition-colors font-medium text-xs bg-white"
                                    >
                                        {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="text-center">
                             <a 
                                href="https://github.com/monstera/monstera-docs#looker-studio-connector" 
                                target="_blank" 
                                rel="noreferrer"
                                className="inline-flex items-center text-sm text-cyan-600 hover:text-cyan-700 font-medium"
                             >
                                Get the Community Connector Script <ChevronRight className="w-4 h-4 ml-1" />
                             </a>
                         </div>
                    </div>
                ) : isListView ? (
                    <div className="p-6 space-y-3">
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
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50/60 dark:border-cyan-800/50 dark:bg-cyan-950/30 py-3 text-sm font-semibold text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100/50 dark:hover:bg-cyan-950/50 transition-colors"
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

                        <div className="p-6">
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
                                                className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-cyan-500 focus:border-cyan-500 block p-2.5 shadow-sm"
                                            />
                                            <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1.5">If a sheet with this name exists, data will be written to a new tab.</p>
                                        </div>

                                        <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700">
                                            <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2 flex items-center">
                                                <Settings2 className="w-4 h-4 mr-1.5 text-gray-500 dark:text-gray-400 dark:text-gray-500" /> Write Mode
                                            </label>
                                            <div className="space-y-2">
                                                <label className="flex items-center space-x-3 cursor-pointer">
                                                    <input type="radio" name="writemode" className="text-cyan-500 focus:ring-cyan-500 w-4 h-4" defaultChecked />
                                                    <span className="text-sm text-gray-700 dark:text-slate-300 font-medium">Append (Add new rows only)</span>
                                                </label>
                                                <label className="flex items-center space-x-3 cursor-pointer">
                                                    <input type="radio" name="writemode" className="text-cyan-500 focus:ring-cyan-500 w-4 h-4" />
                                                    <span className="text-sm text-gray-700 dark:text-slate-300">Upsert (Update existing, add new)</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === 3 && (
                                <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in zoom-in slide-in-from-bottom-4 duration-500">
                                    <div className="w-20 h-20 bg-cyan-50 text-cyan-500 rounded-full flex items-center justify-center border-4 border-cyan-100">
                                        <FileSpreadsheet className="w-10 h-10" />
                                    </div>
                                    <div className="text-center">
                                        <h4 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Destination Linked!</h4>
                                        <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm max-w-xs mx-auto">Google Sheets™ is now ready to receive data. You can map a Data Source to it in the Console.</p>
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
                                    className="px-5 py-2.5 text-sm font-medium text-white bg-cyan-600 rounded-xl hover:bg-cyan-700 transition-all disabled:opacity-70 flex items-center shadow-sm"
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
                                    className="px-5 py-2.5 text-sm font-bold text-white bg-cyan-600 rounded-xl hover:bg-cyan-700 transition-all disabled:opacity-70 flex items-center shadow-md shadow-cyan-500/20"
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
}
