import { LegalEntityNotice } from "@/components/LegalEntityNotice";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "About Monstera Cloud",
    description: "Built for sellers and agencies in Southeast Asia.",
};

export default function AboutPage() {
    return (
        <div className="flex min-h-screen flex-col bg-canvas font-sans text-ink">
            <div className="flex-1 pt-16 pb-24 max-w-3xl mx-auto px-4 sm:px-6 w-full">
                <div className="mb-14 text-center">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-line bg-panel text-ink-mute text-xs font-semibold uppercase tracking-wider mb-4">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                        <span>Our Story</span>
                    </div>
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-ink tracking-tight mb-4">Why we built Monstera</h1>
                </div>

                <div className="max-w-none text-ink-mute space-y-6 text-sm md:text-base leading-relaxed font-normal">
                    <p>
                        Southeast Asia is one of the fastest-growing ecommerce markets in the world. Sellers here manage multi-channel empires—TikTok Shop, Shopee, Lazada, Meta, and Google Ads. But the data tools built for the West aren&apos;t built for us.
                    </p>
                    <p>
                        They are expensive, overly complex, and often bill exclusively in USD with harsh row-count limits. 
                    </p>
                    <p className="text-ink font-semibold">
                        We started Monstera Cloud because we were tired of reconciling spreadsheets at midnight.
                    </p>
                    <p>
                        As agency owners and ecommerce operators, we built the exact tool we needed: an integration platform that simply works out of the box, bills fairly in VND and USD, and supports the specific platforms that actually matter in our region.
                    </p>
                    <p>
                        We strip away the enterprise bloat. No confusing seat-based pricing. No row tier penalties. Just your data, automatically streaming into your Google Sheets and Looker Studio dashboards so you can make profitable decisions while you sleep.
                    </p>
                    <div className="mt-12 pt-8 border-t border-line">
                        <p className="text-ink font-bold mb-2">Legal entity</p>
                        <LegalEntityNotice className="text-ink-mute mb-4" />
                        <p className="text-ink-mute text-xs">
                            Registered address: TM 01D-05 KDLST Bãi Dài, Tổ 7, ấp Gành Dầu, xã Gành Dầu, Phú Quốc, Kiên Giang, 92500, {LEGAL_ENTITY.country}.
                        </p>
                    </div>
                    <div className="mt-12 pt-8 border-t border-line">
                        <p className="text-ink font-bold mb-3">Our Core Values</p>
                        <ul className="list-disc pl-5 space-y-2 text-ink-mute text-xs sm:text-sm">
                            <li><strong className="text-ink">Radical simplicity:</strong> You shouldn&apos;t need an engineering degree to sync your ad spend.</li>
                            <li><strong className="text-ink">Regional focus:</strong> We specialize in solving data routing for TikTok Ads, Meta, and Shopee.</li>
                            <li><strong className="text-ink">Transparent limits:</strong> Uncapped rows. Predictable pricing.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
