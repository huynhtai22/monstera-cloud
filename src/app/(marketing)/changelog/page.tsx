import { Zap, Shield, Repeat, PlusCircle } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Changelog",
    description: "New features, performance updates, and bug fixes for Monstera Cloud.",
};

export default function ChangelogPage() {
    return (
        <div className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
            <div className="flex-1 pt-16 pb-24 max-w-4xl mx-auto px-4 sm:px-6 w-full">
                <div className="mb-14">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-4">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                        <span>Updates</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-ink tracking-tight mb-3">Changelog</h1>
                    <p className="text-sm sm:text-base text-ink-mute">New features, performance updates, and bug fixes.</p>
                </div>

                <div className="space-y-12">
                    {/* Release 1 */}
                    <div className="relative pl-6 border-l border-line">
                        <div className="absolute top-1 left-[-4px] w-2 h-2 rounded-full bg-accent"></div>
                        <p className="text-accent text-[11px] font-mono tracking-wider uppercase mb-1">April 2026</p>
                        <h2 className="text-xl font-bold text-ink mb-3">Agency pilot reliability release</h2>
                        <ul className="space-y-2.5">
                            <li className="flex items-start gap-2.5">
                                <Zap className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                <span className="text-xs sm:text-sm text-ink-mute"><strong className="text-ink">Agency pilot refresh:</strong> Certified connectors now use manual refresh plus a nightly warehouse run.</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                                <PlusCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                <span className="text-xs sm:text-sm text-ink-mute"><strong className="text-ink">Connector-first workflow:</strong> Import normalized warehouse metrics, verify freshness in Data Explorer, then query them from Sheets, Looker Studio, or the API.</span>
                            </li>
                        </ul>
                    </div>

                    {/* Release 2 */}
                    <div className="relative pl-6 border-l border-line">
                        <div className="absolute top-1 left-[-4px] w-2 h-2 rounded-full bg-line"></div>
                        <p className="text-ink-mute text-[11px] font-mono tracking-wider uppercase mb-1">March 2026</p>
                        <h2 className="text-xl font-bold text-ink mb-3">Meta Pixel &amp; Regional Updates</h2>
                        <ul className="space-y-2.5">
                            <li className="flex items-start gap-2.5">
                                <Repeat className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                                <span className="text-xs sm:text-sm text-ink-mute"><strong className="text-ink">Multi-currency Support:</strong> We now detect IP natively and offer seamless switching between USD and VND for SEA sellers.</span>
                            </li>
                            <li className="flex items-start gap-2.5">
                                <Shield className="w-4 h-4 text-ink-mute shrink-0 mt-0.5" />
                                <span className="text-xs sm:text-sm text-ink-mute"><strong className="text-ink">OAuth Improvements:</strong> Eliminated silent cross-site failure loops to increase standard reliability when authenticating Meta and TikTok accounts.</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
