"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { X, Loader2, CheckCircle2, ChevronRight, Settings2, FileSpreadsheet, Lock, Globe } from 'lucide-react';
import { useSWRConfig } from 'swr';
import { signIn } from 'next-auth/react';
import { useWorkspaceStore } from '@/store/workspace';

interface ConnectDestinationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ConnectDestinationModal({ isOpen, onClose }: ConnectDestinationModalProps) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [isProcessing, setIsProcessing] = useState(false);

    // Hooks for network invalidation and global state
    const { mutate } = useSWRConfig();
    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);

    if (!isOpen) return null;

    const handleAuthenticate = () => {
        setStep(2); // Move to Configure step
    };

    const handleCreateDestination = async () => {
        setIsProcessing(true);

        try {
            const res = await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    name: "Google Sheets",
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

                {/* Header Sequence */}
                <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between bg-gray-50 dark:bg-slate-800/80">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm relative overflow-hidden">
                            <Image src="/logos/gsheets.svg" alt="Google Sheets" width={20} height={20} className="object-contain" />
                        </div>
                        <h3 className="font-bold text-gray-900 dark:text-white">Connect Google Sheets</h3>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 dark:text-gray-600 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="h-1 w-full bg-gray-100 dark:bg-slate-800 flex">
                    <div className={`h-full bg-emerald-500 transition-all duration-500 ${step === 1 ? 'w-1/3' : step === 2 ? 'w-2/3' : 'w-full'}`} />
                </div>

                {/* Body content */}
                <div className="p-6">
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center mb-6">
                                <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Sign in with Google</h4>
                                <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">Monstera Cloud needs permission to create and manage spreadsheets in your Google Drive.</p>
                            </div>

                            <div className="bg-emerald-50/50 rounded-xl p-5 border border-emerald-100 space-y-3">
                                <p className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                                    <Lock className="w-4 h-4 text-emerald-600 mr-2" />
                                    Required Permissions:
                                </p>
                                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300 dark:text-gray-600 ml-6">
                                    <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2 shrink-0 mt-0.5" /> Create new spreadsheets</li>
                                    <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2 shrink-0 mt-0.5" /> Edit spreadsheets created by Monstera</li>
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
                                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block p-2.5 shadow-sm"
                                    />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1.5">If a sheet with this name exists, data will be written to a new tab.</p>
                                </div>

                                <div className="p-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700">
                                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-2 flex items-center">
                                        <Settings2 className="w-4 h-4 mr-1.5 text-gray-500 dark:text-gray-400 dark:text-gray-500" /> Write Mode
                                    </label>
                                    <div className="space-y-2">
                                        <label className="flex items-center space-x-3 cursor-pointer">
                                            <input type="radio" name="writemode" className="text-emerald-500 focus:ring-emerald-500 w-4 h-4" defaultChecked />
                                            <span className="text-sm text-gray-700 dark:text-slate-300 font-medium">Append (Add new rows only)</span>
                                        </label>
                                        <label className="flex items-center space-x-3 cursor-pointer">
                                            <input type="radio" name="writemode" className="text-emerald-500 focus:ring-emerald-500 w-4 h-4" />
                                            <span className="text-sm text-gray-700 dark:text-slate-300">Upsert (Update existing, add new)</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in zoom-in slide-in-from-bottom-4 duration-500">
                            <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border-4 border-emerald-100">
                                <FileSpreadsheet className="w-10 h-10" />
                            </div>
                            <div className="text-center">
                                <h4 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Destination Linked!</h4>
                                <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm max-w-xs mx-auto">Google Sheets is now ready to receive data. You can map a Data Source to it in the Dashboard.</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-700 flex justify-end space-x-3 bg-gray-50 dark:bg-slate-800/50">
                    {step < 3 && (
                        <button
                            onClick={handleClose}
                            disabled={isProcessing}
                            className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-xl hover:bg-gray-50 dark:bg-slate-800 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    )}

                    {step === 1 && (
                        <button
                            onClick={handleAuthenticate}
                            disabled={isProcessing}
                            className="px-5 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-70 flex items-center shadow-sm"
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
                            className="px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-70 flex items-center shadow-md shadow-emerald-500/20"
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

            </div>
        </div>
    );
}
