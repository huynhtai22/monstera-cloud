"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, BarChart3, Receipt, Tag, ShieldCheck, ChevronRight } from "lucide-react";

export default function TemplatesPage() {
    return (
        <div className="min-h-screen pt-32 pb-24 bg-[#09090b] font-sans overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                
                {/* Header */}
                <div className="text-center space-y-4 mb-20">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-purple-400 border border-purple-500/20 bg-purple-500/10 tracking-widest uppercase mb-4 shadow-[0_0_15px_rgba(168,85,247,0.15)]">
                        1-Click ROI Templates
                    </div>
                    <h1 className="text-white text-4xl md:text-6xl font-extrabold leading-[1.05] tracking-tighter">
                        Turn raw JSON into <br className="hidden md:block"/>
                        <span className="text-purple-500">Business Intelligence.</span>
                    </h1>
                    <p className="text-gray-400 text-lg md:text-xl font-normal max-w-2xl mx-auto mt-4">
                        Stop reverse-engineering Shopee and Lazada APIs. Deploy our opinionated BigQuery schemas and Looker Studio dashboards in 60 seconds.
                    </p>
                </div>

                {/* Templates Grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    
                    {/* Template 1: COD */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 hover:border-purple-500/30 transition-all group flex flex-col h-full relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-purple-500/10"></div>
                        <Receipt className="w-10 h-10 text-emerald-500 mb-6" />
                        <h3 className="text-white text-xl font-bold tracking-tight mb-3">COD Reconciliation Engine</h3>
                        <p className="text-sm text-gray-400 mb-6 flex-1">
                            Automatically reconcile Cash-on-Delivery (COD) statuses across Shopee and TikTok. Instantly flag missing remittances and logistics discrepancies.
                        </p>
                        <div className="pt-6 border-t border-white/5 mt-auto">
                            <div className="flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
                                <span>Includes</span>
                            </div>
                            <ul className="space-y-2 mb-6">
                                <li className="text-sm text-gray-300 flex items-center before:content-[''] before:w-1 before:h-1 before:bg-emerald-500 before:rounded-full before:mr-2">Looker Studio Dashboard</li>
                                <li className="text-sm text-gray-300 flex items-center before:content-[''] before:w-1 before:h-1 before:bg-emerald-500 before:rounded-full before:mr-2">dbt Core Models</li>
                            </ul>
                            <Link href="/register" className="inline-flex items-center text-sm font-semibold text-white hover:text-purple-400 transition-colors">
                                Deploy Template <ArrowRight className="w-4 h-4 ml-1" />
                            </Link>
                        </div>
                    </div>

                    {/* Template 2: Voucher Stacking */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 hover:border-purple-500/30 transition-all group flex flex-col h-full relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-purple-500/10"></div>
                        <Tag className="w-10 h-10 text-amber-500 mb-6" />
                        <h3 className="text-white text-xl font-bold tracking-tight mb-3">Voucher Stacking Margin Analyzer</h3>
                        <p className="text-sm text-gray-400 mb-6 flex-1">
                            Decode complex multi-layer discounts. Separate platform subsidies from seller-funded vouchers to calculate true net margin per SKU.
                        </p>
                        <div className="pt-6 border-t border-white/5 mt-auto">
                            <div className="flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
                                <span>Includes</span>
                            </div>
                            <ul className="space-y-2 mb-6">
                                <li className="text-sm text-gray-300 flex items-center before:content-[''] before:w-1 before:h-1 before:bg-amber-500 before:rounded-full before:mr-2">Metabase SQL Views</li>
                                <li className="text-sm text-gray-300 flex items-center before:content-[''] before:w-1 before:h-1 before:bg-amber-500 before:rounded-full before:mr-2">BigQuery Materialized Tables</li>
                            </ul>
                            <Link href="/register" className="inline-flex items-center text-sm font-semibold text-white hover:text-purple-400 transition-colors">
                                Deploy Template <ArrowRight className="w-4 h-4 ml-1" />
                            </Link>
                        </div>
                    </div>

                    {/* Template 3: 11.11 Tracker */}
                    <div className="bg-[#18181b] border-2 border-purple-500/30 rounded-xl p-6 hover:border-purple-500 transition-all group flex flex-col h-full relative overflow-hidden shadow-[0_0_30px_rgba(168,85,247,0.05)] md:-translate-y-2">
                         <div className="absolute top-0 inset-x-0 bg-purple-500/20 text-purple-300 text-[10px] font-bold px-4 py-1.5 text-center uppercase tracking-widest border-b border-purple-500/30 z-10 backdrop-blur-sm">
                            Most Deployed
                        </div>
                        <div className="absolute top-0 right-0 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl -mr-16 -mt-16 transition-all group-hover:bg-purple-500/20"></div>
                        <BarChart3 className="w-10 h-10 text-purple-400 mb-6 mt-4 relative z-10" />
                        <h3 className="text-white text-xl font-bold tracking-tight mb-3 relative z-10">11.11 Mega-Campaign Tracker</h3>
                        <p className="text-sm text-gray-400 mb-6 flex-1 relative z-10">
                            Real-time GMV surge tracking designed for extreme flash-sale spikes. Monitor hourly run-rates, out-of-stock risks, and webhook ingestion latency.
                        </p>
                        <div className="pt-6 border-t border-white/10 mt-auto relative z-10">
                            <div className="flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">
                                <span>Includes</span>
                            </div>
                            <ul className="space-y-2 mb-6">
                                <li className="text-sm text-white font-medium flex items-center before:content-[''] before:w-1.5 before:h-1.5 before:bg-purple-500 before:rounded-full before:mr-2">Live Looker Dashboard</li>
                                <li className="text-sm text-white font-medium flex items-center before:content-[''] before:w-1.5 before:h-1.5 before:bg-purple-500 before:rounded-full before:mr-2">Slack Alerting Integration</li>
                            </ul>
                            <Link href="/register" className="w-full inline-flex items-center justify-center p-3 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-all shadow-[0_0_15px_rgba(168,85,247,0.4)]">
                                Initialize Campaign Hub
                            </Link>
                        </div>
                    </div>

                </div>

                {/* Bottom Architectural Note */}
                <div className="mt-24 p-8 border border-white/10 rounded-xl bg-[#18181b] flex flex-col md:flex-row items-center justify-between gap-8">
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <ShieldCheck className="w-5 h-5 text-emerald-500" />
                            <h4 className="text-white font-bold tracking-tight">Open Architecture</h4>
                        </div>
                        <p className="text-sm text-gray-400 max-w-xl">
                            All templates are entirely open-source. You retain 100% ownership of the BigQuery tables, dbt models, and Looker Studio files. We provide the extraction engine; you control the presentation.
                        </p>
                    </div>
                    <div>
                        <Link href="/docs#architecture" className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 rounded transition-all whitespace-nowrap">
                            Read Architecture Docs
                        </Link>
                    </div>
                </div>

                <div className="mt-16 text-center">
                    <Link href="/" className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-white transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                    </Link>
                </div>

            </div>
        </div>
    );
}
