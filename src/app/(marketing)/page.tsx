import React from "react";
import Link from "next/link";
import { 
    Database, 
    ArrowRight, 
    ShieldCheck, 
    Zap, 
    CheckCircle2, 
    BarChart3, 
    Smartphone,
    Globe,
    Lock,
    Users,
    LineChart,
    ChevronRight,
    Search,
    ShoppingBag,
    TrendingUp
} from "lucide-react";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";
import { secondaryButtonLinkClassName } from "@/components/ui/SecondaryButton";
import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { DataStreamBackground } from "@/components/DataStreamBackground";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

export default function MarketingPage() {
    return (
        <div className="relative min-h-screen bg-[#09090b] selection:bg-emerald-500/30">
            <MarketingNavbar />
            
            {/* HERO SECTION */}
            <section className="relative pt-32 pb-20 overflow-hidden border-b border-white/5">
                <DataStreamBackground />
                
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center max-w-4xl mx-auto">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest mb-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Now Live
                        </div>
                        
                        <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight mb-8 leading-[1.1]">
                            Your e-commerce data. <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">In Google Sheets™.</span>
                        </h1>
                        
                        <p className="text-lg md:text-xl text-gray-400 mb-12 max-w-2xl mx-auto leading-relaxed">
                            Connect TikTok Ads, Shopee, and more. Pull ad performance, orders, and product data directly into Google Sheets™ or your console. Built for sellers and agencies in Vietnam and Southeast Asia.
                        </p>
                        
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                            <Link href="/register" className={`${primaryButtonLinkClassName} px-8 py-4 text-lg h-auto rounded-2xl shadow-xl shadow-emerald-500/20`}>
                                Get Started Free
                            </Link>
                            <Link href="/pricing" className={`${secondaryButtonLinkClassName} px-8 py-4 text-lg h-auto rounded-2xl`}>
                                View Pricing
                            </Link>
                        </div>

                        <div className="pt-8 border-t border-white/5 flex flex-col items-center gap-6">
                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">
                                Integrates With
                            </p>
                            <div className="flex items-center justify-center space-x-8 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
                                <img src={INTEGRATION_LOGOS.tiktok} alt="TikTok Ads" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                                <img src={INTEGRATION_LOGOS.shopee} alt="Shopee" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                                <img src={INTEGRATION_LOGOS.googleSheets} alt="Google Sheets™" width={100} height={32} className="h-6 w-auto brightness-0 invert" />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* FEATURES GRID */}
            <section className="w-full py-32 px-4 sm:px-6 lg:px-8 bg-[#09090b] relative">
                <div className="max-w-7xl mx-auto">
                    <div className="mb-16">
                        <h2 className="text-3xl font-bold text-white tracking-tight mb-4">Everything you need to track ad performance.</h2>
                        <p className="text-gray-400 max-w-2xl">Stop copying data manually. Monstera connects your platforms and delivers clean, ready-to-analyze data wherever you need it.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {/* FEATURE 1 */}
                        <div className="p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-emerald-500/30 transition-all group">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-6 group-hover:bg-emerald-500/20 transition-colors">
                                <TrendingUp className="w-6 h-6 text-emerald-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-4">TikTok Ads Reports</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                Connect your TikTok Business account via OAuth. Choose dimensions (campaign, ad group, ad), pick metrics (spend, impressions, clicks, conversions), set a date range, and get results instantly.
                            </p>
                        </div>

                        {/* FEATURE 2 */}
                        <div className="p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-blue-500/30 transition-all group">
                            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6 group-hover:bg-blue-500/20 transition-colors">
                                <ShoppingBag className="w-6 h-6 text-blue-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-4">Shopee Data Explorer</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                Pull orders, products, and shop info from your Shopee seller account. Filter by date, status, and export to CSV with one click.
                            </p>
                        </div>

                        {/* FEATURE 3 */}
                        <div className="p-8 rounded-3xl bg-white/5 border border-white/10 hover:border-indigo-500/30 transition-all group">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-6 group-hover:bg-indigo-500/20 transition-colors">
                                <Lock className="w-6 h-6 text-indigo-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-4">Secure by Default</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                All connections use OAuth with encrypted token storage. Your API credentials are never exposed to the browser. Data is transmitted over TLS.
                            </p>
                        </div>

                        {/* FEATURE 4 */}
                        <div className="p-8 rounded-3xl bg-white/5 border border-white/10 lg:col-span-2 relative overflow-hidden group">
                            <div className="relative z-10 flex flex-col h-full">
                                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-6">
                                    <Zap className="w-6 h-6 text-emerald-400" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-4">Google Sheets™ Add-on</h3>
                                <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-lg">
                                    Install our Google Sheets™ add-on, pick your data source and metrics from a sidebar, and write results directly into your spreadsheet. Set auto-refresh from 1 hour to daily.
                                </p>
                                <div className="mt-auto">
                                    <Link href="/register" className="inline-flex items-center text-emerald-400 text-sm font-bold hover:gap-2 transition-all">
                                        Try It Free <ChevronRight className="w-4 h-4" />
                                    </Link>
                                </div>
                            </div>
                            
                            <div className="absolute top-1/2 -right-12 -translate-y-1/2 w-80 h-80 bg-emerald-500/5 blur-[100px] pointer-events-none" />
                            
                            <div className="absolute right-0 bottom-0 w-1/3 h-2/3 bg-white/5 border-l border-t border-white/10 rounded-tl-3xl p-6 hidden lg:block transform group-hover:translate-y-[-4px] transition-transform">
                                <div className="flex flex-col gap-3 font-mono text-[10px]">
                                    <div className="text-emerald-400 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500" /> [SHEETS] Monstera Cloud Add-on
                                    </div>
                                    <div className="text-gray-500">Source: TikTok Ads | Level: Campaign</div>
                                    <div className="text-blue-400">[QUERY] spend, impressions, clicks, ctr</div>
                                    <div className="text-gray-400">[WRITE] Inserting 47 rows &rarr; Sheet1!A1...</div>
                                    <div className="text-emerald-500/50">DONE: Data refreshed (0.8s)</div>
                                </div>
                            </div>
                        </div>

                        {/* FEATURE 5 */}
                        <div className="p-8 rounded-3xl bg-white/5 border border-white/10 group">
                            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-6">
                                <Database className="w-6 h-6 text-gray-300" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-4">Multi-Platform Console</h3>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                View TikTok Ads and Shopee data side by side. Connect multiple accounts per workspace. Export any view to CSV.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* APAC SECTION */}
            <section className="py-32 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-gradient-to-b from-[#09090b] to-[#0d0d10]">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-widest mb-6">
                                Localization
                            </div>
                            <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-8">Built for Southeast Asia</h2>
                            <p className="text-lg text-gray-400 mb-10 leading-relaxed">
                                Designed for Vietnamese sellers and agencies managing TikTok Shop and Shopee. Pay in VND or USD. Additional APAC connectors are on the roadmap.
                            </p>
                            
                            <div className="flex gap-4">
                                <Link href="/pricing" className={`${primaryButtonLinkClassName} rounded-2xl`}>
                                    See Plans
                                </Link>
                                <div className="px-6 py-3 flex flex-col">
                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Pricing</span>
                                    <span className="text-white font-bold">VND + USD Billing</span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="relative">
                            <div className="absolute inset-0 bg-blue-500/10 blur-[120px] rounded-full" />
                            <div className="relative grid grid-cols-2 gap-4">
                                <div className="p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-sm">
                                    <Globe className="w-8 h-8 text-blue-400 mb-4" />
                                    <h4 className="text-white font-bold mb-2">Regional Support</h4>
                                    <p className="text-gray-500 text-xs leading-relaxed">Dedicated infrastructure in Singapore for low latency.</p>
                                </div>
                                <div className="p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-sm mt-8">
                                    <TrendingUp className="w-8 h-8 text-emerald-400 mb-4" />
                                    <h4 className="text-white font-bold mb-2">High Volume</h4>
                                    <p className="text-gray-500 text-xs leading-relaxed">Process millions of rows without timeouts.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA SECTION */}
            <section className="py-32 px-4 sm:px-6 lg:px-8">
                <div className="max-w-5xl mx-auto rounded-[3rem] bg-emerald-500 p-1">
                    <div className="bg-[#09090b] rounded-[2.8rem] px-8 py-20 text-center relative overflow-hidden">
                        <div className="relative z-10">
                            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-6">Ready to consolidate your e-commerce data?</h2>
                            <p className="text-gray-400 mb-10 max-w-lg mx-auto">Connect your first data source in under 60 seconds.</p>
                            <Link href="/register" className={`${primaryButtonLinkClassName} px-10 py-5 text-lg h-auto rounded-3xl shadow-2xl shadow-emerald-500/20`}>
                                Create Free Account
                            </Link>
                            <p className="mt-8 text-[10px] font-black text-gray-600 uppercase tracking-[0.3em]">
                                NO CREDIT CARD REQUIRED &bull; 256-BIT ENCRYPTED &bull; VND + USD BILLING
                            </p>
                        </div>
                        
                        {/* Decorative circles */}
                        <div className="absolute top-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-[80px] -translate-x-1/2 -translate-y-1/2" />
                        <div className="absolute bottom-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-[80px] translate-x-1/2 translate-y-1/2" />
                    </div>
                </div>
                
                <div className="max-w-7xl mx-auto mt-20 text-center">
                    <p className="text-[10px] text-gray-500 font-medium italic">Google Sheets™ and Google Workspace™ are trademarks of Google LLC.</p>
                </div>
            </section>

            <MarketingFooter />
        </div>
    );
}
