"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Settings2, ArrowRight, Save, Plus, Database, Sparkles, AlertCircle, CheckCircle2, Waypoints } from "lucide-react";

export default function TransformationsPage() {
    const [activeTab, setActiveTab] = useState<'mapping' | 'cleansing'>('mapping');

    return (
        <div className="relative max-w-7xl mx-auto px-8 py-10 w-full animate-in fade-in duration-300">
            {/* Liquid Glass Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
                <div className="absolute top-[0%] left-[20%] w-[40%] h-[40%] rounded-full bg-indigo-200/20 dark:bg-indigo-900/20 blur-[120px]" />
                <div className="absolute top-[40%] right-[-10%] w-[30%] h-[50%] rounded-full bg-violet-200/20 dark:bg-violet-900/20 blur-[120px]" />
            </div>

            {/* Header Section */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between space-y-4 sm:space-y-0 relative z-10">
                <div>
                    <div className="flex items-center space-x-3 mb-2">
                        <div className="w-10 h-10 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-xl flex items-center justify-center shadow-sm text-indigo-600">
                            <Waypoints className="w-5 h-5" />
                        </div>
                        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">Transformations</h1>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 dark:text-gray-500 text-sm max-w-2xl">
                        Cleanse, map, and transform your data in-flight before it reaches your destination warehouse. No SQL required.
                    </p>
                </div>

                <div className="flex items-center space-x-3">
                    <button className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm border border-white dark:border-slate-700/80 dark:border-slate-700/60 rounded-xl hover:bg-white dark:bg-slate-800 transition-all shadow-sm">
                        Discard Changes
                    </button>
                    <button className="flex items-center space-x-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-md shadow-indigo-500/20">
                        <Save className="w-4 h-4" />
                        <span>Deploy Transformation</span>
                    </button>
                </div>
            </div>

            {/* Pipeline Selector (Top Bar) */}
            <div className="bg-white/40 dark:bg-slate-900/40 backdrop-blur-md border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl p-4 mb-8 flex items-center justify-between shadow-[0_8px_30px_rgb(0,0,0,0.02)] relative z-10">
                <div className="flex items-center space-x-6">
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Editing Pipeline</span>
                        <select className="bg-transparent text-gray-900 dark:text-white font-semibold focus:outline-none cursor-pointer">
                            <option>Shopee Orders → Google Sheets</option>
                            <option>Facebook Ads → Google BigQuery</option>
                        </select>
                    </div>
                </div>

                <div className="flex bg-gray-100 dark:bg-slate-800/50 p-1 rounded-xl border border-gray-200 dark:border-slate-700/50 backdrop-blur-sm">
                    <button
                        onClick={() => setActiveTab('mapping')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'mapping' ? 'bg-white dark:bg-slate-800 text-indigo-700 shadow-sm border border-gray-200 dark:border-slate-700/50' : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-slate-300'
                            }`}
                    >
                        Schema Mapping
                    </button>
                    <button
                        onClick={() => setActiveTab('cleansing')}
                        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'cleansing' ? 'bg-white dark:bg-slate-800 text-indigo-700 shadow-sm border border-gray-200 dark:border-slate-700/50' : 'text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:text-slate-300'
                            }`}
                    >
                        Data Cleansing
                    </button>
                </div>
            </div>

            {/* Main Editor UI */}
            {activeTab === 'mapping' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in duration-300 relative z-10">

                    {/* Source Schema */}
                    <div className="lg:col-span-5 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between bg-white/40 dark:bg-slate-900/40">
                            <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center p-1.5 shadow-sm">
                                    <Image src="/logos/shopee.svg" alt="Source" width={20} height={20} className="object-contain" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">Shopee Orders API</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">Source Fields</p>
                                </div>
                            </div>
                            <span className="px-2 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase rounded-md border border-blue-100">14 Active</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {[
                                { name: 'order_sn', type: 'STRING', isKey: true },
                                { name: 'buyer_user_id', type: 'INT64', isKey: false },
                                { name: 'buyer_username', type: 'STRING', isKey: false },
                                { name: 'total_amount', type: 'FLOAT', isKey: false },
                                { name: 'create_time', type: 'TIMESTAMP', isKey: false },
                                { name: 'order_status', type: 'ENUM', isKey: false }
                            ].map((field) => (
                                <div key={field.name} className="flex items-center justify-between p-3 bg-white/80 dark:bg-slate-900/80 border border-gray-100 dark:border-slate-700 rounded-xl hover:border-indigo-200 hover:shadow-sm transition-all cursor-grab group">
                                    <div className="flex items-center space-x-3">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-indigo-400" />
                                        <span className={`text-sm font-medium ${field.isKey ? 'text-indigo-700 font-bold' : 'text-gray-700 dark:text-slate-300'}`}>{field.name}</span>
                                    </div>
                                    <span className="text-[10px] uppercase font-semibold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-800 px-2 py-0.5 rounded border border-gray-100 dark:border-slate-700">{field.type}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Mapping Arrows (Visual Only for mock) */}
                    <div className="hidden lg:flex lg:col-span-2 items-center justify-center">
                        <div className="flex flex-col items-center space-y-8 py-10 opacity-40">
                            <ArrowRight className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                            <ArrowRight className="w-6 h-6 text-indigo-400" />
                            <ArrowRight className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                            <ArrowRight className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                            <ArrowRight className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                        </div>
                    </div>

                    {/* Destination Schema */}
                    <div className="lg:col-span-5 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between bg-white/40 dark:bg-slate-900/40">
                            <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center p-1.5 shadow-sm">
                                    <Image src="/logos/gsheets.svg" alt="Destination" width={20} height={20} className="object-contain" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">Google Sheets Tab</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">Destination Columns</p>
                                </div>
                            </div>
                            <button className="text-[10px] font-bold uppercase text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded transition-colors border border-transparent hover:border-indigo-100 flex items-center">
                                <Plus className="w-3 h-3 mr-1" /> Add Col
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {[
                                { name: 'Order ID', type: 'TEXT', mappedFrom: 'order_sn' },
                                { name: 'Customer ID', type: 'NUMBER', mappedFrom: 'buyer_user_id' },
                                { name: 'Customer Name', type: 'TEXT', mappedFrom: 'buyer_username', hasRule: true },
                                { name: 'Revenue', type: 'CURRENCY', mappedFrom: 'total_amount' },
                                { name: 'Order Date', type: 'DATE', mappedFrom: 'create_time' },
                                { name: 'Status', type: 'TEXT', mappedFrom: 'order_status' }
                            ].map((col) => (
                                <div key={col.name} className="flex flex-col p-3 bg-white/80 dark:bg-slate-900/80 border border-gray-100 dark:border-slate-700 rounded-xl hover:border-indigo-200 hover:shadow-sm transition-all relative overflow-hidden group">
                                    {col.hasRule && (
                                        <div className="absolute top-0 right-0 w-8 h-8 bg-gradient-to-bl from-amber-100 to-transparent flex items-start justify-end p-1">
                                            <Sparkles className="w-3 h-3 text-amber-500" />
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{col.name}</span>
                                        <span className="text-[10px] uppercase font-semibold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-slate-800 px-2 py-0.5 rounded border border-gray-100 dark:border-slate-700">{col.type}</span>
                                    </div>
                                    <div className="flex items-center text-xs text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded-lg border border-indigo-100/50 self-start">
                                        <code className="font-mono">{col.mappedFrom}</code>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            )}

            {activeTab === 'cleansing' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-300 relative z-10">
                    <div className="md:col-span-2 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border border-white dark:border-slate-700/60 dark:border-slate-700/40 rounded-2xl shadow-sm p-6">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
                            <Sparkles className="w-5 h-5 text-indigo-500 mr-2" />
                            Active Cleansing Rules
                        </h3>

                        <div className="space-y-4">
                            {/* Rule 1 */}
                            <div className="flex items-start space-x-4 p-4 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-gray-200 dark:border-slate-700">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                                    <Settings2 className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-semibold text-gray-900 dark:text-white text-sm">Mask PII (Username)</h4>
                                        <span className="text-xs font-medium px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100">Active</span>
                                    </div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-3">Converts 'buyer_username' to a secure, anonymized SHA-256 hash before writing to the destination.</p>
                                    <div className="bg-gray-900 dark:bg-slate-800 rounded-lg p-3 overflow-x-auto text-xs text-green-400 font-mono">
                                        <span className="text-pink-400">HASH</span>(<span className="text-blue-300">shopee.buyer_username</span>, 'sha256') <span className="text-gray-400 dark:text-gray-500">-{'>'} Destination.'Customer Name'</span>
                                    </div>
                                </div>
                            </div>

                            {/* Rule 2 */}
                            <div className="flex items-start space-x-4 p-4 bg-white/80 dark:bg-slate-900/80 rounded-xl border border-gray-200 dark:border-slate-700">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                                    <Database className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-semibold text-gray-900 dark:text-white text-sm">Currency Normalization</h4>
                                        <span className="text-xs font-medium px-2 py-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100">Active</span>
                                    </div>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 dark:text-gray-500 mb-3">Converts 'total_amount' from integer cents to localized decimal currency format.</p>
                                    <div className="bg-gray-900 dark:bg-slate-800 rounded-lg p-3 overflow-x-auto text-xs text-green-400 font-mono">
                                        <span className="text-pink-400">DIVIDE</span>(<span className="text-blue-300">shopee.total_amount</span>, 100) <span className="text-gray-400 dark:text-gray-500">-{'>'} Destination.'Revenue'</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button className="mt-6 w-full py-3 border border-dashed border-gray-300 dark:border-slate-600 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 dark:text-gray-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors flex items-center justify-center">
                            <Plus className="w-4 h-4 mr-2" /> Add Rule
                        </button>
                    </div>

                    <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-6 h-fit backdrop-blur-xl">
                        <AlertCircle className="w-6 h-6 text-blue-600 mb-3" />
                        <h4 className="font-bold text-gray-900 dark:text-white mb-2">Why transform data?</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-300 dark:text-gray-600 mb-4 leading-relaxed">
                            Transformations run securely isolated on Monstera Cloud infrastructure. They allow you to structure and sanitize your data exactly as your analysts need it before they ever run a query.
                        </p>
                        <ul className="text-sm text-gray-600 dark:text-gray-300 dark:text-gray-600 space-y-2">
                            <li className="flex items-center"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2" /> PII Masking</li>
                            <li className="flex items-center"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2" /> Data Type Casting</li>
                            <li className="flex items-center"><CheckCircle2 className="w-4 h-4 text-emerald-500 mr-2" /> Currency Conversion</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
