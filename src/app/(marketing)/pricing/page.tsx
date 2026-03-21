"use client";

import Link from "next/link";
import { CheckCircle2, X, Check, ShieldCheck, Shield, Zap } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { useState } from "react";

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);

    return (
        <div className="min-h-screen pt-32 pb-24 bg-white dark:bg-slate-950 font-sans">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                <div className="text-center space-y-4 mb-12">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium text-emerald-800 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30 ring-1 ring-inset ring-emerald-600/20 mb-6 font-semibold">
                        Simple, Flat Pricing
                    </div>
                    <h1 className="text-slate-900 dark:text-white text-4xl md:text-6xl font-extrabold leading-tight tracking-tight">Stop paying per row.</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-lg md:text-xl font-normal max-w-2xl mx-auto">
                        Legacy ELT tools punish you for growth. Monstera Cloud gives you <span className="font-semibold text-slate-900 dark:text-white">unlimited syncs</span> for one transparent flat fee.
                    </p>
                </div>

                {/* Billing Toggle */}
                <div className="flex p-1 mb-16 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-[280px] mx-auto relative z-10">
                    <button 
                        onClick={() => setIsAnnual(false)}
                        className={`flex h-10 grow items-center justify-center rounded-md px-2 transition-all text-sm font-semibold ${!isAnnual ? 'bg-white dark:bg-slate-800 shadow-sm text-emerald-700 dark:text-emerald-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        Monthly
                    </button>
                    <button 
                        onClick={() => setIsAnnual(true)}
                        className={`flex h-10 grow items-center justify-center rounded-md px-2 transition-all text-sm font-semibold ${isAnnual ? 'bg-white dark:bg-slate-800 shadow-sm text-emerald-700 dark:text-emerald-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        <span className="flex items-center gap-1.5">Annual <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 font-bold">SAVE 20%</span></span>
                    </button>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
                    
                    {/* Free Plan */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-xl font-bold">Free</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">For testing the waters</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">$0</span>
                                <span className="text-slate-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                1 Active Pipeline
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Premium APAC Connectors
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Weekly Sync Frequency
                            </li>
                        </ul>
                        <Link href="/dashboard" className="text-center w-full py-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            Start Building
                        </Link>
                    </div>

                    {/* Starter Plan */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-xl font-bold">Starter</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">Solo & Indie Hackers</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                                    ${isAnnual ? '39' : '49'}
                                </span>
                                <span className="text-slate-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                5 Active Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Daily Sync Frequency
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Basic Transformations
                            </li>
                        </ul>
                        <CheckoutButton plan="starter" className="w-full py-3 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                            Upgrade to Starter
                        </CheckoutButton>
                    </div>

                    {/* Pro Plan (Most Popular) */}
                    <div className="border-2 border-emerald-500 dark:border-emerald-600 bg-white dark:bg-slate-900 shadow-xl rounded-xl p-6 relative overflow-hidden flex flex-col h-full md:-translate-y-4">
                        <div className="absolute top-0 inset-x-0 bg-emerald-500 dark:bg-emerald-600 text-white text-[10px] font-bold px-4 py-1 text-center uppercase tracking-widest z-10">
                            Most Popular
                        </div>
                        <div className="flex justify-between items-start mt-4 mb-6 z-10 relative">
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-xl font-bold">Pro</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">For growing brands</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">
                                    ${isAnnual ? '119' : '149'}
                                </span>
                                <span className="text-slate-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1 z-10 relative">
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                15 Active Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                Hourly Sync Frequency
                            </li>
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                PII Masking & Currency
                            </li>
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                Priority Support
                            </li>
                        </ul>
                        <div className="z-10 relative">
                            <CheckoutButton plan="professional" className="w-full py-3 rounded-lg bg-emerald-600 text-white font-bold shadow-md shadow-emerald-600/20 hover:bg-emerald-700 transition-all">
                                Subscribe to Pro
                            </CheckoutButton>
                        </div>
                    </div>

                    {/* Enterprise Plan */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm flex flex-col h-full">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-xl font-bold">Enterprise</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">Custom architectures</p>
                            </div>
                            <div className="text-right">
                                <span className="text-lg font-bold text-slate-500 line-through block decoration-slate-300"></span>
                                <span className="text-2xl font-bold text-slate-900 dark:text-white block mt-1">from $499</span>
                                <span className="text-slate-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Unlimited Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                15-Minute Sync Frequency
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Custom VPC Deployment
                            </li>
                            <li className="flex items-start gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Dedicated Slack Channel
                            </li>
                        </ul>
                        <Link href="/solutions" className="block text-center w-full py-3 rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-bold hover:bg-slate-800 transition-colors">
                            Talk to Sales
                        </Link>
                    </div>
                </div>

                {/* Feature Comparison Table */}
                <div className="mt-24 overflow-hidden max-w-6xl mx-auto border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-sm">
                    <h3 className="text-slate-900 dark:text-white text-2xl font-bold mb-0 p-8 text-center border-b border-slate-200 dark:border-slate-800">Compare Features</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead className="bg-slate-50 dark:bg-slate-900/50">
                                <tr>
                                    <th className="py-4 px-6 font-semibold text-slate-500 dark:text-slate-400 text-sm uppercase tracking-wider">Features</th>
                                    <th className="py-4 px-4 font-bold text-slate-900 dark:text-white text-sm text-center">Free</th>
                                    <th className="py-4 px-4 font-bold text-slate-900 dark:text-white text-sm text-center">Starter</th>
                                    <th className="py-4 px-4 font-bold text-emerald-700 dark:text-emerald-400 text-sm text-center bg-emerald-50/50 dark:bg-emerald-900/10">Pro</th>
                                    <th className="py-4 px-4 font-bold text-slate-900 dark:text-white text-sm text-center">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                <tr>
                                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-300 font-medium">Active Pipelines</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">1</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">5</td>
                                    <td className="py-4 px-4 text-sm text-emerald-800 dark:text-emerald-300 font-bold text-center bg-emerald-50/50 dark:bg-emerald-900/10">15</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Unlimited</td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-300 font-medium">Sync Frequency</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Weekly</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Daily</td>
                                    <td className="py-4 px-4 text-sm text-emerald-800 dark:text-emerald-300 font-bold text-center bg-emerald-50/50 dark:bg-emerald-900/10">Hourly</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">15 Minutes</td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-300 font-medium">Transformations</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">—</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Basic</td>
                                    <td className="py-4 px-4 text-sm text-emerald-800 dark:text-emerald-300 font-bold text-center bg-emerald-50/50 dark:bg-emerald-900/10">Advanced (PII)</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Custom Scripts</td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-300 font-medium">Premium Connectors</td>
                                    <td className="py-4 px-4 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                    <td className="py-4 px-4 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                    <td className="py-4 px-4 text-sm text-emerald-600 text-center bg-emerald-50/50 dark:bg-emerald-900/10"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                    <td className="py-4 px-4 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-300 font-medium">Support Level</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Community</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Email (72h)</td>
                                    <td className="py-4 px-4 text-sm text-emerald-800 dark:text-emerald-300 font-bold text-center bg-emerald-50/50 dark:bg-emerald-900/10">Priority (24h)</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">Dedicated Slack</td>
                                </tr>
                                <tr>
                                    <td className="py-4 px-6 text-sm text-slate-600 dark:text-slate-300 font-medium">On-Premise / VPC</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">—</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center">—</td>
                                    <td className="py-4 px-4 text-sm text-slate-500 dark:text-slate-400 text-center bg-emerald-50/50 dark:bg-emerald-900/10">—</td>
                                    <td className="py-4 px-4 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Trust Seals */}
                <div className="mt-20 mb-16 text-center">
                    <p className="text-slate-400 dark:text-slate-500 text-sm mb-6 uppercase tracking-widest font-semibold">Security & Compliance</p>
                    <div className="flex justify-center gap-12 text-slate-300 dark:text-slate-600">
                        <div className="flex flex-col items-center gap-2 opacity-80">
                            <ShieldCheck className="w-8 h-8" />
                            <span className="text-[10px] font-bold">SOC2 COMPLIANT</span>
                        </div>
                        <div className="flex flex-col items-center gap-2 opacity-80">
                            <Shield className="w-8 h-8" />
                            <span className="text-[10px] font-bold">GDPR READY</span>
                        </div>
                        <div className="flex flex-col items-center gap-2 opacity-80">
                            <Zap className="w-8 h-8" />
                            <span className="text-[10px] font-bold">PCI-DSS SECURE</span>
                        </div>
                    </div>
                </div>

                {/* FAQ or Trust Section */}
                <div className="py-12 max-w-4xl mx-auto text-center border-t border-slate-200 dark:border-slate-800">
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Will my price ever increase?</h3>
                    <p className="text-lg text-slate-600 dark:text-slate-400 leading-relaxed mb-8">
                        No. We strongly believe the current standard of charging by the row is fundamentally broken and punishes companies for being successful. When you subscribe to a Monstera Cloud tier, you lock in that price regardless of how much data you move.
                    </p>
                </div>

            </div>
        </div>
    );
}
