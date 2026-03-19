"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { FileText, Search, Filter, Download, ArrowUpRight, ArrowDownRight, Database, Clock, MoreVertical, RefreshCcw } from "lucide-react";

// Mock Data for the Logs
const syncLogs = [
    { id: 'SYNC-9012', source: 'Shopee', logo: '/logos/shopee.svg', destination: 'Google Sheets', destLogo: '/logos/gsheets.svg', status: 'Success', rows: 450, duration: '2.4s', time: '2 mins ago', date: 'Oct 24, 2026' },
    { id: 'SYNC-9011', source: 'Facebook Ads', logo: '/logos/meta.svg', destination: 'BigQuery', destLogo: '/logos/bigquery.svg', status: 'Success', rows: 12050, duration: '14.2s', time: '1 hour ago', date: 'Oct 24, 2026' },
    { id: 'SYNC-9010', source: 'Google Analytics', logo: '/logos/ga.svg', destination: 'Looker Studio', destLogo: '/logos/looker.svg', status: 'Success', rows: 840, duration: '3.1s', time: '5 hours ago', date: 'Oct 24, 2026' },
    { id: 'SYNC-9009', source: 'Shopify', logo: '/logos/shopee.svg', destination: 'Excel', destLogo: '/logos/excel.svg', status: 'Failed', rows: 0, duration: '0.8s', time: '1 day ago', date: 'Oct 23, 2026', error: 'Auth Expired' },
    { id: 'SYNC-9008', source: 'Facebook Ads', logo: '/logos/meta.svg', destination: 'PostgreSQL', destLogo: '/logos/postgres.svg', status: 'Success', rows: 5420, duration: '8.5s', time: '1 day ago', date: 'Oct 23, 2026' },
    { id: 'SYNC-9007', source: 'Shopee', logo: '/logos/shopee.svg', destination: 'Google Sheets', destLogo: '/logos/gsheets.svg', status: 'Success', rows: 310, duration: '1.9s', time: '2 days ago', date: 'Oct 22, 2026' },
];

