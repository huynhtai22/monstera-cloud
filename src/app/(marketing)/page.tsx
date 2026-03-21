"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Database, Zap, Lock, BarChart3, ChevronRight, Activity, Terminal } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function MarketingPage() {
    return (
        <div className="flex flex-col items-center bg-[#000000] text-slate-200 w-full selection:bg-emerald-500/30 overflow-hidden font-sans">
            
            {/* HER0 SECTION */}
            <section className="relative w-full min-h-[90vh] flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-white/5">
                
                {/* Hyper-subtle background glows for pitch black */}
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-emerald-500/10 blur-[120px] rounded-[50%] pointer-events-none" />
                
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

                <div className="relative z-10 w-full max-w-5xl mx-auto text-center flex flex-col items-center">
                    
                    {/* Eyebrow */}
                    <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold tracking-widest uppercase mb-8">
                        <span className="relative flex h-2 w-2 mr-1">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Enterprise Data Engine Live
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter leading-[1.05] drop-shadow-sm mb-6 max-w-4xl">
                        Real-time synchronization. <br className="hidden md:block"/>
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">Zero middleware.</span>
                    </h1>

                    <p className="text-lg md:text-xl text-gray-400 max-w-2xl mb-10 leading-relaxed font-medium">
                        The institutional-grade data engine for high-velocity e-commerce. Automatically pipe production data from Shopee, TikTok, and Postgres directly into your warehouse with absolute integrity.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 w-full">
                        <Link
                            href="/register"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] transition-all"
                        >
                            Initialize Environment
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </Link>
                        <Link
                            href="/documentation"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 rounded transition-all"
                        >
                            <Terminal className="w-4 h-4 mr-2 text-gray-400" />
                            Read Documentation
                        </Link>
                    </div>
                </div>

                {/* Sub-Hero "Integrates With" Band */}
                <div className="absolute bottom-0 w-full border-t border-white/5 bg-[#050505]/80 backdrop-blur-md py-6 z-10">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest text-center md:text-left">
                            Supported Datasets
                        </p>
                        <div className="flex items-center justify-center space-x-8 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
                            <Image src="/logos/shopee.svg" alt="Shopee API" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                            <Image src="/logos/tiktok.svg" alt="TikTok Shop API" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                            <Image src="/logos/postgres.svg" alt="PostgreSQL" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                            <Image src="/logos/bigquery.svg" alt="BigQuery" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                        </div>
                    </div>
                </div>
            </section>

            {/* BENTO BOX FEATURES GRID */}
            <section className="w-full py-32 px-4 sm:px-6 lg:px-8 bg-[#000000] relative">
                <div className="max-w-7xl mx-auto">
                    <div className="mb-16">
                        <h2 className="text-3xl font-bold text-white tracking-tight mb-4">Engineered for Scale.</h2>
                        <p className="text-gray-400 text-lg max-w-2xl">Stop writing arbitrary extraction scripts. Monstera provides highly available, fault-tolerant pipelines out of the box.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        {/* Bento Item 1 - Large */}
                        <div className="md:col-span-2 relative group bg-[#050505] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-emerald-500/50 transition-colors">
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent pointer-events-none" />
                            <Database className="w-8 h-8 text-emerald-400 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Real-Time Sync Engine</h3>
                            <p className="text-sm text-gray-400 max-w-md">Our proprietary webhook ingestion architecture ensures your downstream databases reflect order state changes within milliseconds, bypassing legacy batch limits.</p>
                        </div>

                        {/* Bento Item 2 */}
                        <div className="relative group bg-[#050505] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-white/30 transition-colors">
                            <Activity className="w-8 h-8 text-blue-400 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Granular Telemetry</h3>
                            <p className="text-sm text-gray-400">Monitor absolute payload statuses, latency metrics, and API hit rates via our high-density terminal dashboard.</p>
                        </div>

                        {/* Bento Item 3 */}
                        <div className="relative group bg-[#050505] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-white/30 transition-colors">
                            <Lock className="w-8 h-8 text-amber-400 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Encrypted at Rest</h3>
                            <p className="text-sm text-gray-400">All credentials are HMAC-SHA256 encrypted using AES-256 protocols within our isolated Neon scaling environments.</p>
                        </div>

                        {/* Bento Item 4 - Large Image/Mockup Block */}
                        <div className="md:col-span-2 relative group bg-[#050505] rounded-xl border border-white/10 p-0 overflow-hidden hover:border-emerald-500/50 transition-colors flex flex-col md:flex-row items-center">
                            <div className="p-8 md:w-1/2">
                                <BarChart3 className="w-8 h-8 text-cyan-400 mb-6" />
                                <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Direct to BigQuery</h3>
                                <p className="text-sm text-gray-400 mb-6">Bypass spreadsheets. Route massive datasets directly into Google BigQuery and Snowflake for authoritative BI analysis.</p>
                                <Link href="/register" className="text-emerald-400 text-sm font-bold flex items-center hover:text-emerald-300">
                                    Explore Destinations <ArrowRight className="w-4 h-4 ml-1" />
                                </Link>
                            </div>
                            <div className="md:w-1/2 h-full flex items-center justify-end p-4">
                                <div className="w-full h-48 bg-[#0a0a0a] rounded border border-white/5 relative overflow-hidden flex flex-col">
                                    <div className="h-6 border-b border-white/5 flex items-center px-2 space-x-1">
                                        <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
                                        <div className="w-2 h-2 rounded-full bg-amber-500/50"></div>
                                        <div className="w-2 h-2 rounded-full bg-emerald-500/50"></div>
                                    </div>
                                    <div className="flex-1 p-3 text-[10px] text-emerald-400 font-mono flex flex-col space-y-2 opacity-80">
                                        <p>[SYS] INITIATING SHOPEE_SYNC_PROTOCOL</p>
                                        <p className="text-gray-500">AUTH: VERIFIED via HMAC_256</p>
                                        <p>[DATA] EXTRACTING /orders/v2 [1480 ROWS]</p>
                                        <p className="text-blue-400">[DEST] WRITING TO BIGQUERY _PRD...</p>
                                        <p className="text-emerald-400 font-bold">SUCCESS: 200 OK (1.2s LATENCY)</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>
            
            {/* CTA SECTION */}
            <section className="w-full py-32 px-4 sm:px-6 lg:px-8 border-t border-white/10 relative overflow-hidden bg-[#050505]">
                <div className="absolute inset-0 bg-emerald-500/5 pointer-events-none"></div>
                <div className="max-w-4xl mx-auto text-center relative z-10">
                    <h2 className="text-4xl font-extrabold text-white tracking-tighter mb-6">Ready to scale your architecture?</h2>
                    <p className="text-lg text-gray-400 mb-10">Deploy your first pipeline in under 60 seconds.</p>
                    <Link
                        href="/register"
                        className="inline-flex items-center justify-center px-8 py-4 text-sm font-bold text-black bg-white hover:bg-gray-200 rounded transition-all"
                    >
                        Create Free Account
                        <ChevronRight className="ml-1 w-5 h-5" />
                    </Link>
                    <p className="mt-4 text-xs tracking-wider text-gray-500 font-medium">NO CREDIT CARD REQUIRED • SOC2 COMPLIANT</p>
                </div>
            </section>
        </div>
    );
}
