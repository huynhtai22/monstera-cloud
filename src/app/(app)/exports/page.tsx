"use client";

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Send, ChevronRight, Lock, Settings2, FlaskConical } from "lucide-react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { DESTINATION_HELP_PATHS } from "@/lib/destination-help-urls";
import { trackEvent } from "@/lib/analytics-events";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to fetch data');
    return data;
};

export default function ExportsPage() {
    const { activeWorkspaceId } = useWorkspaceStore();
    const { data: apiKeys = [] } = useSWR(
        activeWorkspaceId ? `/api/settings/api-keys?workspaceId=${activeWorkspaceId}` : null,
        fetcher,
    );

    const firstKey = Array.isArray(apiKeys) ? apiKeys[0] as { keyMasked?: string } | undefined : undefined;
    const apiKeyMasked = firstKey?.keyMasked ?? "";
    const hasApiKey = Boolean(firstKey);

    return (
        <div className="relative w-full max-w-5xl mx-auto px-6 py-8 sm:px-10 sm:py-10 animate-in fade-in duration-300">

            {/* Header */}
            <div className="relative z-10 mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center border-b border-gray-200 dark:border-[#2f3336] pb-6">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-600 shadow-sm dark:border-cyan-900/50 dark:bg-cyan-950/40 dark:text-cyan-400">
                        <Send className="h-6 w-6" aria-hidden />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Exports & Connectors</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Pull data from your Monstera Cloud warehouse directly into your reporting tools.
                        </p>
                    </div>
                </div>
            </div>

            {/* Distribution Model Comparison Banner */}
            <div className="mb-8 rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 to-cyan-50/40 p-5 dark:border-[#2f3336] dark:from-[#16181c] dark:to-[#16181c]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="rounded-xl border border-white/80 bg-white/80 p-4 shadow-sm dark:border-white/5 dark:bg-black/40">
                        <div className="flex items-center gap-2 font-bold text-cyan-700 dark:text-cyan-400 mb-1">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-100 dark:bg-cyan-950/60 text-[10px]">A</span>
                            On-Demand Connectors (Type A)
                        </div>
                        <p className="text-gray-600 dark:text-gray-300">
                            Query warehouse metrics directly within <strong>Google Sheets™ Add-on</strong> or <strong>Looker Studio™</strong> on demand using your Workspace API key. No server destination configuration required.
                        </p>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white/80 p-4 shadow-sm dark:border-white/5 dark:bg-black/40">
                        <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200 mb-1">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 text-[10px]">B</span>
                            Scheduled Background Push (Type B)
                        </div>
                        <p className="text-gray-600 dark:text-gray-300">
                            Automate scheduled data refreshes (daily / every 4 hours) writing directly into your destination Google Sheet tabs even when no user has the spreadsheet open.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Google Sheets Card */}
                <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-[#2f3336] dark:bg-[#16181c]/50">
                    <div className="p-6">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-2 shadow-sm dark:border-[#2f3336] dark:bg-white">
                                <Image src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" width={32} height={32} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Google Sheets Add-on</h2>
                                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center">
                                    <FlaskConical className="w-4 h-4 mr-1" /> Private beta
                                </p>
                            </div>
                        </div>
                        
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 min-h-[40px]">
                            Install the official Monstera Cloud add-on to pull live metrics, campaign data, and cross-platform reports directly into your spreadsheets.
                        </p>

                        <div className="space-y-3 mb-8">
                            <div className="flex items-start gap-3">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-[#1d1f23] dark:text-gray-300">1</div>
                                <p className="text-sm text-gray-600 dark:text-gray-300">Ask your pilot operator for the private add-on installation link.</p>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-[#1d1f23] dark:text-gray-300">2</div>
                                <p className="text-sm text-gray-600 dark:text-gray-300">Open a spreadsheet and click <strong>Extensions → Monstera Cloud → Launch</strong>.</p>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600 dark:bg-[#1d1f23] dark:text-gray-300">3</div>
                                <p className="text-sm text-gray-600 dark:text-gray-300">Sign in with your Monstera Cloud account and start pulling data.</p>
                            </div>
                        </div>

                        <Link
                            href={DESTINATION_HELP_PATHS.docs}
                            className="inline-flex w-full items-center justify-center rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
                        >
                            View pilot setup guide <ChevronRight className="ml-2 h-4 w-4" />
                        </Link>
                    </div>
                </div>

                {/* Looker Studio Card */}
                <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-md dark:border-[#2f3336] dark:bg-[#16181c]/50">
                    <div className="p-6">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-2 shadow-sm dark:border-[#2f3336] dark:bg-white">
                                <Image src={INTEGRATION_LOGOS.looker} alt="Looker Studio" width={32} height={32} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Looker Studio Connector</h2>
                                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center">
                                    <FlaskConical className="w-4 h-4 mr-1" /> Private beta
                                </p>
                            </div>
                        </div>
                        
                        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6 min-h-[40px]">
                            Connect Looker Studio to Monstera Cloud using your Workspace API Key to build powerful, automated marketing dashboards.
                        </p>

                        <div className="rounded-xl border border-cyan-100 bg-cyan-50/50 p-4 mb-6 dark:border-cyan-900/40 dark:bg-cyan-950/20">
                            <label className="mb-2 flex items-center text-sm font-semibold text-gray-900 dark:text-white">
                                <Lock className="mr-2 h-4 w-4 text-cyan-600" />
                                Workspace API Key
                            </label>
                            
                            <div className="flex items-center gap-2 mb-2">
                                <div className="flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-[#2f3336] dark:bg-[#000000]">
                                    <input
                                        type="text"
                                        readOnly
                                        value={hasApiKey ? apiKeyMasked : "No key generated yet"}
                                        className="w-full bg-transparent px-3 py-2 text-sm text-gray-600 focus:outline-none dark:text-gray-300 cursor-default"
                                    />
                                </div>
                            </div>
                            
                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                                Generate or copy your actual API key from the Settings page.
                            </p>

                            <Link
                                href="/settings?tab=api"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-[#2f3336] dark:bg-[#16181c] dark:text-gray-200 dark:hover:bg-[#1d1f23]"
                            >
                                <Settings2 className="h-4 w-4" />
                                Manage API Keys
                            </Link>
                        </div>

                        <Link
                            href={DESTINATION_HELP_PATHS.lookerStudio}
                            onClick={() => trackEvent("destination_help_link_click", { variant: "looker" })}
                            className="inline-flex w-full items-center justify-center rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-cyan-700"
                        >
                            View Looker Integration Guide <ChevronRight className="ml-2 h-4 w-4" />
                        </Link>
                    </div>
                </div>

            </div>
        </div>
    );
}
