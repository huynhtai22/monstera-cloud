import Link from "next/link";
import { ShoppingBag, Globe, Database, ArrowRight } from "lucide-react";

export default function SolutionsPage() {
    return (
        <div className="min-h-screen font-sans">

            {/* Header */}
            <section className="pt-32 pb-20 md:pt-40 md:pb-24 bg-[#F8FAFC] dark:bg-slate-950 border-b border-gray-200/50 dark:border-slate-800/50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <h1 className="text-5xl md:text-7xl font-extrabold text-gray-900 dark:text-white mb-6 tracking-tight">
                        Built for <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-pink-600">E-Commerce</span>
                    </h1>
                    <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto mb-10 font-light leading-relaxed">
                        Western data tools ignore Southeast Asia. Monstera Cloud launched with native support for Shopee, TikTok Shop, and Lazada.
                    </p>
                    <Link href="/api/auth/signin" className="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-white bg-slate-900 dark:bg-emerald-600 hover:bg-slate-800 dark:hover:bg-emerald-700 rounded-xl shadow-lg hover:shadow-xl transition-all">
                        Connect your store today
                    </Link>
                </div>
            </section>

            {/* Platform Grid */}
            <section className="py-24 bg-white dark:bg-slate-900">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                    <div className="grid md:grid-cols-2 gap-16 items-center">

                        <div>
                            <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 rounded-2xl flex items-center justify-center mb-8 border border-orange-200 dark:border-orange-800">
                                <ShoppingBag className="w-8 h-8 text-orange-600 dark:text-orange-400" />
                            </div>
                            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-6">Stop manually downloading Seller Center CSVs</h2>
                            <p className="text-lg text-gray-600 dark:text-gray-400 mb-6 leading-relaxed">
                                Managing inventory and tracking ROAS across Shopee, Lazada, and TikTok is a nightmare when your data is splintered across multiple dashboards.
                            </p>
                            <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
                                Monstera Cloud automatically fetches Orders, Products, and Financials every hour and pushes them into your central Google Sheet or BigQuery warehouse.
                            </p>

                            <ul className="space-y-4 mb-8">
                                <li className="flex items-center text-gray-700 dark:text-gray-300 font-medium">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 mr-4"></div> Native Shopee Open API integration
                                </li>
                                <li className="flex items-center text-gray-700 dark:text-gray-300 font-medium">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 mr-4"></div> TikTok Shop Commerce APIs
                                </li>
                                <li className="flex items-center text-gray-700 dark:text-gray-300 font-medium">
                                    <div className="w-2 h-2 rounded-full bg-emerald-500 mr-4"></div> Lazada Seller API ready
                                </li>
                            </ul>
                        </div>

                        {/* Visual Mockup side */}
                        <div className="relative border border-slate-200 dark:border-slate-700 rounded-3xl p-8 bg-slate-50 dark:bg-slate-800/50 shadow-2xl overflow-hidden group">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-orange-400/20 via-transparent to-transparent opacity-50"></div>

                            {/* Pipeline Mockup */}
                            <div className="relative z-10 flex flex-col gap-6">
                                {/* Shopee Source */}
                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center shadow-sm">
                                    <div className="w-10 h-10 bg-orange-500 rounded-lg flex-shrink-0 mr-4"></div>
                                    <div className="flex-1">
                                        <div className="font-bold text-gray-900 dark:text-white">Shopee Southeast Asia</div>
                                        <div className="text-xs text-emerald-600 font-medium mt-1">Extracting 12,400 Orders...</div>
                                    </div>
                                </div>

                                <div className="flex justify-center -my-3 z-20">
                                    <div className="h-8 w-px bg-slate-300 dark:bg-slate-600"></div>
                                </div>

                                {/* TikTok Source */}
                                <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center shadow-sm">
                                    <div className="w-10 h-10 bg-black dark:bg-white rounded-lg flex-shrink-0 mr-4 flex items-center justify-center text-white dark:text-black font-bold">t</div>
                                    <div className="flex-1">
                                        <div className="font-bold text-gray-900 dark:text-white">TikTok Shop ID</div>
                                        <div className="text-xs text-emerald-600 font-medium mt-1">Extracting 8,200 Orders...</div>
                                    </div>
                                </div>

                                <div className="flex justify-center -my-3 z-20">
                                    <div className="h-8 w-px bg-slate-300 dark:bg-slate-600"></div>
                                </div>

                                {/* Destination */}
                                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center shadow-lg transform group-hover:scale-105 transition-transform">
                                    <Database className="w-8 h-8 text-emerald-600 mr-4" />
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">Unified Reporting DB</div>
                                        <div className="text-xs text-gray-500 mt-1">Loading mapped schemas...</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="py-24 bg-slate-50 dark:bg-slate-950 border-t border-gray-200/50 dark:border-slate-800/50 text-center">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h2 className="text-3xl md:text-5xl font-bold text-gray-900 dark:text-white mb-6">Build your central command center.</h2>
                    <p className="text-xl text-gray-600 dark:text-gray-400 mb-10">
                        Stop flying blind. Connect your APAC commerce stack in minutes.
                    </p>
                    <Link href="/register" className="inline-flex items-center px-8 py-4 text-lg font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-lg transition-all">
                        Start your 14-day free trial
                    </Link>
                </div>
            </section>
        </div>
    );
}
