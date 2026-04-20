import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "About Monstera Cloud",
    description: "Built for sellers and agencies in Southeast Asia.",
};

export default function AboutPage() {
    return (
        <div className="dark flex min-h-screen flex-col bg-[#09090b] font-sans text-slate-200">
            <MarketingNavbar />
            <main className="flex-1 pt-32 pb-24 max-w-3xl mx-auto px-4 sm:px-6 w-full">
                <div className="mb-14 text-center">
                    <p className="font-mono text-[10px] text-cyan-500/60 uppercase tracking-widest mb-4">Our Story</p>
                    <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-6">Why we built Monstera</h1>
                </div>

                <div className="prose prose-invert prose-cyan max-w-none text-gray-400 space-y-6 text-sm md:text-base leading-relaxed">
                    <p>
                        Southeast Asia is one of the fastest-growing ecommerce markets in the world. Sellers here manage multi-channel empires—TikTok Shop, Shopee, Lazada, Meta, and Google Ads. But the data tools built for the West (like Supermetrics or Fivetran) aren't built for us.
                    </p>
                    <p>
                        They are expensive, overly complex, and often bill exclusively in USD with harsh row-count limits. 
                    </p>
                    <p>
                        <strong>We started Monstera Cloud because we were tired of reconciling spreadsheets at midnight.</strong>
                    </p>
                    <p>
                        As agency owners and ecommerce operators, we built the exact tool we needed: an integration platform that simply works out of the box, bills fairly in VND and USD, and supports the specific platforms that actually matter in our region.
                    </p>
                    <p>
                        We strip away the enterprise bloat. No confusing seat-based pricing. No row tier penalties. Just your data, automatically streaming into your Google Sheets and Looker Studio dashboards so you can make profitable decisions while you sleep.
                    </p>
                    <div className="mt-12 pt-8 border-t border-white/10">
                        <p className="text-white font-bold mb-2">Our Core Values</p>
                        <ul className="list-disc pl-5 space-y-2 text-gray-400">
                            <li><strong>Radical simplicity:</strong> You shouldn't need an engineering degree to sync your ad spend.</li>
                            <li><strong>Regional focus:</strong> We specialize in solving data routing for TikTok Ads, Meta, and Shopee.</li>
                            <li><strong>Transparent limits:</strong> Uncapped rows. Predictable pricing.</li>
                        </ul>
                    </div>
                </div>
            </main>
            <MarketingFooter />
        </div>
    );
}
