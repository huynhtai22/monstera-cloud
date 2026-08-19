import Link from "next/link";
import { ShoppingBag, Database, ArrowRight } from "lucide-react";
import { IntegrationMark } from "@/components/ui/IntegrationMark";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

export default function SolutionsPage() {
    return (
        <div className="min-h-screen bg-canvas text-ink font-sans">

            {/* Header */}
            <section className="pt-32 pb-20 md:pt-40 md:pb-24 border-b border-line bg-canvas">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                    <h1 className="text-4xl sm:text-6xl md:text-7xl font-bold text-ink mb-6 tracking-tight">
                        Built for <span className="text-accent">E-Commerce &amp; Ads</span>
                    </h1>
                    <p className="text-base sm:text-xl text-ink-mute max-w-3xl mx-auto mb-10 font-normal leading-relaxed">
                        Western data tools ignore Southeast Asia. Monstera Cloud launched with native support for Shopee, TikTok Ads, Meta Ads, and Google Ads.
                    </p>
                    <Link href="/register" className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-black bg-white hover:bg-neutral-200 rounded-md shadow-xs transition-colors">
                        Connect your store today
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </section>

            {/* Platform Grid */}
            <section className="py-24 bg-canvas border-b border-line">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                    <div className="grid md:grid-cols-2 gap-12 items-center">

                        <div>
                            <div className="w-12 h-12 bg-panel rounded-lg flex items-center justify-center mb-6 border border-line text-accent">
                                <ShoppingBag className="w-6 h-6" />
                            </div>
                            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-ink mb-4">Stop manually downloading Seller Center CSVs</h2>
                            <p className="text-sm text-ink-mute mb-4 leading-relaxed">
                                Managing inventory and tracking ROAS across Shopee, Meta, and TikTok is a nightmare when your data is splintered across multiple tools and spreadsheets.
                            </p>
                            <p className="text-sm text-ink-mute mb-8 leading-relaxed">
                                Monstera Cloud connects Shopee, Meta Ads, and TikTok Ads with OAuth, runs scheduled syncs, and delivers rows into{" "}
                                <strong className="font-semibold text-ink">Google Sheets™</strong> or charts via{" "}
                                <strong className="font-semibold text-ink">Looker Studio™</strong>.
                            </p>

                            <ul className="space-y-3 mb-8">
                                <li className="flex items-center text-xs text-ink-mute">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent mr-3"></div> Native Shopee Open API integration
                                </li>
                                <li className="flex items-center text-xs text-ink-mute">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent mr-3"></div> TikTok Ads &amp; Shop Commerce APIs
                                </li>
                                <li className="flex items-center text-xs text-ink-mute">
                                    <div className="w-1.5 h-1.5 rounded-full bg-accent mr-3"></div> Meta Ads &amp; Google Ads pipelines
                                </li>
                            </ul>
                        </div>

                        {/* Visual Mockup side */}
                        <div className="relative border border-line rounded-lg p-6 bg-panel shadow-sm overflow-hidden">
                            {/* Pipeline Mockup */}
                            <div className="relative z-10 flex flex-col gap-4">
                                {/* Shopee Source */}
                                <div className="bg-canvas p-4 rounded-md border border-line flex items-center shadow-xs">
                                    <IntegrationMark src={INTEGRATION_LOGOS.shopee} alt="Shopee" size="md" className="mr-3" />
                                    <div className="flex-1">
                                        <div className="font-semibold text-xs text-ink">Shopee Southeast Asia</div>
                                        <div className="text-[11px] text-accent font-mono mt-0.5">Extracting Orders &amp; Revenue...</div>
                                    </div>
                                </div>

                                <div className="flex justify-center -my-2 z-20">
                                    <div className="h-6 w-px bg-line"></div>
                                </div>

                                {/* TikTok Source */}
                                <div className="bg-canvas p-4 rounded-md border border-line flex items-center shadow-xs">
                                    <IntegrationMark src={INTEGRATION_LOGOS.tiktok} alt="TikTok Ads" size="md" className="mr-3" />
                                    <div className="flex-1">
                                        <div className="font-semibold text-xs text-ink">TikTok Ads &amp; Shop</div>
                                        <div className="text-[11px] text-accent font-mono mt-0.5">Extracting Campaign Metrics...</div>
                                    </div>
                                </div>

                                <div className="flex justify-center -my-2 z-20">
                                    <div className="h-6 w-px bg-line"></div>
                                </div>

                                {/* Destination */}
                                <div className="bg-canvas p-4 rounded-md border border-line flex items-center shadow-xs">
                                    <div className="w-9 h-9 rounded-md bg-panel border border-line flex items-center justify-center mr-3 text-accent">
                                        <Database className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <div className="font-semibold text-xs text-ink">Google Sheets™ &amp; Looker Studio™</div>
                                        <div className="text-[11px] text-ink-mute mt-0.5">Normalized warehouse refresh…</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </section>

            {/* Bottom CTA */}
            <section className="py-24 bg-canvas text-center">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h2 className="text-3xl md:text-4xl font-bold text-ink mb-4">Build your central command center.</h2>
                    <p className="text-sm sm:text-base text-ink-mute mb-8">
                        Stop flying blind. Connect your APAC commerce and ads stack in minutes.
                    </p>
                    <Link href="/register" className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-black bg-white hover:bg-neutral-200 rounded-md shadow-xs transition-colors">
                        Start your 14-day free pilot
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </section>
        </div>
    );
}
