"use client";

import Link from "next/link";
import { ArrowRight, ArrowLeft, ShieldCheck, Database, Zap, Building2, CheckCircle2 } from "lucide-react";

export default function AgenciesSolutionPage() {
    return (
        <div className="flex flex-col items-center bg-canvas text-ink w-full selection:bg-accent/20 overflow-hidden font-sans">
            
            {/* HERO SECTION */}
            <section className="relative w-full min-h-[80vh] flex flex-col items-center justify-center pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden border-b border-line bg-canvas">
                <div className="relative z-10 w-full max-w-5xl mx-auto text-center flex flex-col items-center">
                    
                    <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold tracking-wider uppercase mb-8">
                        <Building2 className="w-3.5 h-3.5 mr-1 text-accent" /> For APAC Agencies &amp; Aggregators
                    </div>

                    <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold text-ink tracking-tight leading-[1.05] mb-6 max-w-4xl">
                        Manage 50+ seller accounts.<br className="hidden md:block"/>
                        <span className="text-accent">Zero infrastructure code.</span>
                    </h1>

                    <p className="text-base sm:text-lg text-ink-mute max-w-3xl mx-auto mb-10 leading-relaxed font-normal">
                        One console for many clients: separate Monstera workspaces per seller or brand, OAuth into Shopee, Meta Ads, and TikTok, then deliver into each client&apos;s{" "}
                        <strong className="text-ink">Google Sheets™</strong> or <strong className="text-ink">Looker Studio™</strong> — matching what the product does today.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
                        <Link
                            href="/register"
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-black bg-white hover:bg-neutral-200 rounded-md transition-colors shadow-xs"
                        >
                            Provision Agency Fabric
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <Link
                            href="/pricing"
                            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-ink bg-panel border border-line hover:bg-[#16181c] rounded-md transition-colors"
                        >
                            View Enterprise Pricing
                        </Link>
                    </div>
                </div>
            </section>

            {/* AGENCY CAPABILITIES GRID */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 bg-canvas border-b border-line">
                <div className="max-w-6xl mx-auto">
                    <div className="mb-14">
                        <h2 className="text-3xl font-bold text-ink tracking-tight mb-3">Architected for Aggregation.</h2>
                        <p className="text-ink-mute text-sm sm:text-base max-w-2xl">Stop building brittle cron jobs per client. Monstera Cloud normalizes APAC marketplace APIs into a unified analytical schema.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        
                        {/* Capability 1 */}
                        <div className="bg-panel rounded-lg border border-line p-6 hover:border-[#333] transition-colors flex flex-col">
                            <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                                <Database className="w-5 h-5" />
                            </div>
                            <h3 className="text-base font-bold text-ink mb-2 tracking-tight">Multi-Tenant Routing</h3>
                            <p className="text-xs text-ink-mute flex-1 leading-relaxed">
                                Map each Shopee or Meta seller to its own Monstera workspace so credentials, pipelines, and destinations never cross between clients.
                            </p>
                        </div>

                        {/* Capability 2 */}
                        <div className="bg-panel rounded-lg border border-line p-6 hover:border-[#333] transition-colors flex flex-col">
                            <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                                <ShieldCheck className="w-5 h-5" />
                            </div>
                            <h3 className="text-base font-bold text-ink mb-2 tracking-tight">Vietnam PDPA Compliant</h3>
                            <p className="text-xs text-ink-mute flex-1 leading-relaxed">
                                Stay ahead of regional expectations: minimize what you store, encrypt credentials at rest, and keep buyer identifiers out of spreadsheets where your policies require it.
                            </p>
                        </div>

                        {/* Capability 3 */}
                        <div className="bg-panel rounded-lg border border-line p-6 hover:border-[#333] transition-colors flex flex-col">
                            <div className="w-10 h-10 rounded-md bg-canvas border border-line flex items-center justify-center mb-5 text-accent">
                                <Zap className="w-5 h-5" />
                            </div>
                            <h3 className="text-base font-bold text-ink mb-2 tracking-tight">Flash-Sale Resiliency</h3>
                            <p className="text-xs text-ink-mute flex-1 leading-relaxed">
                                Our Vercel Edge ingesters elastically scale to absorb high-volume webhooks during peak campaigns across your entire client portfolio without dropping payloads.
                            </p>
                        </div>

                    </div>
                </div>
            </section>

            {/* DEMO / ARCHITECTURE SECTION */}
            <section className="w-full py-24 px-4 sm:px-6 lg:px-8 border-b border-line bg-canvas">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12">
                    <div className="md:w-1/2">
                        <h2 className="text-3xl font-bold text-ink tracking-tight mb-4">
                            The &quot;Query-Once&quot; Hierarchy.
                        </h2>
                        <p className="text-ink-mute text-xs sm:text-sm mb-8 leading-relaxed">
                            For agencies, maintaining 50 different API connectors is a nightmare. Monstera standardizes the output of Shopee, TikTok, and Meta Ads into a single, unified analytical schema.
                        </p>
                        <ul className="space-y-3 mb-8">
                            <li className="flex items-start gap-3">
                                <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                <span className="text-ink-mute text-xs">Deploy unified Looker Studio reports across multiple clients.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                <span className="text-ink-mute text-xs">Run aggressive cross-brand aggregations for market insights.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                <span className="text-ink-mute text-xs">Share Looker Studio dashboards fed by each client&apos;s workspace API key.</span>
                            </li>
                        </ul>
                    </div>

                    <div className="md:w-1/2 w-full">
                         {/* Terminal Mockup */}
                         <div className="bg-panel border border-line rounded-lg overflow-hidden shadow-sm">
                            <div className="bg-canvas px-4 py-3 flex items-center border-b border-line">
                                <div className="flex space-x-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#333]"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#333]"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-[#333]"></div>
                                </div>
                                <div className="mx-auto text-[11px] text-ink-mute font-mono">agency_pipeline_router.yaml</div>
                            </div>
                            <div className="p-5 font-mono text-xs text-ink leading-relaxed overflow-x-auto">
                                <p><span className="text-accent">routes:</span></p>
                                <p className="pl-4"><span className="text-ink-mute">- client_id:</span> &quot;brand_alpha_vn&quot;</p>
                                <p className="pl-8"><span className="text-ink-mute">source:</span> shopee_v2_api</p>
                                <p className="pl-8"><span className="text-ink-mute">destination:</span> google_sheets.brand_alpha_workbook</p>
                                <p className="pl-8"><span className="text-accent">pii_masking:</span> true</p>
                                <p className="mt-3 pl-4"><span className="text-ink-mute">- client_id:</span> &quot;brand_omega_sg&quot;</p>
                                <p className="pl-8"><span className="text-ink-mute">source:</span> tiktok_shop_api</p>
                                <p className="pl-8"><span className="text-ink-mute">destination:</span> looker_studio.brand_omega_connector</p>
                                <p className="pl-8"><span className="text-accent">pii_masking:</span> true</p>
                                <p className="mt-3 text-ink-mute"># 48 more clients authenticated...</p>
                                <p className="mt-3 text-accent font-semibold">[SYS] FABRIC DEPLOYMENT HEALTHY.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

             <div className="py-16 text-center">
                <Link href="/" className="inline-flex items-center text-xs font-medium text-ink-mute hover:text-ink transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Platform Overview
                </Link>
            </div>

        </div>
    );
}
