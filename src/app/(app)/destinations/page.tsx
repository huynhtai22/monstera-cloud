"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Search, ArrowRight, Send, Plus, AlertCircle, Loader2, Unplug } from "lucide-react";
import { ConnectDestinationModal } from "@/components/ConnectDestinationModal";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import useSWR, { useSWRConfig } from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err: any = new Error(data.error || 'Failed to fetch data');
        err.status = res.status;
        throw err;
    }
    return data;
};

const availableDestinations = [
    { id: 'gsheets', name: 'Google Sheets', description: 'Export data directly to spreadsheets.', status: 'available', logoSrc: INTEGRATION_LOGOS.googleSheets },
    { id: 'looker', name: 'Looker Studio', description: 'Visualize data in custom reports.', status: 'available', logoSrc: INTEGRATION_LOGOS.looker },
    { id: 'slack', name: 'Slack Alerts', description: 'Get daily summary notifications.', status: 'available', logoSrc: INTEGRATION_LOGOS.slack },
];

export default function DestinationsPage() {
    const [setupDestinationId, setSetupDestinationId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    const { mutate } = useSWRConfig();
    const { activeWorkspaceId } = useWorkspaceStore();


    // Fetch Data
    const { data: workspaces, error, isLoading } = useSWR("/api/workspaces", fetcher);

    // Filter logic
    const filteredDestinations = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return availableDestinations;

        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        const workspaceConnections = workspace?.connections?.filter((c: any) => c.type === 'destination') || [];

        const unifiedList = availableDestinations.map((dest) => {
            // Map the internal provider id string
            let providerId = dest.id;
            if (dest.id === 'gsheets') providerId = 'google_sheets';
            else if (dest.id === 'looker') providerId = 'looker_studio';

            const activeConnections = workspaceConnections.filter((c: any) => c.provider === providerId);

            return {
                ...dest,
                connections: activeConnections,
                status: activeConnections.length > 0 ? 'connected' : 'available'
            };
        });

        return unifiedList.filter((dest: any) => {
            const matchesSearch = dest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                dest.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'warehouses') return ['Google BigQuery', 'PostgreSQL'].includes(dest.name);
            if (activeFilter === 'spreadsheets') return ['Google Sheets'].includes(dest.name);
            return true;
        });
    }, [searchQuery, activeFilter, workspaces, activeWorkspaceId]);

    // On a 401 the session has expired — redirect to login silently instead of
    // crashing the page. For any other API error, show a non-blocking banner so
    // the static destination cards are still visible and usable.
    if (error) {
        const is401 = error?.message?.includes("401") || error?.status === 401;
        if (is401 && typeof window !== "undefined") {
            window.location.href = "/login";
            return null;
        }
    }

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Subtle Liquid Mesh Background underlay */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[10%] left-[30%] w-[40%] h-[50%] rounded-full bg-blue-200/20 dark:bg-blue-900/20 blur-[120px]" />
                <div className="absolute top-[40%] right-[10%] w-[30%] h-[60%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
            </div>

            {/* Header */}
            <div className="relative z-10 mb-10 flex flex-col justify-between space-y-4 sm:flex-row sm:items-start sm:space-y-0">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        <Send className="h-5 w-5" aria-hidden />
                    </div>
                    <div>
                        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
                            Destinations
                        </h1>
                        <p className="max-w-2xl text-base text-gray-600 dark:text-gray-400">
                            Choose where Monstera Cloud should send your clean, transformed data.
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 space-x-3 sm:pt-1">
                    <PrimaryButton
                        type="button"
                        onClick={() => setSetupDestinationId('gsheets')}
                        className="flex items-center gap-2"
                    >
                        <Plus className="h-4 w-4" />
                        Add Destination
                    </PrimaryButton>
                </div>
            </div>

            {/* Active Pipelines Info Bar */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 rounded-xl p-4 mb-8 flex items-center justify-between shadow-sm">
                <div className="flex items-center space-x-3 text-blue-800 dark:text-blue-300">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/50 rounded-lg shrink-0">
                        <Send className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="font-semibold text-sm">Active Data Pipelines</p>
                        <p className="text-xs text-blue-600/80 dark:text-blue-400/80">You currently have 0 active pipelines sending data outward.</p>
                    </div>
                </div>
            </div>

            {/* Search and Filter */}
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-8">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search destinations..."
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-white dark:bg-slate-800 shadow-sm"
                    />
                </div>
                <div className="flex space-x-2">
                    <button
                        onClick={() => setActiveFilter('all')}
                        className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm transition-colors ${activeFilter === 'all' ? 'bg-gray-900 dark:bg-slate-800 text-white cursor-default' : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:bg-slate-800'}`}>
                        All Destinations
                    </button>
                    <button
                        onClick={() => setActiveFilter('warehouses')}
                        className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm transition-colors ${activeFilter === 'warehouses' ? 'bg-gray-900 dark:bg-slate-800 text-white cursor-default' : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:bg-slate-800'}`}>
                        Warehouses
                    </button>
                    <button
                        onClick={() => setActiveFilter('spreadsheets')}
                        className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm transition-colors ${activeFilter === 'spreadsheets' ? 'bg-gray-900 dark:bg-slate-800 text-white cursor-default' : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:bg-slate-800'}`}>
                        Spreadsheets
                    </button>
                </div>
            </div>

            {/* Grid */}
            <h2 className="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-4 relative z-10">Available Destinations</h2>

            {isLoading ? (
                <div className="w-full py-20 flex flex-col items-center justify-center text-center relative z-10">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
                    <p className="text-sm font-medium text-gray-500">Loading your destinations...</p>
                </div>
            ) : filteredDestinations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                    {filteredDestinations.map((destination: any) => (
                        <div
                            key={destination.id}
                            className={`relative overflow-hidden bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl rounded-2xl border p-5 transition-all duration-300 group flex flex-col justify-between shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/60 dark:bg-slate-900/60
                            ${destination.status === 'error' ? 'border-red-200/80 hover:border-red-300 cursor-pointer' :
                                    destination.status === 'connected' ? 'border-white dark:border-slate-700/60 dark:border-slate-700/40 hover:border-emerald-200/80 cursor-pointer' :
                                        'border-white dark:border-slate-700/60 dark:border-slate-700/40 hover:border-blue-200/80 cursor-default'}`}
                        >
                            {/* Inner Glass Reflection */}
                            <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                            <div className="flex items-start justify-between mb-3 relative z-10">
                                {/* Logo */}
                                <div className={`relative w-12 h-12 rounded-xl backdrop-blur-md border flex items-center justify-center shrink-0 transition-colors bg-white/50 dark:bg-slate-900/50 overflow-hidden
                                ${destination.status === 'connected' ? 'border-emerald-100/50' :
                                        destination.status === 'error' ? 'border-red-100/50' :
                                            'border-gray-200 dark:border-slate-700/50 grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100'}`}>
                                    <img
                                        src={destination.logoSrc}
                                        alt={`${destination.name} logo`}
                                        width={28}
                                        height={28}
                                        className="object-contain"
                                    />
                                </div>

                                {/* Status Indicator */}
                                {destination.status === 'connected' ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-50/80 text-emerald-700 border border-emerald-100/50 shadow-sm backdrop-blur-sm dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/50">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 dark:bg-emerald-400"></span>
                                        {destination.connections?.length > 1 ? `Connected (${destination.connections.length})` : 'Connected'}
                                    </span>
                                ) : destination.status === 'error' ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-red-50/80 text-red-700 border border-red-100/50 shadow-sm backdrop-blur-sm dark:bg-red-950/40 dark:text-red-400 dark:border-red-900/50">
                                        <AlertCircle className="w-3 h-3 mr-1" />
                                        Error
                                    </span>
                                ) : null}
                            </div>

                            <div className="mb-5 relative z-10">
                                <h3 className="text-gray-900 dark:text-white font-semibold mb-1 group-hover:text-blue-900 transition-colors">{destination.name}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 line-clamp-2">{destination.description}</p>
                            </div>

                            <div className="relative z-10">
                                {destination.status === 'error' ? (
                                    <button className="w-full py-2 bg-red-50/80 backdrop-blur-sm hover:bg-red-100/80 text-red-700 text-sm font-semibold rounded-lg transition-colors border border-red-200/50 shadow-sm">
                                        Fix Connection
                                    </button>
                                ) : destination.status === 'connected' ? (
                                    <button
                                        type="button"
                                        onClick={() => setSetupDestinationId(destination.id)}
                                        className="w-full py-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border border-slate-200 dark:border-slate-700/60 dark:border-slate-700/40 text-slate-700 dark:text-slate-300 dark:text-gray-600 text-sm font-medium rounded-lg transition-colors hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/80 dark:bg-slate-900/80 shadow-sm flex items-center justify-center space-x-1"
                                    >
                                        <span className="w-4 h-4 mr-1.5 opacity-50"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></span>
                                        <span>Manage Accounts</span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setSetupDestinationId(destination.id)}
                                        className="w-full py-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border border-white dark:border-slate-700/60 dark:border-slate-700/40 text-gray-600 dark:text-gray-300 dark:text-gray-600 text-sm font-medium rounded-lg transition-colors hover:border-white dark:border-slate-700 hover:bg-white/80 dark:bg-slate-900/80 shadow-sm flex items-center justify-center space-x-1"
                                    >
                                        <span>Setup</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="w-full py-20 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl bg-gray-50 dark:bg-slate-800/50">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No destinations found</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 max-w-sm mb-6">We couldn't find any destinations matching "{searchQuery}".</p>
                </div>
            )}

            <ConnectDestinationModal
                isOpen={setupDestinationId !== null}
                destinationId={setupDestinationId}
                onClose={() => setSetupDestinationId(null)}
            />
        </div>
    );
}
