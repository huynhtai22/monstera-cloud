"use client";

import Link from "next/link";
import { Check, CheckCircle2, Shield, ShieldCheck, Zap } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { useState } from "react";

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);
    const [payCurrency, setPayCurrency] = useState<"VND" | "USD">("VND");

    const VND_RATE = 25000;
    const fmtVnd = (usd: number) => `${(usd * VND_RATE).toLocaleString("vi-VN")}đ`;
    const fmtPrice = (usd: number) =>
        payCurrency === "VND" ? fmtVnd(usd) : `$${usd}`;

    return (
        <div className="min-h-screen pt-32 pb-24 bg-[#09090b] font-sans">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="text-center space-y-4 mb-16">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 tracking-widest uppercase mb-4">
                        Simple Pricing
                    </div>
                    <h1 className="text-white text-4xl md:text-5xl font-extrabold leading-tight tracking-tight">
                        Stop paying per row.
                    </h1>
                    <p className="text-gray-400 text-lg max-w-xl mx-auto">
                        Flat-rate pricing for TikTok Ads reporting, Shopee data, and Google Sheets.{" "}
                        <span className="text-white font-medium">Pay in VND or USD.</span>
                    </p>
                </div>

                {/* Toggles */}
                <div className="flex flex-col items-center gap-4 mb-12">
                    {/* Billing cycle */}
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
                    {/* Currency */}
                    <div className="flex p-1 bg-[#18181b] border border-white/10 rounded-lg w-[240px] text-sm font-medium">
                        <button
                            onClick={() => setPayCurrency("VND")}
                            className={`flex h-9 flex-1 items-center justify-center rounded-md transition-all ${
                                payCurrency === "VND" ? "bg-white/10 text-white" : "text-gray-400 hover:text-gray-200"
                            }`}
                        >
                            VNĐ
                        </button>
                        <button
                            onClick={() => setPayCurrency("USD")}
                            className={`flex h-9 flex-1 items-center justify-center rounded-md transition-all ${
                                payCurrency === "USD" ? "bg-white/10 text-white" : "text-gray-400 hover:text-gray-200"
                            }`}
                        >
                            USD
                        </button>
                    </div>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">

                    {/* Free */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col hover:border-white/20 transition-colors">
                        <div className="mb-5">
                            <h3 className="text-white text-lg font-bold">Free</h3>
                            <p className="text-gray-400 text-sm mt-0.5">Get started, no card needed</p>
                        </div>
                        <div className="mb-6">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-extrabold text-white">
                                    {payCurrency === "VND" ? "0đ" : "$0"}
                                </span>
                            </div>
                            <p className="text-gray-500 text-sm mt-1">per user / month</p>
                        </div>
                        <div className="flex flex-col gap-2 mb-8">
                            <Link
                                href="/register"
                                className="w-full py-2.5 rounded-lg bg-white text-black text-sm font-semibold text-center hover:bg-gray-100 transition-colors"
                            >
                                Get started
                            </Link>
                        </div>
                        <div className="border-t border-white/5 pt-6 flex-1">
                            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-4">
                                What&apos;s included
                            </p>
                            <ul className="space-y-3">
                                <FeatureItem>1 active pipeline</FeatureItem>
                                <FeatureItem>Weekly sync</FeatureItem>
                                <FeatureItem>TikTok Ads &amp; Shopee connectors</FeatureItem>
                                <FeatureItem>Google Sheets add-on</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Starter */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col hover:border-white/20 transition-colors">
                        <div className="mb-5">
                            <h3 className="text-white text-lg font-bold">Starter</h3>
                            <p className="text-gray-400 text-sm mt-0.5">Solo sellers &amp; freelancers</p>
                        </div>
                        <div className="mb-6">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-extrabold text-white">
                                    {fmtPrice(isAnnual ? 39 : 49)}
                                </span>
                            </div>
                            <p className="text-gray-500 text-sm mt-1">
                                per user / month{isAnnual && <span className="text-emerald-500 ml-1">· billed annually</span>}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 mb-8">
                            <CheckoutButton
                                plan="starter"
                                billingCycle={isAnnual ? "annual" : "monthly"}
                                invoiceCurrency={payCurrency}
                                className="w-full py-2.5 rounded-lg bg-white text-black text-sm font-semibold text-center hover:bg-gray-100 transition-colors"
                            >
                                Get started
                            </CheckoutButton>
                        </div>
                        <div className="border-t border-white/5 pt-6 flex-1">
                            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-4">
                                Everything in Free and
                            </p>
                            <ul className="space-y-3">
                                <FeatureItem>5 active pipelines</FeatureItem>
                                <FeatureItem>Daily sync</FeatureItem>
                                <FeatureItem>CSV + Excel export</FeatureItem>
                                <FeatureItem>Email support</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Pro — most popular */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col ring-2 ring-emerald-500 relative">
                        <div className="mb-5 flex items-center gap-2">
                            <h3 className="text-white text-lg font-bold">Pro</h3>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white tracking-widest uppercase">
                                Most popular
                            </span>
                        </div>
                        <div className="mb-6">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-extrabold text-white">
                                    {fmtPrice(isAnnual ? 119 : 149)}
                                </span>
                            </div>
                            <p className="text-gray-500 text-sm mt-1">
                                per user / month{isAnnual && <span className="text-emerald-500 ml-1">· billed annually</span>}
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 mb-8">
                            <CheckoutButton
                                plan="professional"
                                billingCycle={isAnnual ? "annual" : "monthly"}
                                invoiceCurrency={payCurrency}
                                className="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold text-center hover:bg-emerald-500 transition-colors"
                            >
                                Try for 14 days free
                            </CheckoutButton>
                        </div>
                        <div className="border-t border-white/5 pt-6 flex-1">
                            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-4">
                                Everything in Starter and
                            </p>
                            <ul className="space-y-3">
                                <FeatureItem>15 active pipelines</FeatureItem>
                                <FeatureItem>Hourly sync</FeatureItem>
                                <FeatureItem>15 TikTok report runs / hour</FeatureItem>
                                <FeatureItem>Priority job queue</FeatureItem>
                                <FeatureItem>Priority email support</FeatureItem>
                            </ul>
                        </div>
                    </div>

                    {/* Enterprise */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col hover:border-white/20 transition-colors">
                        <div className="mb-5">
                            <h3 className="text-white text-lg font-bold">Enterprise</h3>
                            <p className="text-gray-400 text-sm mt-0.5">Scale with custom solutions</p>
                        </div>
                        <div className="mb-6">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-extrabold text-white">
                                    {fmtPrice(499)}
                                </span>
                            </div>
                            <p className="text-gray-500 text-sm mt-1">per user / month · custom quote</p>
                        </div>
                        <div className="flex flex-col gap-2 mb-8">
                            <Link
                                href="mailto:hello@monsteracloud.com"
                                className="w-full py-2.5 rounded-lg border border-white/20 text-white text-sm font-semibold text-center hover:bg-white/5 transition-colors"
                            >
                                Contact us
                            </Link>
                        </div>
                        <div className="border-t border-white/5 pt-6 flex-1">
                            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-4">
                                Everything in Pro and
                            </p>
                            <ul className="space-y-3">
                                <FeatureItem>Unlimited pipelines</FeatureItem>
                                <FeatureItem>15-minute sync</FeatureItem>
                                <FeatureItem>Dedicated tenant hosting</FeatureItem>
                                <FeatureItem>Direct Slack support line</FeatureItem>
                                <FeatureItem>Custom connector development</FeatureItem>
                            </ul>
                        </div>
                    </div>

                </div>

                {/* Feature Comparison Table */}
                <div className="mt-20 overflow-hidden border border-white/10 rounded-xl bg-[#18181b]">
                    <div className="p-6 border-b border-white/5">
                        <h3 className="text-white text-base font-bold uppercase tracking-widest">Technical specifications</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[640px] text-sm">
                            <thead className="bg-[#09090b]">
                                <tr>
                                    <th className="py-3 px-6 text-gray-500 text-xs font-semibold uppercase tracking-widest border-r border-white/5 w-1/3">Spec</th>
                                    <th className="py-3 px-4 text-white text-xs font-bold text-center border-r border-white/5">Free</th>
                                    <th className="py-3 px-4 text-white text-xs font-bold text-center border-r border-white/5">Starter</th>
                                    <th className="py-3 px-4 text-emerald-400 text-xs font-bold text-center bg-emerald-900/10 border-r border-white/5">Pro</th>
                                    <th className="py-3 px-4 text-white text-xs font-bold text-center">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                <CompareRow label="Active Pipelines" values={["1", "5", "15", "Unlimited"]} />
                                <CompareRow label="Sync Frequency" values={["Weekly", "Daily", "Hourly", "15 min"]} />
                                <CompareRow label="TikTok Report Cooldown" values={["60 min", "15 min", "15 min", "5 min"]} />
                                <CompareRow label="Job Queue Priority" values={["Low", "Normal", "High", "Highest"]} />
                                <CompareRow label="CSV / Excel Export" values={[false, true, true, true]} />
                                <CompareRow label="Google Sheets Add-on" values={[true, true, true, true]} />
                                <CompareRow label="Dedicated Hosting" values={[false, false, false, true]} />
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Trust */}
                <div className="mt-20 pt-16 border-t border-white/10 text-center">
                    <p className="text-gray-500 text-xs uppercase tracking-widest font-semibold mb-8">Secure infrastructure</p>
                    <div className="flex justify-center gap-16 text-gray-400">
                        <div className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
                            <ShieldCheck className="w-7 h-7 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">256-bit encrypted</span>
                        </div>
                        <div className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
                            <Shield className="w-7 h-7 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">OAuth 2.0</span>
                        </div>
                        <div className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
                            <Zap className="w-7 h-7 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">VND + USD billing</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

function FeatureItem({ children }: { children: React.ReactNode }) {
    return (
        <li className="flex items-start gap-2.5 text-gray-300 text-sm">
            <Check className="text-emerald-500 w-4 h-4 shrink-0 mt-0.5" />
            {children}
        </li>
    );
}

function CompareRow({
    label,
    values,
}: {
    label: string;
    values: (string | boolean)[];
}) {
    return (
        <tr className="hover:bg-white/[0.02] transition-colors">
            <td className="py-3.5 px-6 text-gray-300 font-medium border-r border-white/5">{label}</td>
            {values.map((v, i) => (
                <td
                    key={i}
                    className={`py-3.5 px-4 text-center border-r border-white/5 last:border-r-0 ${
                        i === 2 ? "bg-emerald-900/10" : ""
                    }`}
                >
                    {typeof v === "boolean" ? (
                        v ? (
                            <CheckCircle2 className="inline w-4 h-4 text-emerald-500" />
                        ) : (
                            <span className="text-gray-600">—</span>
                        )
                    ) : (
                        <span className={i === 2 ? "text-emerald-400 font-semibold" : "text-gray-400"}>
                            {v}
                        </span>
                    )}
                </td>
            ))}
        </tr>
    );
}
