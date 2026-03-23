"use client";

import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { Database, Search, ArrowRight, Plus, RefreshCw, AlertCircle, Loader2, CheckCircle2, CloudOff, Settings } from "lucide-react";
import { ConnectSourceModal } from "@/components/ConnectSourceModal";
import useSWR from "swr";
import { useWorkspaceStore } from "@/store/workspace";
import { integrationCatalogId } from "@/lib/integration-catalog";

const fetcher = async (url: string) => {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch data');
    }
    return data;
};

const ALL_CATALOG_INTEGRATIONS = [
    { id: 'tiktok_shop', name: 'TikTok Shop', description: 'Seller catalog, orders, and Shop analytics.', status: 'available' as const, logoSrc: '/logos/tiktok.svg' },
    { id: 'tiktok_business', name: 'TikTok Business', description: 'TikTok account and marketing data (Login Kit OAuth).', status: 'available' as const, logoSrc: '/logos/tiktok.svg' },
    { id: 'lazada', name: 'Lazada Seller', description: 'Order fulfillments and finance.', status: 'available' as const, logoSrc: '/logos/lazada.svg' },
    { id: 'shopify', name: 'Shopify', description: 'E-commerce platform orders.', status: 'available' as const, logoSrc: '/logos/shopify.svg' },
];

