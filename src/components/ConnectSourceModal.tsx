"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { X, Loader2, CheckCircle2, ChevronRight, Clock, Database, Globe, Facebook, Copy, Check, Briefcase } from 'lucide-react';
import useSWR, { useSWRConfig } from 'swr';
import { useWorkspaceStore } from '@/store/workspace';
import { INTEGRATION_LOGOS } from '@/lib/integration-logos';

async function integrationsConfigFetcher(url: string) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    return data;
}

const clientFetcher = (url: string) => fetch(url).then(res => res.json());

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
    const [copiedWhich, setCopiedWhich] = useState<null | 'production' | 'session'>(null);
    const [selectedClientId, setSelectedClientId] = useState<string>('');

    // Default to Shopee if null, though console should always pass one
    const id = integration?.id || 'shopee';
    const name = integration?.name || 'Shopee';
    const logoSrc = integration?.logoSrc || INTEGRATION_LOGOS.shopee;

    // Hooks for network invalidation and global state
    const { mutate } = useSWRConfig();
    const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
    const { data: intConfig } = useSWR(isOpen ? '/api/integrations/config' : null, integrationsConfigFetcher);
    const { data: clients } = useSWR(isOpen && activeWorkspaceId ? `/api/clients?workspaceId=${activeWorkspaceId}` : null, clientFetcher);

    const oauthCallbackUrl =
        id === 'meta_ads'
            ? intConfig?.oauthCallbacks?.metaAds
            : id === 'google_ads'
              ? intConfig?.oauthCallbacks?.googleAds
              : undefined;

    /** MonsteraCloud.com — use in Meta / Google developer consoles for production. */
    const productionOauthUrl =
        id === 'meta_ads'
            ? intConfig?.oauthCallbacksProduction?.metaAds
            : id === 'google_ads'
              ? intConfig?.oauthCallbacksProduction?.googleAds
              : undefined;

    const sessionDiffersFromProduction =
        Boolean(
            productionOauthUrl &&
                oauthCallbackUrl &&
                oauthCallbackUrl !== productionOauthUrl
        );

    const step1Content = useMemo(() => {
        if (id === 'meta_ads') {
            return {
                title: 'Sign in with Facebook',
                subtitle:
                    "You'll use your Facebook account to authorize read-only access to Meta Ads (Facebook and Instagram) for reporting in Monstera Cloud.",
                permissions: [
                    'Read ad account structure (campaigns, ad sets, ads)',
                    'Read performance metrics and insights for reporting',
                ],
                footnote: 'We never post to Facebook or change your ads on your behalf.',
            };
        }
        if (id === 'google_ads') {
            return {
                title: 'Sign in with Google',
                subtitle:
                    "You'll use your Google account to authorize read-only access to Google Ads data for reporting in Monstera Cloud.",
                permissions: [
                    'Read accessible Google Ads customer accounts',
                    'Read campaign and performance data for reporting',
                ],
                footnote: 'We never modify your Google Ads campaigns.',
            };
        }
        return {
            title: 'Authorize Access',
            subtitle: `You need to authenticate via ${name}'s Open Platform to grant Monstera Cloud read-only access to your data.`,
            permissions: [
                'Read daily orders & fulfillment status',
                'Read product inventory & variants',
                'Read financial and payout data',
            ],
            footnote: '* Monstera Cloud will never modify your live store data.',
        };
    }, [id, name]);

    /* Focus trap: must be declared before any early return (Rules of Hooks) */
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<Element | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        previousActiveElement.current = document.activeElement;
        const timer = setTimeout(() => {
            dialogRef.current?.focus();
        }, 50);
        return () => {
            clearTimeout(timer);
            if (previousActiveElement.current instanceof HTMLElement) {
                previousActiveElement.current.focus();
            }
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleAuthenticate = () => {
        setIsProcessing(true);

        // Calculate OAuth URL based on provider
        if (id === 'shopee') {
            if (!activeWorkspaceId) {
                setIsProcessing(false);
                alert('Select a workspace first');
                return;
            }
            window.location.href = `/api/auth/shopee/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        } else if (id === 'tiktok_shop') {
            if (!activeWorkspaceId) {
                setIsProcessing(false);
                alert('Select a workspace first');
                return;
            }
            window.location.href = `/api/auth/tiktok/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        } else if (id === 'tiktok_business') {
            if (!activeWorkspaceId) {
                setIsProcessing(false);
                alert('Select a workspace first');
                return;
            }
            window.location.href = `/api/auth/tiktok-business/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        } else if (id === 'meta_ads') {
            if (!activeWorkspaceId) {
                setIsProcessing(false);
                alert('Select a workspace first');
                return;
            }
            window.location.href = `/api/auth/meta-ads/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
            return;
        } else if (id === 'google_ads') {
            if (!activeWorkspaceId) {
                setIsProcessing(false);
                alert('Select a workspace first');
                return;
            }
            window.location.href = `/api/auth/google-ads/authorize?state=${encodeURIComponent(activeWorkspaceId)}`;
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
                    clientId: selectedClientId || null,
                    name: `${name} (${id === 'shopee' ? 'SG' : id === 'tiktok_shop' ? 'Shop' : id === 'tiktok_business' ? 'Business' : 'Global'})`,
                    type: "source",
                    provider: id,
                    credentials: JSON.stringify({
                        shopId: id === 'shopee' ? '49281' : id === 'tiktok_shop' ? 'tiktok_shop_demo' : id === 'tiktok_business' ? 'tiktok_business_demo' : '742109',
                    })
                })
            });

            if (res.ok) {
                // Invalidate SWR cache so the console view re-fetches
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
            setCopiedWhich(null);
            onClose();
            setTimeout(() => {
                setStep(1);
            }, 300);
        }
    };

    const copyOAuthCallback = async (url: string, which: 'production' | 'session') => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedWhich(which);
            setTimeout(() => setCopiedWhich(null), 2000);
        } catch {
            /* ignore */
        }
    };

    /* #4 — Focus trap refs and effect moved above the isOpen guard (Rules of Hooks) */

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape' && !isProcessing) {
            handleClose();
            return;
        }

        // Focus trap
        if (e.key === 'Tab' && dialogRef.current) {
            const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 dark:bg-slate-800/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                ref={dialogRef}
                onKeyDown={handleKeyDown}
                role="dialog"
                aria-modal="true"
                aria-labelledby="connect-source-modal-title"
                tabIndex={-1}
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden relative animate-in zoom-in-95 duration-300 border border-gray-200 dark:border-slate-700 outline-none"
            >

                {/* Header Sequence */}
                <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between bg-gray-50 dark:bg-slate-800/80">
                    <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center shadow-sm relative overflow-hidden">
                            <Image src={logoSrc} alt={name} width={20} height={20} className="object-contain" />
                        </div>
                        <h3 id="connect-source-modal-title" className="font-bold text-gray-900 dark:text-white">Connect {name}</h3>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        aria-label="Close dialog"
                        className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Progress Bar */}
                <div className="px-6 pt-3 pb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <span>
                        Step {step} of 3
                    </span>
                    <span className="text-cyan-600 dark:text-cyan-400">
                        {step === 1 ? "Overview" : step === 2 ? "Account" : "Confirm"}
                    </span>
                </div>
                <div className="h-1 w-full bg-gray-100 dark:bg-slate-800 flex" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={3} aria-label={`Step ${step} of 3`}>
                    <div className={`h-full bg-cyan-500 transition-all duration-500 ${step === 1 ? 'w-1/3' : step === 2 ? 'w-2/3' : 'w-full'}`} />
                </div>

                {/* Body content */}
                <div className="p-6">
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center mb-6">
                                <h4 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{step1Content.title}</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">{step1Content.subtitle}</p>
                            </div>

                            <div
                                className={
                                    id === 'meta_ads'
                                        ? 'bg-[#1877F2]/10 dark:bg-[#1877F2]/15 rounded-xl p-5 border border-[#1877F2]/25 space-y-3'
                                        : id === 'google_ads'
                                          ? 'bg-slate-50 dark:bg-slate-900/50 rounded-xl p-5 border border-slate-200 dark:border-slate-600 space-y-3'
                                          : 'bg-blue-50/50 rounded-xl p-5 border border-blue-100 dark:border-blue-900/40 space-y-3'
                                }
                            >
                                <p className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                                    <Globe
                                        className={`w-4 h-4 mr-2 shrink-0 ${
                                            id === 'meta_ads'
                                                ? 'text-[#1877F2]'
                                                : 'text-blue-600'
                                        }`}
                                    />
                                    Permissions requested
                                </p>
                                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-300 ml-6">
                                    {step1Content.permissions.map((line) => (
                                        <li key={line} className="flex items-start">
                                            <CheckCircle2 className="w-4 h-4 text-cyan-500 mr-2 shrink-0 mt-0.5" />
                                            {line}
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 italic">{step1Content.footnote}</p>
                            </div>

                            {(id === 'meta_ads' || id === 'google_ads') && (
                                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-900/50 p-4 space-y-3">
                                    <div>
                                        <p className="text-xs font-semibold text-gray-800 dark:text-slate-200">
                                            {id === 'meta_ads'
                                                ? 'Meta — Valid OAuth Redirect URI'
                                                : 'Google Cloud — Authorized redirect URI'}
                                        </p>
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mt-1">
                                            Production domain <span className="font-medium text-gray-700 dark:text-slate-300">monsteracloud.com</span> — paste this full URL into your developer console (exact match, including{' '}
                                            <code className="text-gray-700 dark:text-slate-300">https</code>).
                                        </p>
                                    </div>
                                    {productionOauthUrl ? (
                                        <div className="flex gap-2 items-start">
                                            <code className="text-[11px] leading-relaxed break-all flex-1 text-gray-900 dark:text-slate-100 bg-white dark:bg-slate-800 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-600">
                                                {productionOauthUrl}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={() => copyOAuthCallback(productionOauthUrl, 'production')}
                                                className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                                title="Copy production URL"
                                            >
                                                {copiedWhich === 'production' ? (
                                                    <Check className="w-4 h-4 text-cyan-600" aria-hidden />
                                                ) : (
                                                    <Copy className="w-4 h-4" aria-hidden />
                                                )}
                                            </button>
                                        </div>
                                    ) : intConfig ? (
                                        <p className="text-[11px] text-amber-600 dark:text-amber-500">Could not load production callback URL.</p>
                                    ) : (
                                        <p className="text-[11px] text-gray-400 dark:text-gray-500 animate-pulse">Loading…</p>
                                    )}
                                    {sessionDiffersFromProduction && oauthCallbackUrl && (
                                        <div className="pt-2 border-t border-slate-200 dark:border-slate-600 space-y-1.5">
                                            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                This session (local / preview)
                                            </p>
                                            <div className="flex gap-2 items-start">
                                                <code className="text-[11px] leading-relaxed break-all flex-1 text-gray-600 dark:text-slate-400 bg-white/70 dark:bg-slate-800/80 px-2 py-1.5 rounded border border-slate-200 dark:border-slate-600">
                                                    {oauthCallbackUrl}
                                                </code>
                                                <button
                                                    type="button"
                                                    onClick={() => copyOAuthCallback(oauthCallbackUrl, 'session')}
                                                    className="shrink-0 p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-500 hover:bg-slate-50 dark:hover:bg-slate-700 text-[10px] px-2"
                                                >
                                                    {copiedWhich === 'session' ? 'Copied' : 'Copy'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="mb-4">
                                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Configure Pipeline</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm">Define how data should be ingested from {name}.</p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5 flex items-center">
                                        <Briefcase className="w-4 h-4 mr-1.5 text-gray-400 dark:text-gray-500" /> Assign to Client
                                    </label>
                                    <select 
                                        value={selectedClientId}
                                        onChange={(e) => setSelectedClientId(e.target.value)}
                                        className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 shadow-sm"
                                    >
                                        <option value="">No Client (Unassigned)</option>
                                        {Array.isArray(clients) && clients.map((c: any) => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-[10px] text-gray-400 mt-1 italic">Optional: Group this connection for agency reporting.</p>
                                </div>

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
                                        <div className="text-xs text-gray-500 dark:text-gray-400">Fetch past data up to 1 year back.</div>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" value="" className="sr-only peer" defaultChecked />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-slate-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white dark:bg-slate-800 after:border-gray-300 dark:border-slate-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-in zoom-in slide-in-from-bottom-4 duration-500">
                            <div className="w-20 h-20 bg-cyan-50 text-cyan-500 rounded-full flex items-center justify-center border-4 border-cyan-100">
                                <CheckCircle2 className="w-10 h-10" />
                            </div>
                            <div className="text-center">
                                <h4 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Pipeline Active!</h4>
                                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs mx-auto">Your {name} data is now securely flowing into Monstera Cloud. The initial historical sync has begun.</p>
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
                            className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                    )}

                    {step === 1 && id === 'meta_ads' && (
                        <button
                            type="button"
                            onClick={handleAuthenticate}
                            disabled={isProcessing}
                            className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1877F2] rounded-xl hover:bg-[#166FE5] transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm min-w-[200px]"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                    Connecting…
                                </>
                            ) : (
                                <>
                                    <Facebook className="w-5 h-5 shrink-0" strokeWidth={2} aria-hidden />
                                    Continue with Facebook
                                </>
                            )}
                        </button>
                    )}

                    {step === 1 && id === 'google_ads' && (
                        <button
                            type="button"
                            onClick={handleAuthenticate}
                            disabled={isProcessing}
                            className="px-5 py-2.5 text-sm font-semibold text-gray-800 dark:text-gray-100 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all disabled:opacity-70 flex items-center justify-center gap-2 shadow-sm min-w-[200px]"
                        >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                    Connecting…
                                </>
                            ) : (
                                <>
                                    <Image
                                        src={INTEGRATION_LOGOS.googleAds}
                                        alt=""
                                        width={20}
                                        height={20}
                                        className="object-contain shrink-0"
                                    />
                                    Continue with Google
                                </>
                            )}
                        </button>
                    )}

                    {step === 1 && id !== 'meta_ads' && id !== 'google_ads' && (
                        <button
                            type="button"
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
                            className="px-5 py-2.5 text-sm font-bold text-white bg-cyan-600 rounded-xl hover:bg-cyan-700 transition-all disabled:opacity-70 flex items-center shadow-md shadow-cyan-500/20"
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
                            Back to Console
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
}
