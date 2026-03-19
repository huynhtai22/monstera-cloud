"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Search, ArrowRight, Send, Plus, AlertCircle, Loader2 } from "lucide-react";
import { ConnectDestinationModal } from "@/components/ConnectDestinationModal";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch data');
    }
    return data;
};

// Available destinations that are not connected
const availableDestinations = [
    { id: 'gsheets', name: 'Google Sheets', description: 'Export data directly to spreadsheets.', status: 'available', logoSrc: '/logos/gsheets.svg' },
    { id: 'looker', name: 'Looker Studio', description: 'Visualize data in custom reports.', status: 'available', logoSrc: '/logos/looker.svg' },
    { id: 'bigquery', name: 'Google BigQuery', description: 'Enterprise data warehouse.', status: 'available', logoSrc: '/logos/bigquery.svg' },
    { id: 'sql', name: 'PostgreSQL', description: 'Sync directly to your database.', status: 'available', logoSrc: '/logos/postgres.svg' },
    { id: 'slack', name: 'Slack Alerts', description: 'Get daily summary notifications.', status: 'available', logoSrc: '/logos/slack.svg' },
];

export default function DestinationsPage() {
    const [isDestinationModalOpen, setIsDestinationModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    // Global State
    const { activeWorkspaceId } = useWorkspaceStore();

    // Fetch Data
    const { data: workspaces, error, isLoading } = useSWR("/api/workspaces", fetcher);

    // Filter logic
    const filteredDestinations = React.useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return availableDestinations;

        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];

        const connectedDestinations = workspace?.connections
            ?.filter((c: any) => c.type === 'destination')
            .map((conn: any) => {
                let logo = '/logos/postgres.svg';
                if (conn.provider.includes('google_sheets')) logo = '/logos/gsheets.svg';
                else if (conn.provider.includes('looker')) logo = '/logos/looker.svg';
                else if (conn.provider.includes('bigquery')) logo = '/logos/bigquery.svg';
                else if (conn.provider.includes('postgres') || conn.provider.includes('sql')) logo = '/logos/postgres.svg';
                else if (conn.provider.includes('slack')) logo = '/logos/slack.svg';

                return {
                    id: conn.id,
                    name: conn.name,
                    description: `Connected to ${conn.provider} via workspace credentials.`,
                    status: conn.status === 'connected' ? 'connected' : 'error',
                    logoSrc: logo,
                };
            }) || [];

        const connectedProviderIds = new Set(connectedDestinations.map((c: any) => c.id));
        const filteredAvailable = availableDestinations.filter(a => !connectedProviderIds.has(a.id));

        const combined = [...connectedDestinations, ...filteredAvailable];

        return combined.filter((dest: any) => {
            const matchesSearch = dest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                dest.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'warehouses') return ['Google BigQuery', 'PostgreSQL'].includes(dest.name);
            if (activeFilter === 'spreadsheets') return ['Google Sheets'].includes(dest.name);
            return true;
        });
    }, [searchQuery, activeFilter, workspaces, activeWorkspaceId]);

    if (error) {
        return (
            <div className="w-full py-20 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Failed to load destinations</h3>
                <p className="text-sm text-gray-500">Please check your connection or try refreshing the page.</p>
            </div>
        );
    }

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Subtle Liquid Mesh Background underlay */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[10%] left-[30%] w-[40%] h-[50%] rounded-full bg-blue-200/20 dark:bg-blue-900/20 blur-[120px]" />
                <div className="absolute top-[40%] right-[10%] w-[30%] h-[60%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
            </div>

            {/* Header */}
            <div className="mb-10 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0 relative z-10">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">Destinations</h1>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 max-w-2xl text-lg">
                        Choose where Monstera Cloud should send your clean, transformed data.
                    </p>
                </div>
                <div className="flex space-x-3">
                    <button
                        onClick={() => setIsDestinationModalOpen(true)}
                        className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Add Destination</span>
                    </button>
                </div>
            </div>

            {/* Active Pipelines Info Bar */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-8 flex items-center justify-between shadow-sm">
                <div className="flex items-center space-x-3 text-blue-800">
                    <div className="p-2 bg-blue-100 rounded-lg shrink-0">
                        <Send className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="font-semibold text-sm">Active Data Pipelines</p>
                        <p className="text-xs text-blue-600/80">You currently have 0 active pipelines sending data outward.</p>
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
                    {filteredDestinations.map((destination) => (
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
                                    <Image
                                        src={destination.logoSrc}
                                        alt={`${destination.name} logo`}
                                        width={28}
                                        height={28}
                                        className="object-contain"
                                    />
                                </div>

                                {/* Status Indicator */}
                                {destination.status === 'connected' ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-50/80 text-emerald-700 border border-emerald-100/50 shadow-sm backdrop-blur-sm">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                                        Connected
                                    </span>
                                ) : destination.status === 'error' ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-semibold bg-red-50/80 text-red-700 border border-red-100/50 shadow-sm backdrop-blur-sm">
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
                                    <button className="w-full py-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm border border-white dark:border-slate-700/60 dark:border-slate-700/40 group-hover:border-emerald-200/80 group-hover:bg-emerald-50/80 text-gray-700 dark:text-slate-300 group-hover:text-emerald-700 text-sm font-medium rounded-lg transition-colors shadow-sm">
                                        Configure
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setIsDestinationModalOpen(true)}
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
                isOpen={isDestinationModalOpen}
                onClose={() => setIsDestinationModalOpen(false)}
            />
        </div>
    );
}
