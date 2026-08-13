"use client";

import Link from "next/link";
import { Check, CheckCircle2, Shield, ShieldCheck, Zap, MapPin } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { MarketingTrustSecuritySection } from "@/components/marketing/MarketingTrustSecuritySection";
import { useState, useEffect } from "react";
import { metaPixelCustom } from "@/lib/meta-pixel";
import { INTEGRATION_LOGOS } from "@/lib/integration-logos";

const PLAN_SOURCES = {
    free: [
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
    ],
    starter: [
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    ],
    pro: [
        { src: INTEGRATION_LOGOS.tiktok, alt: "TikTok Ads" },
        { src: INTEGRATION_LOGOS.shopee, alt: "Shopee" },
        { src: INTEGRATION_LOGOS.meta, alt: "Meta Ads" },
        { src: INTEGRATION_LOGOS.googleAds, alt: "Google Ads" },
    ],
};

const PLAN_DESTINATIONS = [
    { src: INTEGRATION_LOGOS.googleSheets, alt: "Google Sheets" },
    { src: INTEGRATION_LOGOS.looker, alt: "Looker Studio" },
];

function PlatformBadges({ sources, showDestinations = true }: { sources: { src: string; alt: string }[]; showDestinations?: boolean }) {
    return (
        <div className="mb-5">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">Sources</p>
            <div className="flex items-center gap-2 mb-3">
                {sources.map(({ src, alt }) => (
                    <img key={alt} src={src} alt={alt} title={alt} className="w-5 h-5 object-contain opacity-70 hover:opacity-100 transition-opacity" />
                ))}
                {sources.length < 5 && <span className="text-[10px] text-slate-300">+ more coming</span>}
            </div>
            {showDestinations && (
                <>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">Destinations</p>
                    <div className="flex items-center gap-2">
                        {PLAN_DESTINATIONS.map(({ src, alt }) => (
                            <img key={alt} src={src} alt={alt} title={alt} className="w-5 h-5 object-contain opacity-70 hover:opacity-100 transition-opacity" />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("USD");
    const [currencyReady, setCurrencyReady] = useState(false);
    const [regionHint, setRegionHint] = useState<string | null>(null);

    // Default USD on first paint; after IP resolves, VN → VNĐ and optional region label for copy
    useEffect(() => {
        fetch("https://ipapi.co/json/")
            .then((r) => r.json())
            .then((data: { country_code?: string; city?: string }) => {
                setPayCurrency(data.country_code === "VN" ? "VND" : "USD");
                const city = data.city && String(data.city).trim();
                setRegionHint(
                    city
                        ? city
                        : data.country_code === "VN"
                          ? "Vietnam"
                          : (data.country_code as string) || null
                );
            })
            .catch(() => {
                setPayCurrency("USD");
                setRegionHint(null);
            })
            .finally(() => setCurrencyReady(true));
    }, []);

    const VND_RATE = 25000;
    const fmtVnd = (usd: number) => `${(usd * VND_RATE).toLocaleString("vi-VN")}đ`;
    const fmtPrice = (usd: number) =>
        payCurrency === "VND" ? fmtVnd(usd) : `$${usd}`;

    // How much a user saves per year on annual billing
    const yearlySaving = (monthlyUsd: number) => {
        const saving = Math.round(monthlyUsd * 0.2) * 12;
        return payCurrency === "VND" ? fmtVnd(saving) : `$${saving}`;
    };

    const priceClass = "transition-all duration-300";

    return (
        <div className="min-h-screen pt-32 pb-24 bg-white font-sans">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="text-center mb-14">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-cyan-600 border border-cyan-200 bg-cyan-50 tracking-widest uppercase mb-5">
                        Pricing
                    </div>
                    <h1 className="text-slate-900 text-4xl md:text-5xl font-extrabold leading-tight tracking-tight">
                        One flat price. Every platform. No permanent row caps.
                    </h1>
                    <p className="text-slate-500 text-lg max-w-xl mx-auto mt-4">
                        Most teams save $2,400/year vs Supermetrics on Pro. Cancel anytime — billing questions reviewed within 14 days (see our{" "}
                        <Link href="/legal/refund-policy" className="text-cyan-600 hover:text-cyan-700 underline underline-offset-2">
                            Refund Policy
                        </Link>
                        ).
                    </p>
                </div>

                {/* Billing toggle */}
                <div className="flex flex-col items-center gap-3 mb-4">
                    <div className="flex p-1 bg-slate-100 border border-gray-200 rounded-lg w-[240px] text-sm font-medium">
                        <button
                            onClick={() => setIsAnnual(false)}
                            className={`flex h-9 flex-1 items-center justify-center rounded-md transition-all ${
                                !isAnnual ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            Monthly
                        </button>
                        <button
                            onClick={() => setIsAnnual(true)}
                            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md transition-all ${
                                isAnnual ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                            }`}
                        >
                            Annual
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-600 font-bold border border-cyan-200">
                                −20%
                            </span>
                        </button>
                    </div>
                    {/* Auto-detected currency with subtle override */}
                    {currencyReady && (
                        <p className="text-slate-400 text-xs flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 max-w-md text-center">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {regionHint ? (
                                <>
                                    Auto-detected for <span className="text-slate-600 font-medium">{regionHint}</span>
                                    <span className="text-slate-300">·</span>
                                </>
                            ) : null}
                            Showing prices in{" "}
                            <span className="text-slate-600 font-medium">{payCurrency === "VND" ? "VNĐ" : "USD"}</span>
                            <button
                                type="button"
                                onClick={() => setPayCurrency(payCurrency === "VND" ? "USD" : "VND")}
                                className="text-cyan-600 underline underline-offset-2 hover:text-cyan-700 transition-colors"
                            >
                                Switch to {payCurrency === "VND" ? "USD" : "VNĐ"}
                            </button>
                        </p>
                    )}
                </div>

                {/* Pricing Cards — Pro gets extra width via fractional grid */}
                <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">

                    {/* Free */}
                    <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col hover:border-gray-300 transition-colors shadow-sm">
                        <div className="mb-4">
                            <h3 className="text-slate-900 text-lg font-bold">Free</h3>
                            <p className="text-slate-400 text-sm mt-0.5">No card needed</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-4xl font-extrabold text-slate-900">
                                {payCurrency === "VND" ? "0đ" : "$0"}
                            </span>
                            <p className="text-slate-400 text-xs mt-1">per user / month</p>
                        </div>
                        <Link
                            href="/sources"
                            onClick={() =>
                                metaPixelCustom("MC_Pricing_Free_GetStarted", {
                                    plan: "free",
                                    billing_cycle: isAnnual ? "annual" : "monthly",
                                    currency: payCurrency,
                                })
                            }
                            className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold text-center hover:bg-slate-800 transition-colors mb-6"
                        >
                            Get started
                        </Link>
                        <PlatformBadges sources={PLAN_SOURCES.free} />
                        <div className="border-t border-gray-100 pt-4 flex-1">
                            <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mb-3">What&apos;s included</p>
                            <ul className="space-y-2">
                                <FeatureItem>2 active pipelines</FeatureItem>
                                <FeatureItem>Daily sync</FeatureItem>
                                <FeatureItem>Up to 14 days ad report history</FeatureItem>
                                <FeatureItem>TikTok Ads &amp; Shopee connectors</FeatureItem>
                                <FeatureItem>Google Sheets™ add-on</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Starter */}
                    <div className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col hover:border-gray-300 transition-colors shadow-sm">
                        <div className="mb-4">
                            <h3 className="text-slate-900 text-lg font-bold">Starter</h3>
                            <p className="text-slate-400 text-sm mt-0.5">Solo sellers &amp; freelancers</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-4xl font-extrabold text-slate-900">
                                {fmtPrice(isAnnual ? 39 : 39)}
                            </span>
                            <p className="text-slate-400 text-xs mt-1">
                                per user / month
                                {isAnnual && (
                                    <span className="text-cyan-600 ml-1">· save {yearlySaving(49)} /yr</span>
                                )}
                            </p>
                        </div>
                        <CheckoutButton
                            plan="starter"
                            billingCycle={isAnnual ? "annual" : "monthly"}
                            invoiceCurrency={payCurrency}
                            metaPixelEvent="MC_Pricing_Starter_Checkout"
                            metaPixelParams={{
                                billing_cycle: isAnnual ? "annual" : "monthly",
                                currency: payCurrency,
                            }}
                            className="w-full py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold text-center hover:bg-slate-800 transition-colors mb-2"
                        >
                            Get Starter
                        </CheckoutButton>
                        <p className="text-slate-400 text-[10px] text-center mb-6">
                            Invitation-only pilot · plan assigned by an operator
                        </p>
                        <PlatformBadges sources={PLAN_SOURCES.starter} />
                        <div className="border-t border-gray-100 pt-4 flex-1">
                            <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest mb-3">Everything in Free, plus</p>
                            <ul className="space-y-2">
                                <FeatureItem>Workspace-scoped exports</FeatureItem>
                                <FeatureItem>Manual + nightly refresh</FeatureItem>
                                <FeatureItem>CSV + Excel export</FeatureItem>
                                <FeatureItem>Email support</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Pro — hero card */}
                    <div className="relative bg-white border-2 border-cyan-500 rounded-xl p-8 flex flex-col shadow-lg shadow-cyan-500/10 ring-1 ring-cyan-500/20">
                        <div className="mb-4">
                            <div className="flex items-center gap-2.5">
                                <h3 className="text-slate-900 text-xl font-bold">Pro</h3>
                                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200 uppercase tracking-wider">Recommended</span>
                            </div>
                            <p className="text-cyan-600 text-sm mt-0.5">Best value for growing teams</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-5xl font-extrabold text-slate-900">
                                {fmtPrice(isAnnual ? 119 : 149)}
                            </span>
                            <p className="text-slate-500 text-xs mt-1">
                                per user / month
                                {isAnnual && (
                                    <span className="text-cyan-600 ml-1">· save {yearlySaving(149)} /yr</span>
                                )}
                            </p>
                        </div>
                        <CheckoutButton
                            plan="professional"
                            billingCycle={isAnnual ? "annual" : "monthly"}
                            invoiceCurrency={payCurrency}
                            metaPixelEvent="MC_Pricing_Pro_Checkout"
                            metaPixelParams={{
                                billing_cycle: isAnnual ? "annual" : "monthly",
                                currency: payCurrency,
                            }}
                            className="w-full py-3 rounded-lg bg-cyan-600 text-white text-sm font-bold text-center hover:bg-cyan-700 transition-colors mb-1 shadow-lg shadow-cyan-600/20"
                        >
                            Continue to secure checkout
                        </CheckoutButton>
                        <p className="text-slate-400 text-[10px] text-center mb-6">
                            Public checkout is not available during the pilot
                        </p>
                        <PlatformBadges sources={PLAN_SOURCES.pro} />
                        <div className="border-t border-cyan-200 pt-4 flex-1">
                            <p className="text-cyan-600/70 text-[10px] font-semibold uppercase tracking-widest mb-3">Everything in Starter, plus</p>
                            <ul className="space-y-2">
                                <FeatureItem accent>Multi-staff agency workspace</FeatureItem>
                                <FeatureItem accent>Manual + nightly refresh</FeatureItem>
                                <FeatureItem accent>Workspace API keys</FeatureItem>
                                <FeatureItem accent>Freshness and sync activity</FeatureItem>
                                <FeatureItem accent>Higher API rate limits &amp; priority exports</FeatureItem>
                                <FeatureItem accent>Priority email support</FeatureItem>
                            </ul>
                        </div>
                    </div>

                </div>

                <p className="mt-10 text-center text-sm text-slate-500">
                    Need more than 15 pipelines, dedicated hosting, or custom connectors?{" "}
                    <Link
                        href="mailto:hello@monsteracloud.com"
                        onClick={() =>
                            metaPixelCustom("MC_Pricing_Enterprise_Contact", {
                                plan: "enterprise",
                                currency: payCurrency,
                            })
                        }
                        className="text-cyan-600 hover:text-cyan-700 underline underline-offset-2"
                    >
                        Talk to us about Enterprise
                    </Link>
                </p>

                {/* All plans include */}
                <div className="mt-14 text-center">
                    <p className="text-slate-400 text-xs uppercase tracking-widest font-semibold mb-5">All plans include</p>
                    <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-slate-500 text-sm">
                        {["AES-256-GCM credential encryption", "OAuth 2.0 authentication", "Invitation-only access", "Workspace-scoped roles", "Manual + nightly refresh"].map((item) => (
                            <span key={item} className="flex items-center gap-2">
                                <Check className="w-3.5 h-3.5 text-cyan-500" />
                                {item}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Feature Comparison Table */}
                <div className="mt-20 overflow-hidden border border-gray-200 rounded-xl bg-white">
                    <div className="p-6 border-b border-gray-100">
                        <h3 className="text-slate-900 text-sm font-bold uppercase tracking-widest">Compare plans</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[520px] text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="py-3 px-6 text-slate-400 text-xs font-semibold uppercase tracking-widest border-r border-gray-100 w-1/3">Spec</th>
                                    <th className="py-3 px-4 text-slate-900 text-xs font-bold text-center border-r border-gray-100">Free</th>
                                    <th className="py-3 px-4 text-slate-900 text-xs font-bold text-center border-r border-gray-100">Starter</th>
                                    <th className="py-3 px-4 text-cyan-600 text-xs font-bold text-center bg-cyan-50/50">Pro ✦</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                <CompareRow label="Workspace access" values={["Invite", "Invite", "Invite"]} />
                                <CompareRow label="Refresh" values={["Manual + nightly", "Manual + nightly", "Manual + nightly"]} />
                                <CompareRow label="Data Explorer" values={[true, true, true]} />
                                <CompareRow label="Sync activity" values={[true, true, true]} />
                                <CompareRow label="CSV / Excel Export" values={[false, true, true]} />
                                <CompareRow label="Google Sheets™ Add-on" values={[true, true, true]} />
                                <CompareRow label="API requests (per min)" values={["60", "300", "1000+"]} />
                                <CompareRow label="Max sync rows (per request)" values={["5k", "20k", "50k"]} />
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FAQ Section */}
                <div className="mt-28 max-w-4xl mx-auto border-t border-gray-100 pt-20">
                    <div className="text-center mb-12">
                        <h2 className="text-slate-900 text-2xl md:text-3xl font-bold tracking-tight">Frequently asked questions</h2>
                    </div>
                    <div className="grid md:grid-cols-2 gap-x-12 gap-y-10">
                        <div>
                            <h4 className="text-slate-900 font-semibold text-sm mb-2.5">What happens if I hit a row limit?</h4>
                                <p className="text-slate-500 text-sm leading-relaxed">We don't impose permanent row caps — however, very large synchronous exports are limited to keep performance predictable. Small-to-medium requests are served live; very large exports are handled asynchronously via our job queue (you'll receive a job ID and status). We also enforce per-API-key rate limits to protect service quality (see plan comparison above). If you need higher throughput, upgrade to a higher tier or contact Sales for Enterprise options.</p>
                        </div>
                        <div>
                            <h4 className="text-slate-900 font-semibold text-sm mb-2.5">Is my store and ad data secure?</h4>
                            <p className="text-slate-500 text-sm leading-relaxed">Yes. We use OAuth 2.0 so we never see or store your passwords. All data in transit is encrypted using TLS 1.3, and we do not store your raw ad data on our servers—it streams safely to your destination.</p>
                        </div>
                        <div>
                            <h4 className="text-slate-900 font-semibold text-sm mb-2.5">Do you offer refunds?</h4>
                            <p className="text-slate-500 text-sm leading-relaxed">Yes, you can cancel at any time. If you have billing issues or are unsatisfied with the product, our 14-day transparent refund policy covers you. Just contact our email support.</p>
                        </div>
                        <div>
                            <h4 className="text-slate-900 font-semibold text-sm mb-2.5">Can I upgrade to annual billing later?</h4>
                            <p className="text-slate-500 text-sm leading-relaxed">Absolutely. You can switch to annual billing at any point from your dashboard settings to instantly secure the 20% discount.</p>
                        </div>
                    </div>
                </div>

                {/* Trust footer */}
                <div className="mt-24 pt-12 border-t border-gray-200 text-center">
                    <div className="flex justify-center gap-12 text-slate-400">
                        <div className="flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                            <ShieldCheck className="w-6 h-6 text-slate-600" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">256-bit encrypted</span>
                        </div>
                        <div className="flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                            <Shield className="w-6 h-6 text-slate-600" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">OAuth 2.0</span>
                        </div>
                        <div className="flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                            <Zap className="w-6 h-6 text-slate-600" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">VND + USD billing</span>
                        </div>
                    </div>
                    <p className="mt-10 text-[10px] text-slate-400 max-w-xl mx-auto leading-relaxed">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
                    </p>
                </div>

                <MarketingTrustSecuritySection />
            </div>
        </div>
    );
}

function FeatureItem({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
    return (
        <li className={`flex items-start gap-2.5 text-sm ${accent ? "text-slate-700" : "text-slate-500"}`}>
            <Check className={`w-4 h-4 shrink-0 mt-0.5 ${accent ? "text-cyan-500" : "text-cyan-500"}`} />
            {children}
        </li>
    );
}

function CompareRow({ label, values }: { label: string; values: (string | boolean)[] }) {
    const proCol = values.length - 1;
    return (
        <tr className="hover:bg-slate-50/50 transition-colors">
            <td className="py-3.5 px-6 text-slate-600 font-medium border-r border-gray-100">{label}</td>
            {values.map((v, i) => (
                <td
                    key={i}
                    className={`py-3.5 px-4 text-center border-r border-gray-100 last:border-r-0 ${i === proCol ? "bg-cyan-50/50" : ""}`}
                >
                    {typeof v === "boolean" ? (
                        v ? (
                            <CheckCircle2 className="inline w-4 h-4 text-cyan-500" />
                        ) : (
                            <span className="text-slate-300">—</span>
                        )
                    ) : (
                        <span className={i === proCol ? "text-cyan-600 font-semibold" : "text-slate-500"}>{v}</span>
                    )}
                </td>
            ))}
        </tr>
    );
}
