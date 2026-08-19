"use client";

import React, { useState } from 'react';
import { Settings2, ArrowRight, Save, Plus, Database, Sparkles, AlertCircle, CheckCircle2, Waypoints } from "lucide-react";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";
import { IntegrationMark } from "@/components/ui/IntegrationMark";

export default function TransformationsPage() {
    const [activeTab, setActiveTab] = useState<'mapping' | 'cleansing'>('mapping');

    return (
        <div className="relative max-w-7xl mx-auto px-6 sm:px-8 py-8 w-full font-sans text-ink animate-in fade-in duration-300">
            {/* Header Section */}
            <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-line">
                <div>
                    <div className="flex items-center space-x-3 mb-2">
                        <div className="w-10 h-10 bg-panel border border-line rounded-lg flex items-center justify-center text-accent">
                            <Waypoints className="w-5 h-5" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight text-ink">Transformations</h1>
                    </div>
                    <p className="text-ink-mute text-xs sm:text-sm max-w-2xl">
                        Cleanse, map, and transform your data in-flight before it reaches your destination warehouse. No SQL required.
                    </p>
                </div>

                <div className="flex items-center space-x-3">
                    <button className="px-4 py-2 text-xs font-semibold text-ink bg-panel border border-line rounded-md hover:bg-[#16181c] transition-colors">
                        Discard Changes
                    </button>
                    <button className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-neutral-200 text-black rounded-md text-xs font-semibold transition-colors shadow-xs">
                        <Save className="w-4 h-4" />
                        <span>Deploy Transformation</span>
                    </button>
                </div>
            </div>

            {/* Pipeline Selector (Top Bar) */}
            <div className="bg-panel border border-line rounded-lg p-4 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center space-x-6">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-ink-mute uppercase tracking-wider mb-1">Editing Pipeline</span>
                        <select className="bg-canvas border border-line text-ink text-xs font-medium rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer">
                            <option>Shopee Orders → Google Sheets™</option>
                            <option>Meta Ads → Looker Studio™</option>
                        </select>
                    </div>
                </div>

                <div className="flex bg-canvas p-1 rounded-md border border-line">
                    <button
                        onClick={() => setActiveTab('mapping')}
                        className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${activeTab === 'mapping' ? 'bg-panel text-ink shadow-xs border border-line' : 'text-ink-mute hover:text-ink'
                            }`}
                    >
                        Schema Mapping
                    </button>
                    <button
                        onClick={() => setActiveTab('cleansing')}
                        className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${activeTab === 'cleansing' ? 'bg-panel text-ink shadow-xs border border-line' : 'text-ink-mute hover:text-ink'
                            }`}
                    >
                        Data Cleansing
                    </button>
                </div>
            </div>

            {/* Main Editor UI */}
            {activeTab === 'mapping' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* Source Schema */}
                    <div className="lg:col-span-5 bg-panel border border-line rounded-lg overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-line flex items-center justify-between bg-canvas/40">
                            <div className="flex items-center space-x-3">
                                <IntegrationMark src={INTEGRATION_LOGOS.shopee} alt="Shopee" size="sm" />
                                <div>
                                    <h3 className="font-bold text-ink text-xs">Shopee Orders API</h3>
                                    <p className="text-[11px] text-ink-mute">Source Fields</p>
                                </div>
                            </div>
                            <span className="px-2 py-0.5 bg-canvas text-accent text-[10px] font-semibold uppercase rounded border border-line">14 Active</span>
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
                                <div key={field.name} className="flex items-center justify-between p-2.5 bg-canvas border border-line rounded-md hover:border-[#333] transition-colors cursor-grab group">
                                    <div className="flex items-center space-x-2.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-line group-hover:bg-accent" />
                                        <span className={`text-xs ${field.isKey ? 'text-accent font-semibold' : 'text-ink'}`}>{field.name}</span>
                                    </div>
                                    <span className="text-[10px] uppercase font-mono text-ink-mute bg-panel px-1.5 py-0.5 rounded border border-line">{field.type}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Mapping Arrows */}
                    <div className="hidden lg:flex lg:col-span-2 items-center justify-center">
                        <div className="flex flex-col items-center space-y-8 py-10 opacity-30">
                            <ArrowRight className="w-5 h-5 text-ink-mute" />
                            <ArrowRight className="w-5 h-5 text-accent" />
                            <ArrowRight className="w-5 h-5 text-ink-mute" />
                            <ArrowRight className="w-5 h-5 text-ink-mute" />
                            <ArrowRight className="w-5 h-5 text-ink-mute" />
                        </div>
                    </div>

                    {/* Destination Schema */}
                    <div className="lg:col-span-5 bg-panel border border-line rounded-lg overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-line flex items-center justify-between bg-canvas/40">
                            <div className="flex items-center space-x-3">
                                <IntegrationMark src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets" size="sm" />
                                <div>
                                    <h3 className="font-bold text-ink text-xs">Google Sheets™ Tab</h3>
                                    <p className="text-[11px] text-ink-mute">Destination Columns</p>
                                </div>
                            </div>
                            <button className="text-[10px] font-bold uppercase text-ink-mute hover:text-ink px-2 py-0.5 rounded transition-colors border border-line flex items-center bg-canvas">
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
                                <div key={col.name} className="flex flex-col p-2.5 bg-canvas border border-line rounded-md hover:border-[#333] transition-colors relative overflow-hidden group">
                                    {col.hasRule && (
                                        <div className="absolute top-1 right-1">
                                            <Sparkles className="w-3 h-3 text-accent" />
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-xs font-semibold text-ink">{col.name}</span>
                                        <span className="text-[10px] uppercase font-mono text-ink-mute bg-panel px-1.5 py-0.5 rounded border border-line">{col.type}</span>
                                    </div>
                                    <div className="flex items-center text-[11px] text-accent bg-panel px-2 py-0.5 rounded border border-line self-start">
                                        <code className="font-mono">{col.mappedFrom}</code>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>
            )}

            {activeTab === 'cleansing' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 bg-panel border border-line rounded-lg p-6">
                        <h3 className="text-base font-bold text-ink mb-4 flex items-center">
                            <Sparkles className="w-4 h-4 text-accent mr-2" />
                            Active Cleansing Rules
                        </h3>

                        <div className="space-y-4">
                            {/* Rule 1 */}
                            <div className="flex items-start space-x-3.5 p-4 bg-canvas rounded-lg border border-line">
                                <div className="p-2 bg-panel border border-line text-accent rounded-md shrink-0">
                                    <Settings2 className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-semibold text-ink text-xs">Mask PII (Username)</h4>
                                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-panel text-accent rounded border border-line">Active</span>
                                    </div>
                                    <p className="text-xs text-ink-mute mb-3">Converts &apos;buyer_username&apos; to a secure, anonymized SHA-256 hash before writing to the destination.</p>
                                    <div className="bg-panel border border-line rounded-md p-2.5 overflow-x-auto text-[11px] text-accent font-mono">
                                        <span>HASH</span>(<span>shopee.buyer_username</span>, &apos;sha256&apos;) <span className="text-ink-mute">-&gt; Destination.&apos;Customer Name&apos;</span>
                                    </div>
                                </div>
                            </div>

                            {/* Rule 2 */}
                            <div className="flex items-start space-x-3.5 p-4 bg-canvas rounded-lg border border-line">
                                <div className="p-2 bg-panel border border-line text-accent rounded-md shrink-0">
                                    <Database className="w-4 h-4" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <h4 className="font-semibold text-ink text-xs">Currency Normalization</h4>
                                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-panel text-accent rounded border border-line">Active</span>
                                    </div>
                                    <p className="text-xs text-ink-mute mb-3">Converts &apos;total_amount&apos; from integer cents to localized decimal currency format.</p>
                                    <div className="bg-panel border border-line rounded-md p-2.5 overflow-x-auto text-[11px] text-accent font-mono">
                                        <span>DIVIDE</span>(<span>shopee.total_amount</span>, 100) <span className="text-ink-mute">-&gt; Destination.&apos;Revenue&apos;</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <button className="mt-6 w-full py-2.5 border border-dashed border-line rounded-md text-xs font-medium text-ink-mute hover:text-ink hover:border-[#444] transition-colors flex items-center justify-center">
                            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Rule
                        </button>
                    </div>

                    <div className="bg-panel border border-line rounded-lg p-6 h-fit">
                        <AlertCircle className="w-5 h-5 text-accent mb-3" />
                        <h4 className="font-bold text-ink text-sm mb-2">Why transform data?</h4>
                        <p className="text-xs text-ink-mute mb-4 leading-relaxed">
                            Transformations run securely isolated on Monstera Cloud infrastructure. They allow you to structure and sanitize your data exactly as your analysts need it before they ever run a query.
                        </p>
                        <ul className="text-xs text-ink-mute space-y-2">
                            <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 text-accent mr-2" /> PII Masking</li>
                            <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 text-accent mr-2" /> Data Type Casting</li>
                            <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 text-accent mr-2" /> Currency Conversion</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
