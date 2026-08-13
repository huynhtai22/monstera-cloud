import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";
import Link from "next/link";
import { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";

type IntegrationEntry = {
    source: string;
    dest: string;
    headline: string;
    sub: string;
    /** Extra SEO keywords beyond source/dest defaults */
    keywords?: string[];
    /** Short FAQ for on-page long-tail relevance */
    faqs?: { q: string; a: string }[];
};

const DATA: Record<string, IntegrationEntry> = {
    "tiktok-ads-to-google-sheets": {
        source: "TikTok Ads",
        dest: "Google Sheets™",
        headline: "Connect TikTok Ads to Google Sheets",
        sub: "Pull spend, ROAS, and conversion metrics from TikTok Ads into Google Sheets on a schedule—fewer CSV exports for SEA campaign teams.",
        keywords: [
            "TikTok Ads Google Sheets",
            "SEA performance marketing",
            "automate TikTok reporting",
        ],
        faqs: [
            {
                q: "Why not export CSVs from TikTok Ads Manager?",
                a: "Scheduled sync reduces copy-paste errors and keeps agency dashboards aligned when campaigns change daily.",
            },
            {
                q: "Is this built for Southeast Asia teams?",
                a: "Yes—Monstera is designed around regional ad and marketplace workflows, not only Western DTC stacks.",
            },
        ],
    },
    "shopee-to-google-sheets": {
        source: "Shopee",
        dest: "Google Sheets™",
        headline: "Connect Shopee to Google Sheets",
        sub: "Pipe Shopee Seller performance into Google Sheets so Thailand, Indonesia, Malaysia, and Vietnam teams can report without stitching spreadsheets by hand.",
        keywords: [
            "Shopee Seller Center reporting",
            "automate Shopee Google Sheets",
            "SEA marketplace analytics",
        ],
        faqs: [
            {
                q: "Can I blend Shopee with ad spend from Meta or TikTok?",
                a: "Connect each source in Monstera, then join or model in Sheets or Looker Studio using the same workspace metrics.",
            },
            {
                q: "Do marketplace metrics match native Shopee definitions?",
                a: "We recommend validating totals against Seller Center during onboarding; marketplace APIs can differ by field from what you see in UI exports.",
            },
        ],
    },
    "meta-ads-to-google-sheets": {
        source: "Meta Ads",
        dest: "Google Sheets™",
        headline: "Connect Meta Ads to Google Sheets",
        sub: "Automate Facebook and Instagram campaign metrics into Google Sheets for client reporting across Indonesia, Thailand, Vietnam, and Malaysia.",
        keywords: ["Meta Ads Google Sheets", "Facebook ads reporting automation", "agency Meta reporting"],
        faqs: [
            {
                q: "How is pilot data refreshed?",
                a: "Agency staff can refresh on demand, and Monstera runs one nightly warehouse refresh.",
            },
        ],
    },
    "shopee-to-looker-studio": {
        source: "Shopee",
        dest: "Looker Studio™",
        headline: "Connect Shopee to Looker Studio",
        sub: "Build client-ready dashboards that combine Shopee marketplace performance with your other Monstera sources—without row-based warehouse pricing.",
        keywords: [
            "Shopee Looker Studio",
            "Shopee data studio",
            "marketplace dashboard SEA",
        ],
        faqs: [
            {
                q: "How does data reach Looker Studio?",
                a: "Use Monstera’s native Looker Studio connector with your workspace API key after connecting Shopee in the console.",
            },
        ],
    },
    "lazada-to-google-sheets": {
        source: "Lazada",
        dest: "Google Sheets™",
        headline: "Connect Lazada to Google Sheets",
        sub: "Sync Lazada marketplace metrics into Google Sheets for Malaysia, Singapore, Thailand, and cross-border teams that need predictable, flat-rate pipelines.",
        keywords: ["Lazada Google Sheets", "Lazada Seller reporting", "Lazada automation SEA"],
        faqs: [
            {
                q: "Does this replace Lazada Seller Center exports?",
                a: "It reduces repetitive CSV work; you still validate business-critical numbers against Seller Center when definitions change.",
            },
        ],
    },
    "lazada-to-looker-studio": {
        source: "Lazada",
        dest: "Looker Studio™",
        headline: "Connect Lazada to Looker Studio",
        sub: "Visualize Lazada alongside Meta Ads and TikTok Ads in Looker Studio for a regional view agencies can share with clients.",
        keywords: ["Lazada Looker Studio", "Lazada BI connector", "SEA ecommerce reporting"],
        faqs: [
            {
                q: "Can agencies use one workspace per client?",
                a: "Workspace-scoped connections help separate client data; pair with your internal access controls for multi-client delivery.",
            },
        ],
    },
    "meta-ads-to-looker-studio": {
        source: "Meta Ads",
        dest: "Looker Studio™",
        headline: "Connect Meta Ads to Looker Studio",
        sub: "Report Meta and Instagram spend from the normalized warehouse in Looker Studio, with manual and nightly source refresh.",
        keywords: ["Meta Ads Looker Studio", "Facebook ads Looker", "GDS Meta connector alternative"],
        faqs: [
            {
                q: "Why Looker Studio instead of only Sheets?",
                a: "Looker Studio is ideal for shareable dashboards; Sheets stays best for ad-hoc modeling and client-specific templates.",
            },
        ],
    },
    "tiktok-ads-to-looker-studio": {
        source: "TikTok Ads",
        dest: "Looker Studio™",
        headline: "Connect TikTok Ads to Looker Studio",
        sub: "Keep TikTok Ads metrics next to Shopee or Lazada charts in Looker Studio so ROAS conversations match how SEA brands actually spend.",
        keywords: ["TikTok Ads Looker Studio", "TikTok marketing dashboard", "SEA TikTok reporting"],
        faqs: [
            {
                q: "Is TikTok Shop the same as TikTok Ads?",
                a: "No—TikTok Ads covers paid media; TikTok Shop covers storefront and order data. Monstera supports both as separate connections.",
            },
        ],
    },
    "google-ads-to-google-sheets": {
        source: "Google Ads",
        dest: "Google Sheets™",
        headline: "Connect Google Ads to Google Sheets",
        sub: "Automate Search, PMAX, and Shopping performance into Google Sheets for accounts that run alongside Shopee and Lazada in Southeast Asia.",
        keywords: ["Google Ads Google Sheets", "SEA Google Ads reporting", "automate Google Ads export"],
        faqs: [
            {
                q: "Can I combine Google Ads with marketplace sources?",
                a: "Yes—connect Google Ads and each marketplace in the same workspace, then join metrics in Sheets or Looker Studio.",
            },
        ],
    },
    "google-ads-to-looker-studio": {
        source: "Google Ads",
        dest: "Looker Studio™",
        headline: "Connect Google Ads to Looker Studio",
        sub: "Publish Google Ads performance to Looker Studio dashboards your agency already uses for regional ecommerce clients.",
        keywords: ["Google Ads Looker Studio", "Google Ads data studio", "SEA paid search reporting"],
        faqs: [
            {
                q: "Do I need a data warehouse?",
                a: "No—Monstera targets Sheets and Looker Studio first, so marketers are not forced into MAR-style warehouse billing for basic reporting.",
            },
        ],
    },
    "tiktok-shop-to-google-sheets": {
        source: "TikTok Shop",
        dest: "Google Sheets™",
        headline: "Connect TikTok Shop to Google Sheets",
        sub: "Bring TikTok Shop orders and storefront metrics into Google Sheets on a schedule—built for live-commerce and flash-sale cadences common in SEA.",
        keywords: ["TikTok Shop Google Sheets", "TikTok Shop reporting", "TikTok Shop data export"],
        faqs: [
            {
                q: "How is TikTok Shop different from TikTok Ads?",
                a: "TikTok Shop reflects commerce and orders; TikTok Ads reflects paid media. Connect both to reconcile spend with marketplace revenue.",
            },
        ],
    },
    "tiktok-shop-to-looker-studio": {
        source: "TikTok Shop",
        dest: "Looker Studio™",
        headline: "Connect TikTok Shop to Looker Studio",
        sub: "Layer TikTok Shop GMV and orders into Looker Studio next to ad platforms so leadership sees one regional narrative.",
        keywords: ["TikTok Shop Looker Studio", "TikTok Shop dashboard", "TikTok Shop analytics SEA"],
        faqs: [
            {
                q: "Will metrics match TikTok Shop Seller Center?",
                a: "API field definitions can differ from UI labels; we recommend spot-checking totals during campaign spikes and mega-sale windows.",
            },
        ],
    },
};

type Slug = keyof typeof DATA;

export function generateStaticParams() {
    return Object.keys(DATA).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const data = DATA[slug] ?? DATA["tiktok-ads-to-google-sheets"];
    const baseKeywords = [
        data.source,
        data.dest,
        "integration",
        "Southeast Asia",
        "ecommerce data pipeline",
        "automate reporting",
    ];
    const extra = data.keywords ?? [];
    return {
        title: `${data.headline} | Monstera Cloud`,
        description: data.sub,
        keywords: [...new Set([...baseKeywords, ...extra])],
    };
}

export default async function IntegrationPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const data = DATA[slug];

    if (!data) {
        return <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center">Integration not found.</div>;
    }

    const faqs = data.faqs ?? [];

    return (
        <div className="dark flex min-h-screen flex-col bg-[#09090b] font-sans text-slate-200">
            <MarketingNavbar />

            <main className="flex-1">
                <section className="pt-32 pb-24 border-b border-white/5 relative overflow-hidden">
                    <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/10 blur-[120px] rounded-full" />

                    <div className="max-w-4xl mx-auto px-4 sm:px-6 relative text-center">
                        <div className="inline-flex items-center gap-3 mb-8 bg-white/[0.03] border border-white/10 rounded-full px-4 py-1.5 font-mono text-xs text-gray-400">
                            <span className="text-white font-semibold">{data.source}</span>
                            <ArrowRight className="w-3 h-3 text-cyan-400" />
                            <span className="text-white font-semibold">{data.dest}</span>
                        </div>

                        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight mb-6">{data.headline}</h1>

                        <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">{data.sub}</p>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                            <Link
                                href="/register"
                                className="inline-flex items-center gap-2 px-8 py-4 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-lg shadow-cyan-900/40"
                            >
                                Start your free 14-day trial
                            </Link>
                            <Link
                                href="/docs#sources"
                                className="text-sm font-medium text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                            >
                                View supported connectors
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="py-24 max-w-5xl mx-auto px-4 sm:px-6">
                    <h2 className="text-3xl font-bold text-center mb-12">Stop doing this manually</h2>
                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                            <h3 className="font-semibold text-white mb-2">Scheduled refresh</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">
                                Run on-demand or nightly warehouse refreshes so account managers spend less time on CSV cleanup.
                            </p>
                        </div>
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                            <h3 className="font-semibold text-white mb-2">No row caps on plans</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">
                                Flat workspace pricing avoids surprise bills when order volume spikes on 11.11 or paydays—see our pricing page for details.
                            </p>
                        </div>
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                            <h3 className="font-semibold text-white mb-2">Sheets and Looker Studio</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">
                                Keep reporting where marketers already work—no data engineering stack required for standard agency workflows.
                            </p>
                        </div>
                    </div>
                </section>

                {faqs.length > 0 ? (
                    <section className="pb-24 max-w-3xl mx-auto px-4 sm:px-6" aria-labelledby="integration-faq-heading">
                        <h2 id="integration-faq-heading" className="text-2xl font-bold text-center mb-10 text-white">
                            Common questions
                        </h2>
                        <ul className="space-y-6">
                            {faqs.map((item, index) => (
                                <li
                                    key={`${slug}-faq-${index}`}
                                    className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-left"
                                >
                                    <h3 className="text-sm font-semibold text-white mb-2">{item.q}</h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}

                <MarketingTrustSecuritySection />
            </main>

            <MarketingFooter />
        </div>
    );
}
