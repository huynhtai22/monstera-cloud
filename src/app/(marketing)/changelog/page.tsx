import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { Zap, Shield, Repeat, PlusCircle } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Changelog",
    description: "New features, performance updates, and bug fixes for Monstera Cloud.",
};

export default function ChangelogPage() {
    return (
        <div className="dark flex min-h-screen flex-col bg-[#09090b] font-sans text-slate-200">
            <MarketingNavbar />
            <main className="flex-1 pt-32 pb-24 max-w-4xl mx-auto px-4 sm:px-6 w-full">
                <div className="mb-16">
                    <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-4">Changelog</h1>
                    <p className="text-gray-400 text-lg">New features, performance updates, and bug fixes.</p>
                </div>

                <div className="space-y-16">
                    {/* Release 1 */}
                    <div className="relative pl-8 border-l border-white/10">
                        <div className="absolute top-0 left-[-5px] w-2.5 h-2.5 rounded-full bg-cyan-500 ring-4 ring-[#09090b]"></div>
                        <p className="text-cyan-400 text-xs font-mono tracking-widest uppercase mb-2">April 2026</p>
                        <h2 className="text-2xl font-bold text-white mb-4">Agency pilot reliability release</h2>
                        <ul className="space-y-3">
                            <li className="flex items-start gap-3">
                                <Zap className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                                <span className="text-gray-300"><strong>Agency pilot refresh:</strong> Certified connectors now use manual refresh plus a nightly warehouse run.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <PlusCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                                <span className="text-gray-300"><strong>Connector-first workflow:</strong> Import normalized warehouse metrics, verify freshness in Data Explorer, then query them from Sheets, Looker Studio, or the API.</span>
                            </li>
                        </ul>
                    </div>

                    {/* Release 2 */}
                    <div className="relative pl-8 border-l border-white/10">
                        <div className="absolute top-0 left-[-5px] w-2.5 h-2.5 rounded-full bg-cyan-500/50 ring-4 ring-[#09090b]"></div>
                        <p className="text-gray-500 text-xs font-mono tracking-widest uppercase mb-2">March 2026</p>
                        <h2 className="text-xl font-bold text-white mb-4">Meta Pixel & Regional Updates</h2>
                        <ul className="space-y-3">
                            <li className="flex items-start gap-3">
                                <Repeat className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
                                <span className="text-gray-300"><strong>Multi-currency Support:</strong> We now detect IP natively and offer seamless switching between USD and VND for SEA sellers.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <Shield className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                                <span className="text-gray-300"><strong>OAuth Improvements:</strong> Eliminated silent cross-site failure loops to increase standard reliability when authenticating Meta and TikTok accounts.</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </main>
            <MarketingFooter />
        </div>
    );
}
