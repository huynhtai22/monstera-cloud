"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { X, Loader2, CheckCircle2, ChevronRight, Settings2, Clock, Database, Globe } from 'lucide-react';
import { useSWRConfig } from 'swr';
import { useWorkspaceStore } from '@/store/workspace';

interface ConnectSourceModalProps {
    isOpen: boolean;
    onClose: () => void;
    integration: {
        id: string;
        name: string;
        logoSrc: string;
        description: string;
    } | null;
}

export function ConnectSourceModal({ isOpen, onClose, integration }: ConnectSourceModalProps) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [isProcessing, setIsProcessing] = useState(false);

    // Default to Shopee if null, though dashboard should always pass one
    const id = integration?.id || 'shopee';
    const name = integration?.name || 'Shopee';
    const logoSrc = integration?.logoSrc || '/logos/shopee.svg';

    // Hooks for network invalidation and global state
    const { mutate } = useSWRConfig();
    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);

    if (!isOpen) return null;

    const handleAuthenticate = () => {
        setIsProcessing(true);

        // Calculate OAuth URL based on provider
        let authUrl = "";
        if (id === 'shopee') {
            // This would normally come from an API or lib
            authUrl = `https://partner.shopeemobile.com/api/v2/shop/auth_partner?partner_id=${process.env.NEXT_PUBLIC_SHOPEE_PARTNER_ID}&redirect=https://monsteracloud.com/api/auth/shopee/callback&state=${activeWorkspaceId}`;
        } else if (id === 'tiktok') {
            if (!activeWorkspaceId) {
                setIsProcessing(false);
                alert('Select a workspace first');
                return;
            }
            // Server builds authorize URL (app key stays server-side only)
            window.location.href = `/api/auth/tiktok/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        }

        // Shopee / others: redirect when authUrl is set
        if (authUrl) {
            window.location.href = authUrl;
            return;
        }

        setTimeout(() => {
            setIsProcessing(false);
            setStep(2);
        }, 1500);
    };

    const handleCreatePipeline = async () => {
        setIsProcessing(true);

        try {
            const res = await fetch('/api/connections', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspaceId: activeWorkspaceId,
                    name: `${name} (${id === 'shopee' ? 'SG' : 'Global'})`,
                    type: "source",
                    provider: id,
                    credentials: JSON.stringify({ shopId: id === 'shopee' ? "49281" : "742109" })
                })
            });

            if (res.ok) {
                // Invalidate SWR cache so the Dashboard automatically re-fetches
                await mutate('/api/workspaces');
                setStep(3); // Move to Success
            } else {
                console.error("Failed to save connection to database");
            }
        } catch (error) {
            console.error("Network error:", error);
        } finally {
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
                            <Image src={logoSrc} alt={name} width={20} height={20} className="object-contain" />
                        </div>
                        <h3 className="font-bold text-gray-900 dark:text-white">Connect {name}</h3>
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
                                <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Authorize Access</h4>
                                <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">You need to authenticate via {name}&apos;s Open Platform to grant Monstera Cloud read-only access to your data.</p>
                            </div>

                            <div className="bg-blue-50/50 rounded-xl p-5 border border-blue-100 space-y-3">
                                <p className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                                    <Globe className="w-4 h-4 text-blue-600 mr-2" />
                                    Permissions Requested:
                                </p>
                                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300 dark:text-gray-600 ml-6">
                                    <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2 shrink-0 mt-0.5" /> Read daily orders & fulfillment status</li>
                                    <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2 shrink-0 mt-0.5" /> Read product inventory & variants</li>
                                    <li className="flex items-start"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2 shrink-0 mt-0.5" /> Read financial and payout data</li>
                                </ul>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 italic">* Monstera Cloud will never modify your live store data.</p>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="mb-4">
                                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Configure Pipeline</h4>
                                <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">Define how data should be ingested from {name}.</p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5 border-none">Select {id === 'shopee' ? 'Shop' : 'Store'}</label>
                                    <select className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 shadow-sm">
                                        <option>SuperStore Official (ID: #{id === 'shopee' ? '49281' : '742109'})</option>
                                        <option>SuperStore Outlet (ID: #{id === 'shopee' ? '55910' : '748221'})</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center">
                                        <Clock className="w-4 h-4 mr-1.5 text-gray-400 dark:text-gray-500" /> Sync Frequency
                                    </label>
                                    <select className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 shadow-sm">
                                        <option>Every 1 hour</option>
                                        <option>Every 12 hours</option>
                                        <option>Every 24 hours (Midnight)</option>
                                    </select>
                                </div>

                                <div className="pt-2 border-t border-gray-100 dark:border-slate-700 flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-gray-900 dark:text-white">Historical Sync</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">Fetch past data up to 1 year back.</div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" value="" className="sr-only peer" defaultChecked />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-slate-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white dark:bg-slate-800 after:border-gray-300 dark:border-slate-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in zoom-in slide-in-from-bottom-4 duration-500">
                            <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border-4 border-emerald-100">
                                <CheckCircle2 className="w-10 h-10" />
                            </div>
                            <div className="text-center">
                                <h4 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Pipeline Active!</h4>
                                <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm max-w-xs mx-auto">Your {name} data is now securely flowing into Monstera Cloud. The initial historical sync has begun.</p>
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
                            className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-70 flex items-center shadow-sm"
                        >
                            {isProcessing ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Authenticating...</>
                            ) : (
                                <>Continue to {name} <ChevronRight className="w-4 h-4 ml-1" /></>
                            )}
                        </button>
                    )}

                    {step === 2 && (
                        <button
                            onClick={handleCreatePipeline}
                            disabled={isProcessing}
                            className="px-5 py-2.5 text-sm font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-70 flex items-center shadow-md shadow-emerald-500/20"
                        >
                            {isProcessing ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Provisioning...</>
                            ) : (
                                <>Create Pipeline <Database className="w-4 h-4 ml-2" /></>
                            )}
                        </button>
                    )}

                    {step === 3 && (
                        <button
                            onClick={handleClose}
                            className="w-full px-5 py-3 text-sm font-bold text-white bg-gray-900 dark:bg-slate-800 rounded-xl hover:bg-black transition-all shadow-sm"
                        >
                            Back to Dashboard
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
}
