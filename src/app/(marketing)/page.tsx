import Link from "next/link";
import { ArrowRight, Database, Workflow, Zap, CheckCircle2, XCircle } from "lucide-react";

export default function LandingPage() {
    return (
        <div className="flex flex-col min-h-screen">
            {/* Hero Section */}
            <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
                {/* Dynamic Mesh Background */}
                <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/20 via-slate-900/5 to-white dark:to-slate-950"></div>
                <div className="absolute top-0 right-0 -translate-y-12 translate-x-1/3 blur-[100px] opacity-50 dark:opacity-20 pointer-events-none">
                    <div className="w-[600px] h-[600px] rounded-full bg-emerald-400/30"></div>
                </div>
                <div className="absolute bottom-0 left-0 translate-y-1/3 -translate-x-1/3 blur-[120px] opacity-40 dark:opacity-20 pointer-events-none">
                    <div className="w-[500px] h-[500px] rounded-full bg-blue-400/30"></div>
                </div>

                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium text-emerald-800 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30 ring-1 ring-inset ring-emerald-600/20 mb-8 cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-900/50 transition-colors">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
                        Monstera Cloud 2.0 is now live
                    </div>

                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-gray-900 dark:text-white mb-8">
                        Connect data. <br className="hidden md:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-blue-600">Automate reporting.</span>
                    </h1>

                    <p className="mt-4 text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto mb-10 font-light">
                        Move data from 100+ platforms into Google Sheets, Looker Studio, and BiqQuery in minutes. No coding required.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link href="/dashboard" className="w-full sm:w-auto px-8 py-4 text-lg font-medium text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center group">
                            Start your 14-day free trial
                            <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link href="/platform" className="w-full sm:w-auto px-8 py-4 text-lg font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition-all flex items-center justify-center">
                            See how it works
                        </Link>
                    </div>
                    <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No credit card required. Cancel anytime.</p>
                </div>
            </section>

            {/* Trusted By Section (Logos) */}
            <section className="py-10 border-y border-gray-200/50 dark:border-slate-800/50 bg-white/50 dark:bg-slate-900/20 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <p className="text-center text-sm font-semibold text-gray-500 uppercase tracking-widest mb-8">Trusted by data teams at</p>
                    <div className="flex flex-wrap justify-center items-center gap-12 md:gap-24 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
                        {/* Actual Logos reflecting APAC focus */}
                        <div className="text-2xl font-bold flex items-center gap-2 text-orange-500"><div className="w-8 h-8 bg-orange-500 rounded-md"></div> Shopee</div>
                        <div className="text-2xl font-bold flex items-center gap-2 text-black dark:text-white"><div className="w-8 h-8 bg-black dark:bg-white rounded-md"></div> TikTok Shop</div>
                        <div className="text-2xl font-bold flex items-center gap-2 text-blue-600"><div className="w-8 h-8 rounded-full bg-blue-600"></div> Lazada</div>
                        <div className="text-2xl font-bold flex items-center gap-2 text-blue-500"><div className="w-10 h-6 bg-blue-500 rounded-full"></div> Facebook Ads</div>
                    </div>
                </div>
            </section>

            {/* Platform Snippet / Value Prop */}
            <section className="py-24 bg-white dark:bg-slate-950">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4">The easiest data pipeline you'll ever build</h2>
                        <p className="text-xl text-gray-600 dark:text-gray-400">Transform messy API responses into clean, analyst-ready tables in three clicks.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        {/* Step 1 */}
                        <div className="p-8 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:shadow-xl transition-shadow group cursor-pointer relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Database className="w-32 h-32" />
                            </div>
                            <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center mb-6 border border-blue-200 dark:border-blue-800">
                                <Database className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">1. Connect</h3>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                Authenticate with over 100+ native integrations including Shopee, Facebook Ads, Shopify, and TikTok. No API keys required.
                            </p>
                        </div>

                        {/* Step 2 */}
                        <div className="p-8 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:shadow-xl transition-shadow group cursor-pointer relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Workflow className="w-32 h-32" />
                            </div>
                            <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mb-6 border border-emerald-200 dark:border-emerald-800">
                                <Workflow className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">2. Transform</h3>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                Filter rows, rename columns, convert currency, and mask PII data visually before it ever hits your destination.
                            </p>
                        </div>

                        {/* Step 3 */}
                        <div className="p-8 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:shadow-xl transition-shadow group cursor-pointer relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Zap className="w-32 h-32" />
                            </div>
                            <div className="w-14 h-14 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center mb-6 border border-amber-200 dark:border-amber-800">
                                <Zap className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">3. Sync to Your DB</h3>
                            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                                Bring Your Own Database (BYOD). We pipe data directly into Google Sheets or your Snowflake warehouse. We don't hold your data hostage.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Us vs Them Section */}
            <section className="py-24 bg-slate-50 dark:bg-slate-900/50 border-t border-gray-200/50 dark:border-slate-800/50">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Why Monstera Cloud?</h2>
                        <p className="text-xl text-gray-600 dark:text-gray-400">Stop paying the legacy data tax.</p>
                    </div>

                    <div className="bg-white dark:bg-slate-950 rounded-3xl border border-gray-200 dark:border-slate-800 shadow-xl overflow-hidden">
                        <div className="grid grid-cols-3">
                            <div className="p-6 md:p-8 bg-gray-50/50 dark:bg-slate-900/50 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-sm">Feature</div>
                            <div className="p-6 md:p-8 text-center bg-gray-100 dark:bg-slate-800 font-bold text-gray-900 dark:text-white border-l border-r border-gray-200 dark:border-slate-700">Competitors</div>
                            <div className="p-6 md:p-8 text-center bg-emerald-50 dark:bg-emerald-900/20 font-bold text-emerald-800 dark:text-emerald-400">Monstera Cloud</div>

                            <div className="col-span-3 border-t border-gray-100 dark:border-slate-800"></div>

                            {/* Row 1 */}
                            <div className="p-6 md:p-8 flex items-center font-medium text-gray-900 dark:text-white">Pricing Model</div>
                            <div className="p-6 md:p-8 text-center flex items-center justify-center flex-col border-l border-r border-gray-100 dark:border-slate-800 bg-gray-50/30 dark:bg-slate-900/30 text-gray-600 dark:text-gray-400">
                                <span className="font-semibold text-red-500 mb-1">Pay Per Row</span>
                                <span className="text-sm">Usage-based anxiety</span>
                            </div>
                            <div className="p-6 md:p-8 text-center flex items-center justify-center flex-col bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-300">
                                <span className="font-semibold mb-1">Flat Monthly Fee</span>
                                <span className="text-sm">Unlimited Syncs</span>
                            </div>

                            <div className="col-span-3 border-t border-gray-100 dark:border-slate-800"></div>

                            {/* Row 2 */}
                            <div className="p-6 md:p-8 flex items-center font-medium text-gray-900 dark:text-white">APAC E-Commerce</div>
                            <div className="p-6 md:p-8 text-center flex items-center justify-center border-l border-r border-gray-100 dark:border-slate-800 bg-gray-50/30 dark:bg-slate-900/30 text-gray-500">
                                <XCircle className="w-6 h-6 text-red-400" />
                            </div>
                            <div className="p-6 md:p-8 text-center flex items-center justify-center bg-emerald-50/50 dark:bg-emerald-900/10">
                                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                                <span className="ml-2 font-medium text-emerald-800 dark:text-emerald-300 hidden md:block">Shopee, TikTok, Lazada</span>
                            </div>

                            <div className="col-span-3 border-t border-gray-100 dark:border-slate-800"></div>

                            {/* Row 3 */}
                            <div className="p-6 md:p-8 flex items-center font-medium text-gray-900 dark:text-white">In-Flight Data UI</div>
                            <div className="p-6 md:p-8 text-center flex items-center justify-center flex-col border-l border-r border-gray-100 dark:border-slate-800 bg-gray-50/30 dark:bg-slate-900/30 text-gray-600 dark:text-gray-400">
                                <span className="font-semibold text-red-500 mb-1">Code Required</span>
                                <span className="text-sm">Requires dbt / SQL</span>
                            </div>
                            <div className="p-6 md:p-8 text-center flex items-center justify-center flex-col bg-emerald-50/50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-300">
                                <span className="font-semibold mb-1">Visual Transformations</span>
                                <span className="text-sm">Mask PII instantly</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="py-24 relative overflow-hidden">
                <div className="absolute inset-0 bg-emerald-600 dark:bg-emerald-900 z-0"></div>
                <div className="absolute inset-0 bg-[url('/mesh-pattern.png')] opacity-10 z-0 mix-blend-overlay"></div>

                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
                    <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Ready to stop paying the legacy data tax?</h2>
                    <p className="text-xl text-emerald-100 mb-10 max-w-2xl mx-auto">
                        Get your E-Commerce data piped directly into your warehouse today without arbitrary volume limits.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link href="/dashboard" className="px-8 py-4 text-lg font-bold text-emerald-900 bg-white hover:bg-emerald-50 rounded-xl shadow-xl hover:shadow-2xl transition-all">
                            Start Free Trial
                        </Link>
                        <Link href="/pricing" className="px-8 py-4 text-lg font-medium text-white border border-emerald-400 hover:bg-emerald-500/50 rounded-xl transition-all">
                            View Pricing
                        </Link>
                    </div>
                    <div className="mt-8 flex items-center justify-center gap-6 text-emerald-100 text-sm font-medium">
                        <span className="flex items-center"><CheckCircle2 className="w-4 h-4 mr-2" /> 14-day free trial</span>
                        <span className="flex items-center"><CheckCircle2 className="w-4 h-4 mr-2" /> No credit card required</span>
                        <span className="flex items-center"><CheckCircle2 className="w-4 h-4 mr-2" /> Setup in 2 minutes</span>
                    </div>
                </div>
            </section>
        </div>
    );
}