export default function ReportsPage() {
    const [searchTerm, setSearchTerm] = useState('');

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Liquid Glass Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[0%] right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-200/20 dark:bg-indigo-900/20 blur-[120px]" />
                <div className="absolute bottom-[10%] left-[0%] w-[50%] h-[50%] rounded-full bg-emerald-200/20 dark:bg-emerald-900/20 blur-[120px]" />
            </div>

            {/* Header Section */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0 relative z-10">
                <div>
                    <div className="flex items-center space-x-3 mb-2">
                        <div className="w-10 h-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-xl flex items-center justify-center shadow-sm text-indigo-600">
                            <FileText className="w-5 h-5" />
                        </div>
                        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Reports & Logs</h1>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm max-w-2xl">
                        Audit data throughput, investigate failed syncs, and monitor your total rows.
                    </p>
                </div>

                <div className="flex items-center space-x-3">
                    <button className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm border border-white dark:border-slate-700/80 dark:border-slate-700/60 rounded-xl hover:bg-white dark:bg-slate-800 transition-all shadow-sm">
                        <Download className="w-4 h-4 text-gray-500 dark:text-gray-400 dark:text-gray-500" />
                        <span>Export CSV</span>
                    </button>
                    <button className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 dark:bg-slate-800 hover:bg-black rounded-xl transition-all shadow-sm">
                        <RefreshCcw className="w-4 h-4" />
                        <span>Refresh Logs</span>
                    </button>
                </div>
            </div>

            {/* Data Profiling KPI Bar */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 relative z-10">
                {/* Total Rows */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-start justify-between mb-4">
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500">Total Rows Extracted</span>
                        <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                            <Database className="w-4 h-4" />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">4,892,105</div>
                        <div className="flex items-center text-xs mt-1 text-emerald-600 font-medium">
                            <ArrowUpRight className="w-3 h-3 mr-0.5" /> 12% this month
                        </div>
                    </div>
                </div>

                {/* Avg Sync Duration */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-start justify-between mb-4">
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500">Avg Sync Duration</span>
                        <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                            <Clock className="w-4 h-4" />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">4.2s</div>
                        <div className="flex items-center text-xs mt-1 text-emerald-600 font-medium">
                            <ArrowDownRight className="w-3 h-3 mr-0.5" /> 0.3s faster
                        </div>
                    </div>
                </div>

                {/* Success Rate */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                    <div className="flex items-start justify-between mb-4">
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500">Sync Success Rate</span>
                        <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                            <Database className="w-4 h-4" />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">99.8%</div>
                        <div className="flex items-center text-xs mt-1 text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium">
                            Last 30 days
                        </div>
                    </div>
                </div>

                {/* Errors */}
                <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-red-500/20 rounded-2xl p-5 shadow-sm flex flex-col justify-between relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-bl-[100px] pointer-events-none -z-10"></div>
                    <div className="flex items-start justify-between mb-4">
                        <span className="text-sm font-medium text-red-900">Failed Syncs</span>
                        <div className="p-2 bg-red-100 rounded-lg text-red-600">
                            <FileText className="w-4 h-4" />
                        </div>
                    </div>
                    <div>
                        <div className="text-2xl font-bold text-red-700">3</div>
                        <div className="flex items-center text-xs mt-1 text-red-600 font-medium cursor-pointer hover:underline">
                            View error logs →
                        </div>
                    </div>
                </div>
            </div>

            {/* Sync Logs Table */}
            <div className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-2xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-3xl shadow-sm overflow-hidden relative z-10 flex flex-col">
                {/* Table Header Controls */}
                <div className="p-5 border-b border-gray-100 dark:border-slate-700/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/40 dark:bg-slate-900/40">
                    <div className="relative max-w-sm w-full">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search by ID, Source, or Destination..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="block w-full pl-10 pr-3 py-2 border border-white dark:border-slate-700/80 dark:border-slate-700/60 rounded-xl leading-5 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-all shadow-sm"
                        />
                    </div>
                    <div className="flex items-center space-x-2">
                        <button className="flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:bg-slate-800 transition-colors shadow-sm">
                            <Filter className="w-4 h-4 mr-2" />
                            Filter by Status
                        </button>
                    </div>
                </div>

                {/* Table Content */}
                <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-100 dark:border-slate-700/50 bg-gray-50 dark:bg-slate-800/30 text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400 dark:text-gray-500 uppercase">
                                <th className="px-6 py-4">Sync ID</th>
                                <th className="px-6 py-4">Pipeline</th>
                                <th className="px-6 py-4">Rows Synced</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Duration</th>
                                <th className="px-6 py-4">Time</th>
                                <th className="px-6 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100/50">
                            {syncLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-white/60 dark:bg-slate-900/60 transition-colors group cursor-pointer">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-xs font-mono font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-800/80 px-2 py-1 rounded-md">{log.id}</span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center space-x-3">
                                            <div className="flex -space-x-2">
                                                <div className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 border-2 border-white dark:border-slate-700 shadow-sm flex items-center justify-center p-1 z-10">
                                                    <Image src={log.logo} alt={log.source} width={16} height={16} />
                                                </div>
                                                <div className="w-7 h-7 rounded-full bg-white dark:bg-slate-800 border-2 border-white dark:border-slate-700 shadow-sm flex items-center justify-center p-1 z-0 relative">
                                                    <Image src={log.destLogo} alt={log.destination} width={16} height={16} />
                                                </div>
                                            </div>
                                            <span className="text-sm font-medium text-gray-900 dark:text-white hidden sm:inline-block">
                                                {log.source} <span className="text-gray-400 dark:text-gray-500 font-normal mx-1">→</span> {log.destination}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-sm text-gray-900 dark:text-white font-medium">{log.rows.toLocaleString()}</span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {log.status === 'Success' ? (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                                                Success
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5"></span>
                                                Failed
                                            </span>
                                        )}
                                        {log.error && <span className="block text-[10px] text-red-500 mt-1">{log.error}</span>}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500">
                                        {log.duration}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="text-sm text-gray-900 dark:text-white">{log.time}</div>
                                        <div className="text-[10px] text-gray-400 dark:text-gray-500">{log.date}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <MoreVertical className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-gray-100 dark:border-slate-700/50 bg-gray-50 dark:bg-slate-800/30 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 font-medium rounded-b-3xl">
                    Showing 1 to 6 of 12,402 entries
                    <div className="flex space-x-1">
                        <button className="px-3 py-1 rounded bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-sm hover:bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300">Prev</button>
                        <button className="px-3 py-1 rounded bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-sm hover:bg-gray-50 dark:bg-slate-800 text-gray-700 dark:text-slate-300">Next</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
