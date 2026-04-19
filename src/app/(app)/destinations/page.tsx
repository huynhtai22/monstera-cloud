"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Search, ArrowRight, Send, Plus, Loader2, CheckCircle2, Circle, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectDestinationModal } from "@/components/ConnectDestinationModal";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { DataFlowExplainer } from "@/components/data-flow/DataFlowExplainer";
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

    const { hasConnectedSource, hasConnectedDestination } = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) {
            return { hasConnectedSource: false, hasConnectedDestination: false };
        }
        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        const conns = (workspace?.connections ?? []) as Array<{ type?: string; status?: string }>;
        const hasConnectedSource = conns.some((c) => c.type === "source" && c.status === "connected");
        const hasConnectedDestination = conns.some((c) => c.type === "destination" && c.status === "connected");
        return { hasConnectedSource, hasConnectedDestination };
    }, [workspaces, activeWorkspaceId]);

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
                <div className="absolute top-[40%] right-[10%] w-[30%] h-[60%] rounded-full bg-cyan-200/20 dark:bg-cyan-900/20 blur-[120px]" />
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

            <DataFlowExplainer variant="destinations" />

            {hasConnectedSource && !hasConnectedDestination && !isLoading ? (
                <div className="relative z-10 mb-8 flex flex-col gap-4 rounded-2xl border border-amber-200/90 bg-amber-50/90 p-5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                            <MapPin className="h-5 w-5" aria-hidden />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-amber-950 dark:text-amber-100">You have sources — pick where data should land</p>
                            <p className="mt-1 max-w-xl text-sm text-amber-900/90 dark:text-amber-200/90">
                                Add Google Sheets or Looker Studio so pipelines can deliver rows and dashboards. This is usually a{" "}
                                <strong>different</strong> Google login than TikTok/Meta — that is expected.
                            </p>
                        </div>
                    </div>
                    <PrimaryButton type="button" onClick={() => setSetupDestinationId("gsheets")} className="shrink-0 self-start sm:self-center">
                        Add destination
                    </PrimaryButton>
                </div>
            ) : null}

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
                        className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all bg-white dark:bg-slate-800 shadow-sm"
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
                    <Loader2 className="w-8 h-8 text-cyan-500 animate-spin mb-4" />
                    <p className="text-sm font-medium text-gray-500">Loading your destinations...</p>
                </div>
            ) : filteredDestinations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                    {(() => {
                        const firstAvailableId = filteredDestinations.find((d: any) => d.status !== 'connected')?.id;
                        return filteredDestinations.map((destination: any) => {
                            const isConnected = destination.status === 'connected';
                            const isActive = !isConnected && destination.id === firstAvailableId;

                            return (
                                <div
                                    key={destination.id}
                                    className={cn(
                                        "relative overflow-hidden rounded-2xl border p-5 transition-all duration-300 flex flex-col justify-between",
                                        isConnected
                                            ? "border-gray-100 bg-gray-50/60 dark:border-slate-800 dark:bg-slate-800/30 opacity-80"
                                            : isActive
                                              ? "border-cyan-200 bg-cyan-50/70 shadow-sm dark:border-cyan-700/60 dark:bg-cyan-950/30 hover:shadow-md hover:-translate-y-0.5"
                                              : "border-white bg-white/40 dark:border-slate-700/60 dark:bg-slate-900/20 opacity-70 hover:opacity-90 hover:-translate-y-0.5 hover:shadow-sm"
                                    )}
                                >
                                    <div className="flex items-start justify-between mb-3">
                                        {/* Logo */}
                                        <div className={cn(
                                            "relative w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 bg-white/70 dark:bg-slate-900/80 overflow-hidden",
                                            isConnected ? "border-cyan-100/50 dark:border-cyan-700/40" : "border-gray-200 dark:border-slate-600"
                                        )}>
                                            <img
                                                src={destination.logoSrc}
                                                alt={`${destination.name} logo`}
                                                width={28}
                                                height={28}
                                                className="object-contain"
                                            />
                                        </div>

                                        {/* Step icon */}
                                        <div className="mt-0.5 shrink-0">
                                            {isConnected ? (
                                                <CheckCircle2 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                                            ) : isActive ? (
                                                <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-cyan-500">
                                                    <div className="h-2 w-2 rounded-full bg-cyan-500" />
                                                </div>
                                            ) : (
                                                <Circle className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                                            )}
                                        </div>
                                    </div>

                                    <div className="mb-5 flex-1">
                                        <h3 className={cn(
                                            "font-semibold mb-1",
                                            isConnected
                                                ? "text-gray-500 dark:text-gray-400 line-through decoration-gray-300 dark:decoration-gray-600"
                                                : "text-gray-900 dark:text-white"
                                        )}>{destination.name}</h3>
                                        {!isConnected && (
                                            <p className={cn(
                                                "text-sm line-clamp-2",
                                                isActive ? "text-gray-600 dark:text-gray-400" : "text-gray-400 dark:text-gray-600"
                                            )}>{destination.description}</p>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between">
                                        {isConnected ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => setSetupDestinationId(destination.id)}
                                                    className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 font-medium underline underline-offset-2 transition-colors"
                                                >
                                                    Manage
                                                </button>
                                                <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">Done</span>
                                            </>
                                        ) : isActive ? (
                                            <button
                                                onClick={() => setSetupDestinationId(destination.id)}
                                                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 transition-colors"
                                            >
                                                Set Up <ArrowRight className="h-3 w-3" />
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => setSetupDestinationId(destination.id)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/50 dark:border-slate-700 dark:bg-slate-800/50 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                                            >
                                                Set Up
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        });
                    })()}
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