export default function DashboardPage() {
    const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
    const [selectedIntegration, setSelectedIntegration] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    // Global State
    const { activeWorkspaceId } = useWorkspaceStore();

    // Fetch Data
    const { data: workspaces, error, isLoading } = useSWR("/api/workspaces", fetcher);
    const { data: intConfig } = useSWR("/api/integrations/config", fetcher);

    const availableIntegrations = useMemo(() => {
        if (!intConfig) return ALL_CATALOG_INTEGRATIONS;
        return ALL_CATALOG_INTEGRATIONS.filter((item) => {
            if (item.id === 'tiktok_shop') return intConfig.tiktokShop !== false;
            if (item.id === 'tiktok_business') return intConfig.tiktokBusiness !== false;
            return true;
        });
    }, [intConfig]);

    // Filter logic
    const filteredIntegrations = useMemo(() => {
        if (!Array.isArray(workspaces) || !activeWorkspaceId) return availableIntegrations;

        const workspace = workspaces.find((w: any) => w.id === activeWorkspaceId) || workspaces[0];
        const sourceConnections = (workspace?.connections || []).filter((c: any) => c.type === 'source');

        const connectedCatalogIds = new Set(
            sourceConnections.map((c: any) => integrationCatalogId(c.provider))
        );

        const connectedSources = sourceConnections.map((conn: any) => {
            let logo = '/logos/postgres.svg';
            if (conn.provider.includes('shopee')) logo = '/logos/shopee.svg';
            else if (conn.provider.includes('facebook') || conn.provider.includes('fb')) logo = '/logos/facebook.svg';
            else if (conn.provider.includes('google') || conn.provider.includes('ga4')) logo = '/logos/ga4.svg';
            else if (conn.provider.includes('tiktok_business')) logo = '/logos/tiktok.svg';
            else if (conn.provider.includes('tiktok_shop') || conn.provider === 'tiktok') logo = '/logos/tiktok.svg';

            const desc = `Connected to ${conn.provider} via workspace credentials.`;
            const relatedPipeline = workspace?.pipelines?.find((p: any) => p.sourceConnectionId === conn.id);

            return {
                id: conn.id,
                catalogId: integrationCatalogId(conn.provider),
                name: conn.name,
                description: desc,
                status: conn.status === 'connected' ? 'connected' : 'error',
                lastSync: relatedPipeline?.lastSyncedAt
                    ? new Date(relatedPipeline.lastSyncedAt).toLocaleString()
                    : 'Never',
                logoSrc: logo,
                pipelineId: relatedPipeline?.id,
            };
        });

        const filteredAvailable = availableIntegrations.filter((a) => !connectedCatalogIds.has(a.id));
        const combined = [...connectedSources, ...filteredAvailable];

        return combined.filter((integration: any) => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());

            if (!matchesSearch) return false;

            if (activeFilter === 'connected') return integration.status !== 'available';
            if (activeFilter === 'available') return integration.status === 'available';
            return true;
        });
    }, [searchQuery, activeFilter, workspaces, activeWorkspaceId, availableIntegrations]);

    // Error State
    if (error) {
        return (
            <div className="w-full py-20 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Failed to load data sources</h3>
                <p className="text-sm text-gray-500">Please check your connection or try refreshing the page.</p>
            </div>
        );
    }

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Subtle Liquid Mesh Background underlay to make the glass pop */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
                <div className="absolute top-[20%] right-[-10%] w-[40%] h-[60%] rounded-full bg-blue-200/20 dark:bg-blue-900/20 blur-[120px]" />
                <div className="absolute bottom-[-20%] left-[10%] w-[60%] h-[50%] rounded-full bg-emerald-100/30 dark:bg-emerald-900/30 blur-[140px]" />
            </div>

            {/* Header */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0">
                <div>
                    <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">Data Sources</h1>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 max-w-2xl text-base">
                        Connect and manage the platforms where your data lives. We'll automatically fetch and transform it.
                    </p>
                </div>
                <div className="flex space-x-3">
                    <button className="flex items-center space-x-2 px-4 py-2 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 dark:text-gray-600 hover:bg-gray-50 dark:bg-slate-800 hover:border-gray-300 dark:border-slate-600 transition-colors">
                        <RefreshCw className="w-4 h-4" />
                        <span>Refresh All</span>
                    </button>
                    <button
                        onClick={() => setIsSourceModalOpen(true)}
                        className="flex items-center space-x-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-all shadow-sm hover:shadow"
                    >
                        <Plus className="w-4 h-4" />
                        <span>New Data Source</span>
                    </button>
                </div>
            </div>

            {/* Storage Info Bar (Liquid Glass) */}
            <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-xl p-3 mb-8 flex items-center justify-between">
                <div className="flex items-center space-x-3 text-gray-700 dark:text-slate-300">
                    <Database className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <div className="flex items-center space-x-2">
                        <span className="font-semibold text-sm">Storage out:</span>
                        <span className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">1.2 GB / 10 GB limit</span>
                    </div>
                </div>
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden hidden sm:block">
                    <div className="h-full bg-emerald-500 w-[12%] rounded-full"></div>
                </div>
            </div>

            {/* Search and Filter */}
            <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-8 mb-8">
                <div className="relative flex-1 max-w-md group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-5 h-5 group-focus-within:text-emerald-500 transition-colors" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search integrations..."
                        className="w-full pl-10 pr-12 py-2.5 bg-white/40 dark:bg-slate-900/40 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/80 dark:bg-slate-900/80 transition-all shadow-sm"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 border border-gray-200 dark:border-slate-700/50 rounded text-[10px] font-medium text-gray-400 dark:text-gray-500 bg-white/50 dark:bg-slate-900/50 pointer-events-none hidden sm:block">
                        /
                    </div>
                </div>
                <div className="flex space-x-6 border-b border-gray-200 dark:border-slate-700">
                    <button
                        onClick={() => setActiveFilter('all')}
                        className={`pb-3 text-sm font-semibold transition-colors ${activeFilter === 'all' ? 'text-gray-900 dark:text-white border-b-2 border-emerald-500' : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-slate-300'}`}
                    >
                        All Sources
                    </button>
                    <button
                        onClick={() => setActiveFilter('connected')}
                        className={`pb-3 text-sm font-medium transition-colors ${activeFilter === 'connected' ? 'text-gray-900 dark:text-white border-b-2 border-emerald-500 font-semibold' : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-slate-300'}`}
                    >
                        Connected ({Array.isArray(workspaces) ? workspaces.find((w: any) => w.id === activeWorkspaceId)?.connections?.filter((c: any) => c.type === 'source').length || 0 : 0})
                    </button>
                    <button
                        onClick={() => setActiveFilter('available')}
                        className={`pb-3 text-sm font-medium transition-colors ${activeFilter === 'available' ? 'text-gray-900 dark:text-white border-b-2 border-emerald-500 font-semibold' : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-slate-300'}`}
                    >
                        Available
                    </button>
                </div>
            </div>

            {/* Grid */}
            {isLoading ? (
                <div className="w-full py-20 flex flex-col items-center justify-center text-center">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
                    <p className="text-sm font-medium text-gray-500">Loading your data sources...</p>
                </div>
            ) : filteredIntegrations.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredIntegrations.map((integration) => (
                        <div
                            key={integration.id}
                            className={`relative overflow-hidden bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl rounded-2xl border p-5 transition-all duration-300 group flex flex-col justify-between cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/60 dark:bg-slate-900/60
                                ${integration.status === 'error' ? 'border-red-200/80 hover:border-red-300' : 'border-white dark:border-slate-700/60 dark:border-slate-700/40 hover:border-emerald-200/80'}`}
                        >
                            {/* Inner Glass Reflection */}
                            <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                            <div className="flex items-start justify-between mb-3 relative z-10">
                                {/* Logo */}
                                <div className={`relative w-12 h-12 rounded-xl backdrop-blur-md border flex items-center justify-center shrink-0 transition-colors bg-white/50 dark:bg-slate-900/50 overflow-hidden
                                    ${integration.status === 'connected' ? 'border-emerald-100/50' :
                                        integration.status === 'syncing' ? 'border-blue-100/50' :
                                            integration.status === 'error' ? 'border-red-100/50' :
                                                'border-gray-200 dark:border-slate-700/50 grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100'}`}>
                                    <Image
                                        src={integration.logoSrc}
                                        alt={`${integration.name} logo`}
                                        width={28}
                                        height={28}
                                        className="object-contain"
                                    />
                                </div>

                                {/* Status Indicator */}
                                <div className="flex items-center">
                                    {integration.status === 'connected' && (
                                        <div className="flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                            Connected
                                        </div>
                                    )}
                                    {integration.status === 'syncing' && (
                                        <div className="flex items-center text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded-md">
                                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                                            Syncing
                                        </div>
                                    )}
                                    {integration.status === 'error' && (
                                        <div className="flex items-center text-xs font-semibold text-red-700 bg-red-50 px-2 py-1 rounded-md">
                                            <AlertCircle className="w-3.5 h-3.5 mr-1" />
                                            Error
                                        </div>
                                    )}
                                    {/* Quick Hover Action for Connected */}
                                    {integration.status === 'connected' && (
                                        <button className="absolute right-0 top-8 p-1.5 opacity-0 group-hover:opacity-100 group-hover:-translate-y-1 transition-all text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-sm rounded-md z-10">
                                            <Settings className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="mb-5 flex-1">
                                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1 tracking-tight">{integration.name}</h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 leading-relaxed line-clamp-2">{integration.description}</p>

                                {/* Trust Signals & Errors */}
                                {integration.status === 'error' && (
                                    <p className="text-xs text-red-600 font-medium mt-2 flex items-center">
                                        <CloudOff className="w-3 h-3 mr-1" />
                                        {integration.errorMsg}
                                    </p>
                                )}
                                {integration.status !== 'available' && integration.status !== 'error' && (
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">
                                        Last synced: {integration.lastSync}
                                    </p>
                                )}
                            </div>

                            <div className="relative z-10">
                                {integration.status === 'error' ? (
                                    <button className="w-full py-2 bg-red-50/80 backdrop-blur-sm hover:bg-red-100/80 text-red-700 text-sm font-semibold rounded-lg transition-colors border border-red-200/50 shadow-sm">
                                        Fix Connection
                                    </button>
                                ) : integration.status === 'syncing' ? (
                                    <button disabled className="w-full py-2 bg-white/40 dark:bg-slate-900/40 backdrop-blur-sm text-gray-400 dark:text-gray-500 text-sm font-semibold rounded-lg border border-gray-200 dark:border-slate-700/50 cursor-not-allowed flex justify-center items-center">
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...
                                    </button>
                                ) : integration.status === 'connected' ? (
                                    <button
                                        onClick={async (e) => {
                                            e.stopPropagation();
                                            if (!integration.pipelineId) {
                                                alert("Please complete the destination mapping first.");
                                                return;
                                            }

                                            // Optimistic UI loading state could be added here
                                            try {
                                                const res = await fetch(`/api/pipelines/${integration.pipelineId}/run`, { method: 'POST' });
                                                const data = await res.json();
                                                if (res.ok) {
                                                    alert(data.message || "Sync complete!");
                                                } else {
                                                    alert("Sync failed: " + data.error);
                                                }
                                            } catch (err) {
                                                alert("Network error occurred during sync.");
                                            }
                                        }}
                                        className="w-full py-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm border border-white dark:border-slate-700/60 border-slate-700/40 group-hover:border-emerald-200/80 group-hover:bg-emerald-500 text-gray-700 dark:text-slate-300 group-hover:text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                                    >
                                        Sync Now
                                    </button>
                                ) : (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedIntegration(integration);
                                            setIsSourceModalOpen(true);
                                        }}
                                        className="w-full py-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border border-white dark:border-slate-700/60 dark:border-slate-700/40 text-gray-600 dark:text-gray-300 dark:text-gray-600 text-sm font-medium rounded-lg transition-colors group-hover:border-white dark:border-slate-700 group-hover:bg-white/80 dark:bg-slate-900/80 shadow-sm"
                                    >
                                        Connect
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="w-full py-20 flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl bg-gray-50 dark:bg-slate-800/50">
                    <Database className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No integrations found</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 max-w-sm mb-6">We couldn't find any data sources matching "{searchQuery}". Try a different keyword or category.</p>
                    <button className="text-sm font-medium text-emerald-600 hover:text-emerald-700">
                        Suggest an integration &rarr;
                    </button>
                </div>
            )}

            <ConnectSourceModal
                isOpen={isSourceModalOpen}
                onClose={() => setIsSourceModalOpen(false)}
                integration={selectedIntegration}
            />
        </div>
    );
}
