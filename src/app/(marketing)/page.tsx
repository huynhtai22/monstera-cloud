"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Database, Lock, BarChart3, ChevronRight, Table2, ShoppingCart, TrendingUp } from "lucide-react";
import { DataStreamBackground } from "@/components/DataStreamBackground";

export default function MarketingPage() {
    return (
        <div className="flex flex-col items-center bg-[#09090b] text-slate-200 w-full selection:bg-emerald-500/30 overflow-hidden font-sans">
            
            {/* HERO SECTION */}
            <section className="relative w-full min-h-[90vh] flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-white/5 bg-[#09090b]">
                
                <DataStreamBackground />

                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_60%,transparent_100%)] pointer-events-none opacity-50 z-0" />

                <div className="relative z-10 w-full max-w-5xl mx-auto text-center flex flex-col items-center">
                    
                    <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold tracking-widest uppercase mb-8">
                        <span className="relative flex h-2 w-2 mr-1">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Now Live
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold text-white tracking-tighter leading-[1.05] mb-6 max-w-4xl">
                        <span className="block text-2xl md:text-3xl font-bold text-emerald-400 mb-2 tracking-normal">Monstera Cloud</span>
                        Your e-commerce data. <br className="hidden md:block"/>
                        <span className="text-emerald-500">In Google Sheets™.</span>
                    </h1>

                    <p className="text-lg md:text-xl text-gray-400 max-w-2xl mb-10 leading-relaxed font-medium">
                        Connect TikTok Ads, Shopee, and more. Pull ad performance, orders, and product data directly into Google Sheets™ or your console. Built for sellers and agencies in Vietnam and Southeast Asia.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-4 w-full">
                        <Link
                            href="/register"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded transition-all"
                        >
                            Get Started Free
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </Link>
                        <Link
                            href="/pricing"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-white bg-white/5 border border-white/10 hover:bg-white/10 rounded transition-all"
                        >
                            View Pricing
                        </Link>
                    </div>
                </div>

                <div className="absolute bottom-0 w-full border-t border-white/5 bg-[#09090b]/80 backdrop-blur-md py-6 z-10">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-center gap-6 md:gap-12">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest text-center md:text-left">
                            Integrates With
                        </p>
                        <div className="flex items-center justify-center space-x-8 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
                            <Image src="/logos/tiktok.svg" alt="TikTok Ads" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                            <Image src="/logos/shopee.svg" alt="Shopee" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                            <Image src="/logos/gsheets.svg" alt="Google Sheets™" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                        </div>
                    </div>
                </div>
            </section>

            {/* FEATURES GRID */}
            <section className="w-full py-32 px-4 sm:px-6 lg:px-8 bg-[#09090b] relative">
                <div className="max-w-7xl mx-auto">
                    <div className="mb-16">
                        <h2 className="text-3xl font-bold text-white tracking-tight mb-4">Everything you need to track ad performance.</h2>
                        <p className="text-gray-400 text-lg max-w-2xl">Stop copying data manually. Monstera connects your platforms and delivers clean, ready-to-analyze data wherever you need it.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        <div className="md:col-span-2 relative group bg-[#18181b] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-white/20 transition-colors">
                            <TrendingUp className="w-8 h-8 text-emerald-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">TikTok Ads Reports</h3>
                            <p className="text-sm text-gray-400 max-w-md">Connect your TikTok Business account via OAuth. Choose dimensions (campaign, ad group, ad), pick metrics (spend, impressions, clicks, conversions), set a date range, and get results instantly.</p>
                        </div>

                        <div className="relative group bg-[#18181b] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-white/20 transition-colors">
                            <ShoppingCart className="w-8 h-8 text-orange-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Shopee Data Explorer</h3>
                            <p className="text-sm text-gray-400">Pull orders, products, and shop info from your Shopee seller account. Filter by date, status, and export to CSV with one click.</p>
                        </div>

                        <div className="relative group bg-[#18181b] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-white/20 transition-colors">
                            <Lock className="w-8 h-8 text-amber-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Secure by Default</h3>
                            <p className="text-sm text-gray-400">All connections use OAuth with encrypted token storage. Your API credentials are never exposed to the browser. Data is transmitted over TLS.</p>
                        </div>

                        <div className="md:col-span-2 relative group bg-[#18181b] rounded-xl border border-white/10 p-0 overflow-hidden hover:border-white/20 transition-colors flex flex-col md:flex-row items-center">
                            <div className="p-8 md:w-1/2">
                                <Table2 className="w-8 h-8 text-cyan-500 mb-6" />
                                <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Google Sheets™ Add-on</h3>
                                <p className="text-sm text-gray-400 mb-6">Install our Google Sheets™ add-on, pick your data source and metrics from a sidebar, and write results directly into your spreadsheet. Set auto-refresh from 1 hour to daily.</p>
                                <Link href="/register" className="text-white text-sm font-bold flex items-center hover:text-emerald-500 transition-colors">
                                    Try It Free <ArrowRight className="w-4 h-4 ml-1" />
                                </Link>
                            </div>
                            <div className="md:w-1/2 h-full flex items-center justify-end p-4">
                                <div className="w-full h-48 bg-[#09090b] rounded border border-white/10 relative overflow-hidden flex flex-col">
                                    <div className="h-6 border-b border-white/5 flex items-center px-2 space-x-1">
                                        <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
                                        <div className="w-2 h-2 rounded-full bg-amber-500/50"></div>
                                        <div className="w-2 h-2 rounded-full bg-emerald-500/50"></div>
                                    </div>
                                    <div className="flex-1 p-3 text-[10px] text-gray-300 font-mono flex flex-col space-y-2 opacity-80">
                                        <p className="text-emerald-500">[SHEETS] Monstera Cloud Add-on</p>
                                        <p className="text-gray-500">Source: TikTok Ads | Level: Campaign</p>
                                        <p>[QUERY] spend, impressions, clicks, ctr</p>
                                        <p className="text-blue-500">[WRITE] Inserting 47 rows → Sheet1!A1...</p>
                                        <p className="text-emerald-500 block font-bold">DONE: Data refreshed (0.8s)</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="relative group bg-[#18181b] rounded-xl border border-white/10 p-8 overflow-hidden hover:border-white/20 transition-colors">
                            <Database className="w-8 h-8 text-blue-500 mb-6" />
                            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Multi-Platform Console</h3>
                            <p className="text-sm text-gray-400">View TikTok Ads and Shopee data side by side. Connect multiple accounts per workspace. Export any view to CSV.</p>
                        </div>

                        <div className="md:col-span-2 relative group bg-[#18181b] rounded-xl border border-white/10 p-0 overflow-hidden hover:border-white/20 transition-colors flex flex-col md:flex-row items-center border-l-4 border-l-emerald-500/30 hover:border-l-emerald-500 transition-all">
                            <div className="p-8 md:w-1/2 z-10">
                                <BarChart3 className="w-8 h-8 text-emerald-500 mb-6" />
                                <h3 className="text-xl font-bold text-white mb-3 tracking-tight">Built for Southeast Asia</h3>
                                <p className="text-sm text-gray-400 mb-6">Designed for Vietnamese sellers and agencies managing TikTok Shop and Shopee. Pay in VND or USD. Additional APAC connectors are on the roadmap.</p>
                                <Link href="/pricing" className="text-white text-sm font-bold flex items-center hover:text-emerald-400 transition-colors">
                                    See Plans <ArrowRight className="w-4 h-4 ml-1" />
                                </Link>
                            </div>
                            <div className="md:w-1/2 h-full flex items-center justify-end p-4 z-0">
                                <div className="w-full h-48 bg-[#09090b] rounded border border-white/10 relative overflow-hidden flex flex-col p-5 opacity-70 group-hover:opacity-100 transition-opacity shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]">
                                    <div className="w-1/2 h-2.5 bg-white/10 rounded mb-6"></div>
                                    <div className="flex space-x-3 h-20 items-end mb-4">
                                        <div className="w-1/4 h-8 bg-emerald-500/20 rounded-t border-t border-emerald-500/50 hover:bg-emerald-500/30 transition-colors"></div>
                                        <div className="w-1/4 h-12 bg-emerald-500/20 rounded-t border-t border-emerald-500/50 hover:bg-emerald-500/30 transition-colors"></div>
                                        <div className="w-1/4 h-16 bg-emerald-500/20 rounded-t border-t border-emerald-500/50 hover:bg-emerald-500/30 transition-colors"></div>
                                        <div className="w-1/4 h-full bg-emerald-500/40 rounded-t border-t border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:bg-emerald-500/50 transition-colors"></div>
                                    </div>
                                    <div className="flex justify-between items-center mt-auto border-t border-white/5 pt-3">
                                        <div className="w-1/3 h-1.5 bg-white/5 rounded"></div>
                                        <div className="text-[10px] text-emerald-500 font-bold tracking-wider">VND + USD Billing</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>
            
            {/* CTA SECTION */}
            <section className="w-full py-32 px-4 sm:px-6 lg:px-8 border-t border-white/5 relative overflow-hidden bg-[#09090b]">
                <div className="max-w-4xl mx-auto text-center relative z-10">
                    <h2 className="text-4xl font-extrabold text-white tracking-tighter mb-6">Ready to consolidate your e-commerce data?</h2>
                    <p className="text-lg text-gray-400 mb-10">Connect your first data source in under 60 seconds.</p>
                    <Link
                        href="/register"
                        className="inline-flex items-center justify-center px-8 py-4 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded transition-all shadow-sm hover:shadow"
                    >
                        Create Free Account
                        <ChevronRight className="ml-1 w-5 h-5" />
                    </Link>
                    <p className="mt-5 text-xs tracking-wider text-gray-500 font-medium flex items-center justify-center space-x-4">
                        <span>NO CREDIT CARD REQUIRED</span> 
                        <span className="w-1 h-1 rounded-full bg-gray-700"></span>
                        <span>256-BIT ENCRYPTED</span>
                        <span className="w-1 h-1 rounded-full bg-gray-700"></span>
                        <span className="text-emerald-500">VND + USD BILLING</span>
                    </p>
                    <p className="mt-8 text-[10px] text-gray-600 max-w-xl mx-auto leading-relaxed">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
                    </p>
                </div>
            </section>
        </div>
    );
}
