"use client";

import React, { useState } from 'react';
import { Search, ExternalLink, TrendingUp, ShoppingBag, BarChart3, LayoutTemplate } from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";

// Mock Data for Premium Templates
const templates = [
    {
        id: 't-1',
        title: 'E-commerce Executive Overview',
        description: 'A comprehensive birds-eye view of your entire store performance across all channels.',
        category: 'E-commerce',
        sources: [INTEGRATION_LOGOS.shopee, INTEGRATION_LOGOS.lazada, INTEGRATION_LOGOS.shopify],
        destinations: ['Looker Studio'],
        featured: true,
        icon: ShoppingBag,
    },
    {
        id: 't-2',
        title: 'Paid Social Blended ROI',
        description: 'Track ad spend and ROAS across Meta, TikTok, and Google Ads in one unified view.',
        category: 'Marketing',
        sources: [INTEGRATION_LOGOS.meta, INTEGRATION_LOGOS.tiktok],
        destinations: ['Looker Studio', 'Google Sheets™'],
        featured: false,
        icon: TrendingUp,
    },
    {
        id: 't-3',
        title: 'Shopee Daily Velocity',
        description: 'Granular tracking of daily sales volume, top moving SKUs, and immediate refund rates.',
        category: 'Marketplace',
        sources: [INTEGRATION_LOGOS.shopee],
        destinations: ['Looker Studio'],
        featured: false,
        icon: BarChart3,
    }
];

export default function TemplatesGallery() {
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("All Templates");

    return (
        <div className="relative max-w-7xl mx-auto px-6 sm:px-8 py-8 w-full font-sans text-ink animate-in fade-in duration-300">
            {/* Header Section */}
            <div className="mb-10 text-center max-w-2xl mx-auto">
                <div className="w-10 h-10 bg-panel border border-line rounded-lg flex items-center justify-center mx-auto mb-3 text-accent">
                    <LayoutTemplate className="w-5 h-5" />
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink mb-2">Template Gallery</h1>
                <p className="text-ink-mute text-xs sm:text-sm leading-relaxed">
                    Deploy pre-built, expert-crafted analytics templates directly to your favorite BI tools in seconds. No complex SQL or manual joining required.
                </p>
            </div>

            {/* Controls Bar */}
            <div className="bg-panel border border-line rounded-lg p-2.5 mb-8 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex px-1 space-x-1 overflow-x-auto w-full sm:w-auto">
                    {['All Templates', 'E-commerce', 'Marketing', 'Marketplace'].map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setActiveFilter(filter)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeFilter === filter
                                    ? 'bg-canvas text-ink shadow-xs border border-line'
                                    : 'text-ink-mute hover:text-ink'
                                }`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>

                <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-ink-mute absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search templates..."
                        className="w-full pl-8 pr-3 py-1.5 bg-canvas border border-line rounded-md text-xs text-ink placeholder:text-ink-mute focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                </div>
            </div>

            {/* Template Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map((template) => (
                    <div
                        key={template.id}
                        className="bg-panel rounded-lg border border-line p-5 transition-colors flex flex-col justify-between hover:border-[#333]"
                    >
                        <div>
                            {/* Card Header Top Row */}
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-9 h-9 rounded-md bg-canvas border border-line flex items-center justify-center text-accent">
                                    <template.icon className="w-4 h-4" />
                                </div>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-canvas text-ink-mute border border-line">
                                    {template.category}
                                </span>
                            </div>

                            {/* Title & Desc */}
                            <h3 className="text-sm font-bold text-ink mb-1.5">{template.title}</h3>
                            <p className="text-xs text-ink-mute line-clamp-2 leading-relaxed mb-5">{template.description}</p>

                            {/* Sources Icons */}
                            <div className="mb-5">
                                <p className="text-[10px] uppercase font-bold text-ink-mute mb-2 tracking-wider">Blended Sources</p>
                                <div className="flex -space-x-1.5">
                                    {template.sources.map((src, i) => (
                                        <IntegrationMark key={i} src={src} alt="Source" size="sm" className="shadow-xs" />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="pt-4 border-t border-line flex flex-col space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-ink-mute font-medium">Deploys to:</span>
                                <div className="flex space-x-1">
                                    {template.destinations.map(dest => (
                                        <span key={dest} className="text-[11px] font-semibold px-2 py-0.5 rounded bg-canvas border border-line text-ink">
                                            {dest}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <button className="w-full flex items-center justify-center gap-1.5 py-2 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-md transition-colors shadow-xs">
                                <span>Deploy Template</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
