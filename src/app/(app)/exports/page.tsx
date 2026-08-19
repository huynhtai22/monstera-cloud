"use client";

import React from 'react';
import Link from 'next/link';
import { Send, ChevronRight, Lock, Settings2, FlaskConical } from "lucide-react";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
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
            <div className="relative z-10 mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center border-b border-line pb-6">
                <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-white shadow-xs">
                        <Send className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-ink">Exports & Connectors</h1>
                        <p className="text-xs text-ink-mute mt-1">
                            Pull data from your Monstera Cloud warehouse directly into your reporting tools.
                        </p>
                    </div>
                </div>
            </div>

            {/* Delivery Methods Banner */}
            <div className="mb-8 rounded-lg border border-line bg-panel p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="rounded-md border border-line bg-canvas p-4 shadow-xs">
                        <div className="flex items-center gap-2 font-bold text-white mb-1">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-black text-[10px] font-bold">✓</span>
                            On-Demand Data Pull (Available in Pilot)
                        </div>
                        <p className="text-xs text-ink-mute">
                            Query warehouse metrics directly within <strong>Google Sheets™ Add-on</strong> or <strong>Looker Studio™</strong> on demand using your Workspace API key.
                        </p>
                    </div>
                    <div className="rounded-md border border-line bg-canvas p-4 shadow-xs">
                        <div className="flex items-center gap-2 font-bold text-ink mb-1">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-line bg-panel text-ink-mute text-[10px]">⏱</span>
                            Scheduled Spreadsheet Delivery (Coming Soon)
                        </div>
                        <p className="text-xs text-ink-mute">
                            Automated background push to Google Sheets is not active during the pilot program. Use the Google Sheets Add-on or Looker Studio connector for live data pulls.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Google Sheets Card */}
                <div className="relative overflow-hidden rounded-lg border border-line bg-panel shadow-xs transition-colors hover:border-white/30">
                    <div className="p-6">
                        <div className="flex items-center gap-4 mb-4">
                            <IntegrationMark src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" size="lg" />
                            <div>
                                <h2 className="text-base font-bold text-ink">Google Sheets Add-on</h2>
                                <p className="text-xs font-medium text-ink-mute flex items-center mt-0.5">
                                    <FlaskConical className="w-3.5 h-3.5 mr-1" /> Private beta
                                </p>
                            </div>
                        </div>
                        
                        <p className="text-xs text-ink-mute mb-6 min-h-[36px]">
                            Install the official Monstera Cloud add-on to pull live metrics, campaign data, and cross-platform reports directly into your spreadsheets.
                        </p>

                        <div className="space-y-3 mb-8">
                            <div className="flex items-start gap-3">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-[11px] font-bold text-ink">1</div>
                                <p className="text-xs text-ink-mute">Ask your pilot operator for the private add-on installation link.</p>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-[11px] font-bold text-ink">2</div>
                                <p className="text-xs text-ink-mute">Open a spreadsheet and click <strong>Extensions → Monstera Cloud → Launch</strong>.</p>
                            </div>
                            <div className="flex items-start gap-3">
                                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-[11px] font-bold text-ink">3</div>
                                <p className="text-xs text-ink-mute">Sign in with your Monstera Cloud account and start pulling data.</p>
                            </div>
                        </div>

                        <Link
                            href={DESTINATION_HELP_PATHS.docs}
                            className="inline-flex w-full items-center justify-center rounded-md border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-ink shadow-xs transition-colors hover:bg-white/[0.06]"
                        >
                            View pilot setup guide <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                    </div>
                </div>

                {/* Looker Studio Card */}
                <div className="relative overflow-hidden rounded-lg border border-line bg-panel shadow-xs transition-colors hover:border-white/30">
                    <div className="p-6">
                        <div className="flex items-center gap-4 mb-4">
                            <IntegrationMark src={INTEGRATION_LOGOS.looker} alt="Looker Studio" size="lg" />
                            <div>
                                <h2 className="text-base font-bold text-ink">Looker Studio Connector</h2>
                                <p className="text-xs font-medium text-ink-mute flex items-center mt-0.5">
                                    <FlaskConical className="w-3.5 h-3.5 mr-1" /> Private beta
                                </p>
                            </div>
                        </div>
                        
                        <p className="text-xs text-ink-mute mb-6 min-h-[36px]">
                            Connect Looker Studio to Monstera Cloud using your Workspace API Key to build powerful, automated marketing dashboards.
                        </p>

                        <div className="rounded-lg border border-line bg-canvas p-4 mb-6">
                            <label className="mb-2 flex items-center text-xs font-semibold text-ink">
                                <Lock className="mr-2 h-3.5 w-3.5 text-white" />
                                Workspace API Key
                            </label>
                            
                            <div className="flex items-center gap-2 mb-2">
                                <div className="flex-1 overflow-hidden rounded-md border border-line bg-panel">
                                    <input
                                        type="text"
                                        readOnly
                                        value={hasApiKey ? apiKeyMasked : "No key generated yet"}
                                        className="w-full bg-transparent px-3 py-1.5 text-xs text-ink focus:outline-none cursor-default font-mono"
                                    />
                                </div>
                            </div>
                            
                            <p className="text-[11px] text-ink-mute mb-3">
                                Generate or copy your actual API key from the Settings page.
                            </p>

                            <Link
                                href="/settings?tab=api"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-panel px-4 py-2 text-xs font-semibold text-ink shadow-xs transition-colors hover:bg-white/[0.06]"
                            >
                                <Settings2 className="h-3.5 w-3.5" />
                                Manage API Keys
                            </Link>
                        </div>

                        <Link
                            href={DESTINATION_HELP_PATHS.lookerStudio}
                            onClick={() => trackEvent("destination_help_link_click", { variant: "looker" })}
                            className="inline-flex w-full items-center justify-center rounded-md bg-white px-4 py-2.5 text-xs font-semibold text-black shadow-xs transition-colors hover:bg-neutral-200"
                        >
                            View Looker Integration Guide <ChevronRight className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                    </div>
                </div>

            </div>
        </div>
    );
}
