"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Search, ExternalLink, Filter, TrendingUp, ShoppingBag, BarChart3, LayoutTemplate } from "lucide-react";

// Mock Data for Premium Templates
const templates = [
    {
        id: 't-1',
        title: 'E-commerce Executive Overview',
        description: 'A comprehensive birds-eye view of your entire store performance across all channels.',
        category: 'E-commerce',
        sources: ['/logos/shopee.svg', '/logos/lazada.svg', '/logos/shopify.svg'],
        destinations: ['Looker Studio'],
        featured: true,
        icon: ShoppingBag,
        color: 'emerald'
    },
    {
        id: 't-2',
        title: 'Paid Social Blended ROI',
        description: 'Track ad spend and ROAS across Meta, TikTok, and Google Ads in one unified view.',
        category: 'Marketing',
        sources: ['/logos/facebook.svg', '/logos/tiktok.svg'],
        destinations: ['Looker Studio', 'Google Sheets'],
        featured: false,
        icon: TrendingUp,
        color: 'blue'
    },
    {
        id: 't-3',
        title: 'Shopee Daily Velocity',
        description: 'Granular tracking of daily sales volume, top moving SKUs, and immediate refund rates.',
        category: 'Marketplace',
        sources: ['/logos/shopee.svg'],
        destinations: ['Looker Studio'],
        featured: false,
        icon: BarChart3,
        color: 'orange'
    }
];

export default function TemplatesGallery() {
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("All Templates");

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Liquid Glass Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[0%] left-[20%] w-[40%] h-[40%] rounded-full bg-indigo-200/20 dark:bg-indigo-900/20 blur-[120px]" />
                <div className="absolute top-[40%] right-[-10%] w-[30%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
            </div>

            {/* Header Section */}
            <div className="mb-10 text-center max-w-2xl mx-auto">
                <div className="w-12 h-12 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm text-indigo-600">
                    <LayoutTemplate className="w-6 h-6" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white mb-3">Template Gallery</h1>
                <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm">
                    Deploy pre-built, expert-crafted dashboards directly to your favorite BI tools in seconds. No complex SQL or manual joining required.
                </p>
            </div>

            {/* Controls Bar */}
            <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl p-2 mb-10 flex items-center justify-between">
                <div className="flex px-1 space-x-1">
                    {['All Templates', 'E-commerce', 'Marketing', 'Marketplace'].map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setActiveFilter(filter)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-xl transition-all ${activeFilter === filter
                                    ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-600 border border-white dark:border-slate-700/80 dark:border-slate-700/60'
                                    : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:text-white hover:bg-white/20'
                                }`}
                        >
                            {filter}
                        </button>
                    ))}
                </div>

                <div className="relative w-72">
                    <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search templates..."
                        className="w-full pl-9 pr-4 py-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white/80 dark:bg-slate-900/80 transition-all placeholder:text-gray-400 dark:text-gray-500 text-gray-700 dark:text-slate-300"
                    />
                </div>
            </div>

            {/* Template Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map((template) => (
                    <div
                        key={template.id}
                        className={`relative overflow-hidden bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl rounded-2xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 p-6 transition-all duration-300 group flex flex-col justify-between cursor-pointer shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 hover:bg-white/60 dark:bg-slate-900/60 hover:border-indigo-200/50`}
                    >
                        {/* Shine Effect */}
                        <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/50 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none transform -translate-x-full group-hover:translate-x-full" />

                        <div>
                            {/* Card Header Top Row */}
                            <div className="flex justify-between items-start mb-4">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center 
                                    ${template.color === 'emerald' ? 'bg-emerald-100/50 text-emerald-600' :
                                        template.color === 'blue' ? 'bg-blue-100/50 text-blue-600' :
                                            'bg-orange-100/50 text-orange-600'}`}>
                                    <template.icon className="w-5 h-5" />
                                </div>
                                <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 dark:bg-slate-800/50 text-gray-600 dark:text-gray-300 dark:text-gray-600 border border-gray-200 dark:border-slate-700/50">
                                    {template.category}
                                </span>
                            </div>

                            {/* Title & Desc */}
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-indigo-700 transition-colors">{template.title}</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 line-clamp-2 leading-relaxed mb-6">{template.description}</p>

                            {/* Sources Icons */}
                            <div className="mb-6">
                                <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 mb-2 tracking-wider">Blended Sources</p>
                                <div className="flex -space-x-2">
                                    {template.sources.map((src, i) => (
                                        <div key={i} className="relative w-8 h-8 rounded-full border-2 border-white dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-sm flex items-center justify-center overflow-hidden">
                                            <Image src={src} alt="Source" width={16} height={16} className="object-contain" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="pt-5 border-t border-gray-200 dark:border-slate-700/50 flex flex-col space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium">Deploys to:</span>
                                <div className="flex space-x-1">
                                    {template.destinations.map(dest => (
                                        <span key={dest} className="text-xs font-semibold px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 shadow-sm">
                                            {dest}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <button className="w-full flex items-center justify-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
                                <span>Deploy Template</span>
                                <ExternalLink className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
