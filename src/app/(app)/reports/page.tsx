"use client";

import React from 'react';
import { FileText } from "lucide-react";

export default function ReportsPage() {
    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[0%] right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-200/20 dark:bg-indigo-900/20 blur-[120px]" />
                <div className="absolute bottom-[10%] left-[0%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
            </div>

            <div className="mb-8 relative z-10">
                <div className="flex items-center space-x-3 mb-2">
                    <div className="w-10 h-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-white dark:border-slate-700/60 rounded-xl flex items-center justify-center shadow-sm text-indigo-600">
                        <FileText className="w-5 h-5" />
                    </div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Reports & Logs</h1>
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-2xl">
                    Audit data throughput, investigate failed syncs, and monitor your total rows.
                </p>
            </div>

            <div className="relative z-10 flex flex-col items-center justify-center py-32 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-3xl bg-white/30 dark:bg-slate-900/30 backdrop-blur-sm">
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider mb-4">
                    Coming Soon
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Sync Logs & Reporting</h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-md text-center">
                    Automated sync logging with error tracking and performance metrics. Currently, use the TikTok Ads and Shopee pages for live data reports.
                </p>
            </div>
        </div>
    );
}
