import { MarketingNavbar } from "@/components/MarketingNavbar";
import { MarketingFooter } from "@/components/MarketingFooter";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";
import Link from "next/link";
import { Metadata } from "next";
import { ArrowRight, CheckCircle2 } from "lucide-react";

const DATA = {
    "tiktok-ads-to-google-sheets": {
        source: "TikTok Ads",
        dest: "Google Sheets™",
        headline: "Connect TikTok Ads to Google Sheets",
        sub: "Automatically pull spend, ROAS, and conversion metrics from TikTok Ads Manager directly into Google Sheets. No coding required.",
    },
    "shopee-to-google-sheets": {
        source: "Shopee",
        dest: "Google Sheets™",
        headline: "Connect Shopee to Google Sheets",
        sub: "Sync orders, inventory, and GMV from Shopee directly to Google Sheets every hour. Perfect for SEA ecommerce sellers.",
    },
    "meta-ads-to-google-sheets": {
        source: "Meta Ads",
        dest: "Google Sheets™",
        headline: "Connect Meta Ads to Google Sheets",
        sub: "Pull your Facebook and Instagram ad performance data into Google Sheets automatically. Say goodbye to manual CSV exports.",
    }
};

type Slug = keyof typeof DATA;

export function generateStaticParams() {
    return Object.keys(DATA).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
    const { slug } = await params;
    const data = DATA[slug as Slug] || DATA["tiktok-ads-to-google-sheets"];
    return {
        title: `${data.headline} Integration`,
        description: data.sub,
        keywords: [data.source, data.dest, "integration", "ETL", "export", "dashboard", "automate"],
    };
}

export default async function IntegrationPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const data = DATA[slug as Slug];

    if (!data) {
        return <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center">Integration not found.</div>;
    }

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

                        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight mb-6">
                            {data.headline}
                        </h1>

                        <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                            {data.sub}
                        </p>

                        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                            <Link href="/register" className="inline-flex items-center gap-2 px-8 py-4 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-xl transition-colors shadow-lg shadow-cyan-900/40">
                                Start your free 14-day trial
                            </Link>
                        </div>
                    </div>
                </section>

                <section className="py-24 max-w-5xl mx-auto px-4 sm:px-6">
                    <h2 className="text-3xl font-bold text-center mb-12">Stop doing this manually</h2>
                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                            <h3 className="font-semibold text-white mb-2">Automated Refresh</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">Schedule your data to update hourly or daily. You'll always wake up to fresh numbers.</p>
                        </div>
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                            <h3 className="font-semibold text-white mb-2">No Row Limits</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">Unlike competitors, we never cap your rows. Pull high-granularity data without paying extra.</p>
                        </div>
                        <div className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <CheckCircle2 className="w-6 h-6 text-cyan-500 mb-4" />
                            <h3 className="font-semibold text-white mb-2">Pre-built Templates</h3>
                            <p className="text-sm text-gray-400 leading-relaxed">Use our plug-and-play dashboard templates to start analyzing instantly.</p>
                        </div>
                    </div>
                </section>

                <MarketingTrustSecuritySection />
            </main>
            
            <MarketingFooter />
        </div>
    );
}
