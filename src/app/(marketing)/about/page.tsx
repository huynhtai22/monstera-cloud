import { LegalEntityNotice } from "@/components/LegalEntityNotice";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "About Monstera Cloud",
    description: "Built for sellers and agencies in Southeast Asia.",
    alternates: { canonical: "https://monsteracloud.com/about" },
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
                        Southeast Asian teams often report across regional commerce and advertising platforms while still delivering decisions through spreadsheets and dashboards.
                    </p>
                    <p>
                        They are expensive, overly complex, and often bill exclusively in USD with harsh row-count limits. 
                    </p>
                    <p className="text-ink font-semibold">
                        We started Monstera Cloud because we were tired of reconciling spreadsheets at midnight.
                    </p>
                    <p>
                        As agency owners and ecommerce operators, we built the workflow we needed: connect an approved source, inspect the import outcome, verify the warehouse rows, and deliver them into a familiar reporting surface.
                    </p>
                    <p>
                        Monstera publishes its workspace limits and certified connector coverage so teams can evaluate the current product without relying on unsupported promises.
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
                            <li><strong className="text-ink">Transparent limits:</strong> Plan capacity and current integration coverage are published clearly.</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
