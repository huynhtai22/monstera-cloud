"use client";

import Link from "next/link";
import { Check, CheckCircle2, Shield, ShieldCheck, Zap, MapPin } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { useState, useEffect } from "react";
import { metaPixelCustom } from "@/lib/meta-pixel";

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("USD");
    const [currencyReady, setCurrencyReady] = useState(false);

    // Auto-detect currency from visitor IP — VN → VNĐ, everywhere else → USD
    useEffect(() => {
        fetch("https://ipapi.co/json/")
            .then((r) => r.json())
            .then((data) => {
                setPayCurrency(data.country_code === "VN" ? "VND" : "USD");
            })
            .catch(() => setPayCurrency("USD"))
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

    const priceClass = currencyReady ? "transition-all duration-300" : "opacity-0";

    return (
        <div className="min-h-screen pt-32 pb-24 bg-[#09090b] font-sans">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="text-center mb-14">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 tracking-widest uppercase mb-5">
                        Simple Pricing
                    </div>
                    <h1 className="text-white text-4xl md:text-5xl font-extrabold leading-tight tracking-tight">
                        Stop paying per row.
                    </h1>
                    <p className="text-gray-400 text-lg max-w-xl mx-auto mt-4">
                        Flat-rate pricing for TikTok Ads reporting, Shopee data, and Google Sheets™.
                    </p>
                </div>

                {/* Billing toggle */}
                <div className="flex flex-col items-center gap-3 mb-4">
                    <div className="flex p-1 bg-[#18181b] border border-white/10 rounded-lg w-[240px] text-sm font-medium">
                        <button
                            onClick={() => setIsAnnual(false)}
                            className={`flex h-9 flex-1 items-center justify-center rounded-md transition-all ${
                                !isAnnual ? "bg-white/10 text-white" : "text-gray-400 hover:text-gray-200"
                            }`}
                        >
                            Monthly
                        </button>
                        <button
                            onClick={() => setIsAnnual(true)}
                            className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md transition-all ${
                                isAnnual ? "bg-white/10 text-white" : "text-gray-400 hover:text-gray-200"
                            }`}
                        >
                            Annual
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 font-bold border border-emerald-500/20">
                                −20%
                            </span>
                        </button>
                    </div>
                    {/* Auto-detected currency with subtle override */}
                    {currencyReady && (
                        <p className="text-gray-500 text-xs flex items-center gap-1.5">
                            <MapPin className="w-3 h-3" />
                            Showing prices in <span className="text-gray-300 font-medium">{payCurrency === "VND" ? "VNĐ" : "USD"}</span>
                            <button
                                onClick={() => setPayCurrency(payCurrency === "VND" ? "USD" : "VND")}
                                className="text-emerald-500 underline underline-offset-2 hover:text-emerald-400 transition-colors"
                            >
                                Switch to {payCurrency === "VND" ? "USD" : "VNĐ"}
                            </button>
                        </p>
                    )}
                </div>

                {/* Pricing Cards — Pro gets extra width via fractional grid */}
                <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_1.18fr_1fr] gap-4 items-start">

                    {/* Free */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col hover:border-white/20 transition-colors">
                        <div className="mb-4">
                            <h3 className="text-white text-lg font-bold">Free</h3>
                            <p className="text-gray-500 text-sm mt-0.5">No card needed</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-4xl font-extrabold text-white">
                                {payCurrency === "VND" ? "0đ" : "$0"}
                            </span>
                            <p className="text-gray-500 text-xs mt-1">per user / month</p>
                        </div>
                        <Link
                            href="/register"
                            onClick={() =>
                                metaPixelCustom("MC_Pricing_Free_GetStarted", {
                                    plan: "free",
                                    billing_cycle: isAnnual ? "annual" : "monthly",
                                    currency: payCurrency,
                                })
                            }
                            className="w-full py-2.5 rounded-lg bg-white text-black text-sm font-semibold text-center hover:bg-gray-100 transition-colors mb-6"
                        >
                            Get started
                        </Link>
                        <div className="border-t border-white/5 pt-5 flex-1">
                            <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-3">What&apos;s included</p>
                            <ul className="space-y-2.5">
                                <FeatureItem>1 active pipeline</FeatureItem>
                                <FeatureItem>Weekly sync</FeatureItem>
                                <FeatureItem>TikTok Ads &amp; Shopee connectors</FeatureItem>
                                <FeatureItem>Google Sheets™ add-on</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Starter */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col hover:border-white/20 transition-colors">
                        <div className="mb-4">
                            <h3 className="text-white text-lg font-bold">Starter</h3>
                            <p className="text-gray-500 text-sm mt-0.5">Solo sellers &amp; freelancers</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-4xl font-extrabold text-white">
                                {fmtPrice(isAnnual ? 39 : 49)}
                            </span>
                            <p className="text-gray-500 text-xs mt-1">
                                per user / month
                                {isAnnual && (
                                    <span className="text-emerald-500 ml-1">· save {yearlySaving(49)} /yr</span>
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
                            className="w-full py-2.5 rounded-lg bg-white text-black text-sm font-semibold text-center hover:bg-gray-100 transition-colors mb-6"
                        >
                            Get started
                        </CheckoutButton>
                        <div className="border-t border-white/5 pt-5 flex-1">
                            <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-3">Everything in Free and</p>
                            <ul className="space-y-2.5">
                                <FeatureItem>5 active pipelines</FeatureItem>
                                <FeatureItem>Daily sync</FeatureItem>
                                <FeatureItem>CSV + Excel export</FeatureItem>
                                <FeatureItem>Email support</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Pro — hero card, slightly wider + taller */}
                    <div className="relative bg-[#0d1f18] border-2 border-emerald-500 rounded-xl p-8 flex flex-col shadow-[0_0_50px_rgba(16,185,129,0.12)] ring-1 ring-emerald-500/30">
                        {/* Top badge */}
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[10px] font-bold px-4 py-1 rounded-full tracking-widest uppercase whitespace-nowrap shadow-lg">
                            Most popular
                        </div>
                        <div className="mb-4 mt-2">
                            <h3 className="text-white text-xl font-bold">Pro</h3>
                            <p className="text-emerald-400 text-sm mt-0.5">Best value for growing teams</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-5xl font-extrabold text-white">
                                {fmtPrice(isAnnual ? 119 : 149)}
                            </span>
                            <p className="text-gray-400 text-xs mt-1">
                                per user / month
                                {isAnnual && (
                                    <span className="text-emerald-400 ml-1">· save {yearlySaving(149)} /yr</span>
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
                            className="w-full py-3 rounded-lg bg-emerald-600 text-white text-sm font-bold text-center hover:bg-emerald-500 transition-colors mb-1 shadow-lg shadow-emerald-600/30"
                        >
                            Try for 14 days free
                        </CheckoutButton>
                        <p className="text-gray-500 text-[10px] text-center mb-6">No contract · cancel anytime</p>
                        <div className="border-t border-emerald-500/20 pt-5 flex-1">
                            <p className="text-emerald-400/70 text-[10px] font-semibold uppercase tracking-widest mb-3">Everything in Starter and</p>
                            <ul className="space-y-2.5">
                                <FeatureItem accent>15 active pipelines</FeatureItem>
                                <FeatureItem accent>Hourly sync</FeatureItem>
                                <FeatureItem accent>15 TikTok report runs / hour</FeatureItem>
                                <FeatureItem accent>Priority job queue</FeatureItem>
                                <FeatureItem accent>Priority email support</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Enterprise */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col hover:border-white/20 transition-colors">
                        <div className="mb-4">
                            <h3 className="text-white text-lg font-bold">Enterprise</h3>
                            <p className="text-gray-500 text-sm mt-0.5">Scale with custom solutions</p>
                        </div>
                        <div className={`mb-5 ${priceClass}`}>
                            <span className="text-3xl font-extrabold text-white">
                                from {fmtPrice(499)}
                            </span>
                            <p className="text-gray-500 text-xs mt-1">per user / month · custom quote</p>
                        </div>
                        <Link
                            href="mailto:hello@monsteracloud.com"
                            onClick={() =>
                                metaPixelCustom("MC_Pricing_Enterprise_Contact", {
                                    plan: "enterprise",
                                    currency: payCurrency,
                                })
                            }
                            className="w-full py-2.5 rounded-lg border border-white/20 text-white text-sm font-semibold text-center hover:bg-white/5 transition-colors mb-6"
                        >
                            Contact us
                        </Link>
                        <div className="border-t border-white/5 pt-5 flex-1">
                            <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-widest mb-3">Everything in Pro and</p>
                            <ul className="space-y-2.5">
                                <FeatureItem>Unlimited pipelines</FeatureItem>
                                <FeatureItem>15-minute sync</FeatureItem>
                                <FeatureItem>Dedicated tenant hosting</FeatureItem>
                                <FeatureItem>Direct Slack support line</FeatureItem>
                                <FeatureItem>Custom connector development</FeatureItem>
                            </ul>
                        </div>
                    </div>

                </div>

                {/* All plans include */}
                <div className="mt-14 text-center">
                    <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-5">All plans include</p>
                    <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-gray-400 text-sm">
                        {["256-bit encryption", "OAuth 2.0 auth", "VND + USD billing", "Uptime SLA", "GDPR-ready data handling"].map((item) => (
                            <span key={item} className="flex items-center gap-2">
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                {item}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Feature Comparison Table */}
                <div className="mt-20 overflow-hidden border border-white/10 rounded-xl bg-[#18181b]">
                    <div className="p-6 border-b border-white/5">
                        <h3 className="text-white text-sm font-bold uppercase tracking-widest">Compare plans</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[640px] text-sm">
                            <thead className="bg-[#09090b]">
                                <tr>
                                    <th className="py-3 px-6 text-gray-500 text-xs font-semibold uppercase tracking-widest border-r border-white/5 w-1/3">Spec</th>
                                    <th className="py-3 px-4 text-white text-xs font-bold text-center border-r border-white/5">Free</th>
                                    <th className="py-3 px-4 text-white text-xs font-bold text-center border-r border-white/5">Starter</th>
                                    <th className="py-3 px-4 text-emerald-400 text-xs font-bold text-center bg-emerald-900/10 border-r border-white/5">Pro ✦</th>
                                    <th className="py-3 px-4 text-white text-xs font-bold text-center">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                <CompareRow label="Active Pipelines" values={["1", "5", "15", "Unlimited"]} />
                                <CompareRow label="Sync Frequency" values={["Weekly", "Daily", "Hourly", "15 min"]} />
                                <CompareRow label="TikTok Report Cooldown" values={["60 min", "15 min", "15 min", "5 min"]} />
                                <CompareRow label="Job Queue Priority" values={["Low", "Normal", "High", "Highest"]} />
                                <CompareRow label="CSV / Excel Export" values={[false, true, true, true]} />
                                <CompareRow label="Google Sheets™ Add-on" values={[true, true, true, true]} />
                                <CompareRow label="Dedicated Hosting" values={[false, false, false, true]} />
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Trust footer */}
                <div className="mt-16 pt-12 border-t border-white/10 text-center">
                    <div className="flex justify-center gap-12 text-gray-400">
                        <div className="flex flex-col items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                            <ShieldCheck className="w-6 h-6 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">256-bit encrypted</span>
                        </div>
                        <div className="flex flex-col items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                            <Shield className="w-6 h-6 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">OAuth 2.0</span>
                        </div>
                        <div className="flex flex-col items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                            <Zap className="w-6 h-6 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">VND + USD billing</span>
                        </div>
                    </div>
                    <p className="mt-10 text-[10px] text-gray-600 max-w-xl mx-auto leading-relaxed">
                        Google Sheets™ and Google Workspace™ are trademarks of Google LLC.
                    </p>
                </div>

            </div>
        </div>
    );
}

function FeatureItem({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
    return (
        <li className={`flex items-start gap-2.5 text-sm ${accent ? "text-gray-200" : "text-gray-400"}`}>
            <Check className={`w-4 h-4 shrink-0 mt-0.5 ${accent ? "text-emerald-400" : "text-emerald-500"}`} />
            {children}
        </li>
    );
}

function CompareRow({ label, values }: { label: string; values: (string | boolean)[] }) {
    return (
        <tr className="hover:bg-white/[0.02] transition-colors">
            <td className="py-3.5 px-6 text-gray-300 font-medium border-r border-white/5">{label}</td>
            {values.map((v, i) => (
                <td
                    key={i}
                    className={`py-3.5 px-4 text-center border-r border-white/5 last:border-r-0 ${i === 2 ? "bg-emerald-900/10" : ""}`}
                >
                    {typeof v === "boolean" ? (
                        v ? (
                            <CheckCircle2 className="inline w-4 h-4 text-emerald-500" />
                        ) : (
                            <span className="text-gray-600">—</span>
                        )
                    ) : (
                        <span className={i === 2 ? "text-emerald-400 font-semibold" : "text-gray-400"}>{v}</span>
                    )}
                </td>
            ))}
        </tr>
    );
}
