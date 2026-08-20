"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, BarChart3, Receipt, Tag, ShieldCheck } from "lucide-react";

export default function TemplatesPage() {
    return (
        <div className="min-h-screen pt-32 pb-24 bg-canvas text-ink font-sans overflow-hidden">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                
                {/* Header */}
                <div className="text-center space-y-4 mb-16">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                        <span>Dashboard Templates</span>
                    </div>
                    <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-ink">
                        Turn raw metrics into <br className="hidden md:block"/>
                        <span className="text-accent">Business Intelligence.</span>
                    </h1>
                    <p className="text-sm sm:text-base text-ink-mute max-w-2xl mx-auto mt-3 font-normal">
                        Preview patterns for future work. Pilot users access normalized warehouse data through Data Explorer, Google Sheets™, Looker Studio™, and API.
                    </p>
                </div>

                {/* Templates Grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    
                    {/* Template 1: COD */}
                    <div className="bg-panel border border-line rounded-lg p-6 flex flex-col h-full">
                        <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                            <Receipt className="w-5 h-5" />
                        </div>
                        <h3 className="text-base font-bold text-ink mb-2">COD Reconciliation Engine</h3>
                        <p className="text-xs text-ink-mute mb-6 flex-1 leading-relaxed">
                            Automatically reconcile Cash-on-Delivery (COD) statuses across Shopee and TikTok. Instantly flag missing remittances and logistics discrepancies.
                        </p>
                        <div className="pt-5 border-t border-line mt-auto">
                            <div className="text-[11px] font-bold text-ink-mute uppercase tracking-wider mb-3">
                                <span>Includes</span>
                            </div>
                            <ul className="space-y-1.5 mb-6 text-xs text-ink-mute">
                                <li className="flex items-center"><span className="w-1 h-1 rounded-full bg-accent mr-2"></span>Looker Studio report template</li>
                                <li className="flex items-center"><span className="w-1 h-1 rounded-full bg-accent mr-2"></span>Google Sheets™ summary view</li>
                            </ul>
                            <Link href="/register" className="inline-flex items-center text-xs font-semibold text-accent hover:underline">
                                Deploy Template <ArrowRight className="w-3.5 h-3.5 ml-1" />
                            </Link>
                        </div>
                    </div>

                    {/* Template 2: Voucher Stacking */}
                    <div className="bg-panel border border-line rounded-lg p-6 flex flex-col h-full">
                        <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                            <Tag className="w-5 h-5" />
                        </div>
                        <h3 className="text-base font-bold text-ink mb-2">Voucher Stacking Margin Analyzer</h3>
                        <p className="text-xs text-ink-mute mb-6 flex-1 leading-relaxed">
                            Decode complex multi-layer discounts. Separate platform subsidies from seller-funded vouchers to calculate true net margin per SKU.
                        </p>
                        <div className="pt-5 border-t border-line mt-auto">
                            <div className="text-[11px] font-bold text-ink-mute uppercase tracking-wider mb-3">
                                <span>Includes</span>
                            </div>
                            <ul className="space-y-1.5 mb-6 text-xs text-ink-mute">
                                <li className="flex items-center"><span className="w-1 h-1 rounded-full bg-accent mr-2"></span>Looker Studio report template</li>
                                <li className="flex items-center"><span className="w-1 h-1 rounded-full bg-accent mr-2"></span>Google Sheets™ margin tracker</li>
                            </ul>
                            <Link href="/register" className="inline-flex items-center text-xs font-semibold text-accent hover:underline">
                                Deploy Template <ArrowRight className="w-3.5 h-3.5 ml-1" />
                            </Link>
                        </div>
                    </div>

                    {/* Template 3: 11.11 Tracker */}
                    <div className="bg-panel border border-line rounded-lg p-6 flex flex-col h-full">
                        <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                            <BarChart3 className="w-5 h-5" />
                        </div>
                        <h3 className="text-base font-bold text-ink mb-2">11.11 Mega-Campaign Tracker</h3>
                        <p className="text-xs text-ink-mute mb-6 flex-1 leading-relaxed">
                            Concept preview for GMV surge tracking with warehouse-backed ROAS and spend reporting across regional ad channels.
                        </p>
                        <div className="pt-5 border-t border-line mt-auto">
                            <div className="text-[11px] font-bold text-ink-mute uppercase tracking-wider mb-3">
                                <span>Includes</span>
                            </div>
                            <ul className="space-y-1.5 mb-6 text-xs text-ink-mute">
                                <li className="flex items-center"><span className="w-1 h-1 rounded-full bg-accent mr-2"></span>Live Looker report</li>
                                <li className="flex items-center"><span className="w-1 h-1 rounded-full bg-accent mr-2"></span>Cross-channel aggregation</li>
                            </ul>
                            <Link href="/register" className="w-full inline-flex items-center justify-center p-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-200 rounded-md transition-colors shadow-xs">
                                Initialize Campaign Hub
                            </Link>
                        </div>
                    </div>

                </div>

                {/* Bottom Architectural Note */}
                <div className="mt-20 p-6 border border-line rounded-lg bg-panel flex flex-col md:flex-row items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="w-4 h-4 text-accent" />
                            <h4 className="text-sm font-bold text-ink">Open Architecture</h4>
                        </div>
                        <p className="text-xs text-ink-mute max-w-xl leading-relaxed">
                            Templates are illustrative companions to the live app: you own the Sheets and Looker assets you create; Monstera handles extraction and refresh into those surfaces.
                        </p>
                    </div>
                    <div>
                        <Link href="/docs#architecture" className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-ink bg-canvas border border-line hover:bg-[#16181c] rounded-md transition-colors whitespace-nowrap">
                            Read Architecture Docs
                        </Link>
                    </div>
                </div>

                <div className="mt-14 text-center">
                    <Link href="/" className="inline-flex items-center text-xs font-medium text-ink-mute hover:text-ink transition-colors">
                        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                    </Link>
                </div>

            </div>
        </div>
    );
}
