"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft, ShieldCheck, Database, Zap, Lock, Building2, CheckCircle2 } from "lucide-react";
import { DataStreamBackground } from "@/components/DataStreamBackground";

export default function AgenciesSolutionPage() {
    return (
        <div className="flex flex-col items-center bg-[#09090b] text-slate-200 w-full selection:bg-cyan-500/30 overflow-hidden font-sans">
            
            {/* HERO SECTION */}
            <section className="relative w-full min-h-[85vh] flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-white/5 bg-[#09090b]">
                <DataStreamBackground />
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_60%,transparent_100%)] pointer-events-none opacity-50 z-0" />

                <div className="relative z-10 w-full max-w-5xl mx-auto text-center flex flex-col items-center">
                    
                    <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-xs font-semibold tracking-widest uppercase mb-8 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
                        <Building2 className="w-3 h-3 mr-1" /> For APAC Agencies & Aggregators
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter leading-[1.05] mb-6 max-w-4xl">
                        Manage 50+ seller accounts.<br className="hidden md:block"/>
                        <span className="text-cyan-500">Zero infrastructure code.</span>
                    </h1>

                    <p className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto mb-10 leading-relaxed font-medium">
                        The ultimate multi-tenant data fabric for e-commerce enablers. Aggregate client data from Shopee, Lazada, and TikTok into isolated, PDPA-compliant BigQuery enclaves.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 w-full">
                        <Link
                            href="/register"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-500 rounded transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                        >
                            Provision Agency Fabric
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </Link>
                        <Link
                            href="/pricing"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 rounded transition-all"
                        >
                            View Enterprise Pricing
                        </Link>
                    </div>
                </div>
            </section>

            {/* AGENCY CAPABILITIES GRID */}
            <section className="w-full py-32 px-4 sm:px-6 lg:px-8 bg-[#09090b] relative">
                <div className="max-w-7xl mx-auto">
                    <div className="mb-16">
                        <h2 className="text-3xl font-bold text-white tracking-tight mb-4">Architected for Aggregation.</h2>
                        <p className="text-gray-400 text-lg max-w-2xl">Stop building brittle cron jobs per client. Monstera Cloud normalizes APAC marketplace APIs into a unified analytical schema.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        
                        {/* Capability 1 */}
                        <div className="bg-[#18181b] rounded-xl border border-white/10 p-8 hover:border-cyan-500/30 transition-all group flex flex-col">
                            <Database className="w-8 h-8 text-cyan-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Multi-Tenant Routing</h3>
                            <p className="text-sm text-gray-400 flex-1">
                                Securely map distinct Shopee/Lazada seller IDs to strictly isolated BigQuery datasets. Prevent cross-contamination of client PII with hardware-level isolation.
                            </p>
                        </div>

                        {/* Capability 2 */}
                        <div className="bg-[#18181b] rounded-xl border border-white/10 p-8 hover:border-emerald-500/30 transition-all group flex flex-col">
                            <ShieldCheck className="w-8 h-8 text-emerald-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Vietnam PDPA Compliant</h3>
                            <p className="text-sm text-gray-400 flex-1">
                                Stay ahead of 2026 regulations. We automatically mask buyer phone numbers and raw PII before it even hits your data warehouse, generating instant audit logs.
                            </p>
                        </div>

                        {/* Capability 3 */}
                        <div className="bg-[#18181b] rounded-xl border border-white/10 p-8 hover:border-purple-500/30 transition-all group flex flex-col">
                            <Zap className="w-8 h-8 text-purple-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Flash-Sale Resiliency</h3>
                            <p className="text-sm text-gray-400 flex-1">
                                Our Vercel Edge ingesters elastically scale to absorb millions of webhooks during peak 11.11 campaigns across your entire client portfolio without dropping payloads.
                            </p>
                        </div>

                    </div>
                </div>
            </section>

            {/* DEMO / ARCHITECTURE SECTION */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-[#09090b]">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-16">
                    <div className="md:w-1/2">
                        <h2 className="text-3xl font-extrabold text-white tracking-tighter mb-6 relative">
                            The "Query-Once" Hierarchy.
                            <div className="absolute -left-6 top-2 bottom-2 w-1 bg-cyan-500 rounded-full"></div>
                        </h2>
                        <p className="text-gray-400 mb-8 leading-relaxed">
                            For agencies, maintaining 50 different API connectors is a nightmare. Monstera standardizes the output of Shopee, TikTok, and Lazada into a single, unified analytical schema.
                        </p>
                        <ul className="space-y-4 mb-8">
                            <li className="flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-cyan-500 shrink-0" />
                                <span className="text-gray-300 text-sm">Deploy unified Looker Studio dashboards across multiple clients.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-cyan-500 shrink-0" />
                                <span className="text-gray-300 text-sm">Run aggressive cross-brand aggregations for market insights.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-cyan-500 shrink-0" />
                                <span className="text-gray-300 text-sm">Issue restricted BigQuery viewing roles directly to your clients.</span>
                            </li>
                        </ul>
                    </div>

                    <div className="md:w-1/2 w-full">
                         {/* Terminal Mockup */}
                         <div className="bg-[#18181b] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
                            <div className="bg-[#09090b] px-4 py-3 flex items-center border-b border-white/5">
                                <div className="flex space-x-2">
                                    <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                                    <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                    <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
                                </div>
                                <div className="mx-auto text-xs text-gray-500 font-mono">agency_pipeline_router.yaml</div>
                            </div>
                            <div className="p-6 font-mono text-xs sm:text-sm text-gray-300 leading-relaxed overflow-x-auto">
                                <p><span className="text-pink-500">routes:</span></p>
                                <p className="pl-4"><span className="text-cyan-400">- client_id:</span> "brand_alpha_vn"</p>
                                <p className="pl-8"><span className="text-gray-500">source:</span> shopee_v2_api</p>
                                <p className="pl-8"><span className="text-gray-500">destination:</span> bigquery.agency.alpha_dataset</p>
                                <p className="pl-8"><span className="text-emerald-400">pii_masking:</span> true</p>
                                <p className="mt-4 pl-4"><span className="text-cyan-400">- client_id:</span> "brand_omega_sg"</p>
                                <p className="pl-8"><span className="text-gray-500">source:</span> tiktok_shop_api</p>
                                <p className="pl-8"><span className="text-gray-500">destination:</span> bigquery.agency.omega_dataset</p>
                                <p className="pl-8"><span className="text-emerald-400">pii_masking:</span> true</p>
                                <p className="mt-4 text-gray-500"># 48 more clients authenticated...</p>
                                <p className="mt-4 text-emerald-500 font-bold">[SYS] FABRIC DEPLOYMENT HEALTHY.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

             <div className="py-16 text-center border-t border-white/5">
                <Link href="/" className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-white transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                </Link>
            </div>

        </div>
    );
}
