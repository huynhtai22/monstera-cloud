"use client";

import Link from "next/link";
import { CheckCircle2, Check, ShieldCheck, Shield, Zap } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";
import { useState } from "react";

export default function PricingPage() {
    const [isAnnual, setIsAnnual] = useState(true);

    return (
        <div className="min-h-screen pt-32 pb-24 bg-[#09090b] font-sans overflow-hidden">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">

                <div className="text-center space-y-4 mb-16">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 tracking-widest uppercase mb-6 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                        Flash-Sale Proof Pricing
                    </div>
                    <h1 className="text-white text-4xl md:text-6xl font-extrabold leading-[1.05] tracking-tighter">
                        Stop paying per row.
                    </h1>
                    <p className="text-gray-400 text-lg md:text-xl font-normal max-w-2xl mx-auto mt-4">
                        Legacy ELT punishes you for scale. Monstera Cloud charges a flat architectural fee based on GMV order volume. <span className="font-semibold text-white">Zero overage penalties during 11.11 spikes.</span>
                    </p>
                </div>

                {/* Billing Toggle (Terminal Style) */}
                <div className="flex p-1 mb-16 bg-[#18181b] border border-white/10 rounded-lg max-w-[280px] mx-auto relative z-10 font-medium text-sm">
                    <button 
                        onClick={() => setIsAnnual(false)}
                        className={`flex h-10 grow items-center justify-center rounded-md px-2 transition-all ${!isAnnual ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        Monthly
                    </button>
                    <button 
                        onClick={() => setIsAnnual(true)}
                        className={`flex h-10 grow items-center justify-center rounded-md px-2 transition-all ${isAnnual ? 'bg-white/10 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <span className="flex items-center gap-1.5">Annual <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 font-bold border border-emerald-500/10">SAVE 20%</span></span>
                    </button>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
                    
                    {/* Free Plan */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 hover:border-white/20 transition-all flex flex-col h-full group">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-white text-xl font-bold tracking-tight">Free</h3>
                                <p className="text-gray-400 text-sm">Evaluation sandbox</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-white">$0</span>
                                <span className="text-gray-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0" />
                                1 Active Pipeline
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0" />
                                Core APAC Connectors
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0" />
                                Weekly Sync Batch
                            </li>
                        </ul>
                        <Link href="/register" className="text-center w-full py-3 rounded-lg border border-white/10 text-white font-semibold hover:bg-white/5 transition-colors">
                            Initialize Node
                        </Link>
                    </div>

                    {/* Starter Plan */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 hover:border-white/20 transition-all flex flex-col h-full group">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-white text-xl font-bold tracking-tight">Starter</h3>
                                <p className="text-gray-400 text-sm">Solo Operators</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-white">
                                    ${isAnnual ? '39' : '49'}
                                </span>
                                <span className="text-gray-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0" />
                                5 Active Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0" />
                                Daily Sync Batch
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0" />
                                Basic Transformations
                            </li>
                        </ul>
                        <CheckoutButton plan="starter" className="w-full py-3 rounded-lg border border-white/10 text-white font-semibold hover:bg-white/5 transition-colors">
                            Upgrade Node
                        </CheckoutButton>
                    </div>

                    {/* Pro Plan (Most Popular) */}
                    <div className="bg-[#18181b] border-2 border-emerald-600 rounded-xl p-6 relative flex flex-col h-full md:-translate-y-4 shadow-lg shadow-emerald-500/5">
                        <div className="absolute top-0 inset-x-0 bg-emerald-600 text-white text-[10px] font-bold px-4 py-1.5 text-center uppercase tracking-widest z-10">
                            Professional Standard
                        </div>
                        <div className="flex justify-between items-start mt-6 mb-6 z-10 relative">
                            <div>
                                <h3 className="text-white text-xl font-bold tracking-tight">Pro</h3>
                                <p className="text-emerald-500 text-sm">Scaling architectures</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-white">
                                    ${isAnnual ? '119' : '149'}
                                </span>
                                <span className="text-gray-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1 z-10 relative">
                            <li className="flex items-start gap-3 text-white text-sm font-semibold">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0 stroke-[3]" />
                                Up to 250,000 Orders/Mo
                            </li>
                            <li className="flex items-start gap-3 text-white text-sm font-semibold">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0 stroke-[3]" />
                                11.11 Flash-Sale Protection
                            </li>
                            <li className="flex items-start gap-3 text-white text-sm font-semibold">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0 stroke-[3]" />
                                15 Active Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-white text-sm font-semibold">
                                <Check className="text-emerald-500 w-5 h-5 shrink-0 stroke-[3]" />
                                PII Masking & Cryptography
                            </li>
                        </ul>
                        <div className="z-10 relative">
                            <CheckoutButton plan="professional" className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition-all">
                                Deploy Pro Server
                            </CheckoutButton>
                        </div>
                    </div>

                    {/* Enterprise Plan */}
                    <div className="bg-[#18181b] border border-white/10 rounded-xl p-6 flex flex-col h-full hover:border-white/20 transition-all">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-white text-xl font-bold tracking-tight">Enterprise</h3>
                                <p className="text-gray-400 text-sm">Custom VPCs</p>
                            </div>
                            <div className="text-right">
                                <span className="text-2xl font-bold text-white block mt-1">from $499</span>
                                <span className="text-gray-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-gray-500 w-5 h-5 shrink-0" />
                                Infinite Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-gray-500 w-5 h-5 shrink-0" />
                                Real-time Sync Latency
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-gray-500 w-5 h-5 shrink-0" />
                                Dedicated Tenant Hosting
                            </li>
                            <li className="flex items-start gap-3 text-gray-300 text-sm font-medium">
                                <Check className="text-gray-500 w-5 h-5 shrink-0" />
                                Direct Slack Comm-Link
                            </li>
                        </ul>
                        <Link href="/solutions" className="block text-center w-full py-3 rounded-lg border border-white/10 text-white font-semibold hover:bg-white/5 transition-colors">
                            Contact Engineering
                        </Link>
                    </div>
                </div>

                {/* Feature Comparison Table */}
                <div className="mt-24 overflow-hidden max-w-6xl mx-auto border border-white/10 rounded-xl bg-[#18181b]">
                    <h3 className="text-white text-xl font-bold mb-0 p-6 border-b border-white/5 tracking-tight uppercase">Technical Specifications</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead className="bg-[#09090b]">
                                <tr>
                                    <th className="py-4 px-6 font-semibold text-gray-500 text-xs uppercase tracking-widest border-r border-white/5">Architecture Specs</th>
                                    <th className="py-4 px-4 font-bold text-white text-sm text-center border-r border-white/5">Free</th>
                                    <th className="py-4 px-4 font-bold text-white text-sm text-center border-r border-white/5">Starter</th>
                                    <th className="py-4 px-4 font-bold text-emerald-500 text-sm text-center bg-emerald-900/10 border-r border-white/5">Pro</th>
                                    <th className="py-4 px-4 font-bold text-white text-sm text-center">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-sm">
                                <tr className="hover:bg-white/5 transition-colors">
                                    <td className="py-4 px-6 text-gray-300 font-medium border-r border-white/5">Active Pipelines</td>
                                    <td className="py-4 px-4 text-gray-400 text-center border-r border-white/5">1</td>
                                    <td className="py-4 px-4 text-gray-400 text-center border-r border-white/5">5</td>
                                    <td className="py-4 px-4 text-emerald-500 font-bold text-center bg-emerald-900/10 border-r border-white/5">15</td>
                                    <td className="py-4 px-4 text-gray-400 text-center">Unlimited</td>
                                </tr>
                                <tr className="hover:bg-white/5 transition-colors">
                                    <td className="py-4 px-6 text-gray-300 font-medium border-r border-white/5">Sync Batch Window</td>
                                    <td className="py-4 px-4 text-gray-400 text-center border-r border-white/5">Weekly</td>
                                    <td className="py-4 px-4 text-gray-400 text-center border-r border-white/5">Daily</td>
                                    <td className="py-4 px-4 text-emerald-500 font-bold text-center bg-emerald-900/10 border-r border-white/5">Hourly</td>
                                    <td className="py-4 px-4 text-gray-400 text-center">Real-time</td>
                                </tr>
                                <tr className="hover:bg-white/5 transition-colors">
                                    <td className="py-4 px-6 text-gray-300 font-medium border-r border-white/5">Data Encryption</td>
                                    <td className="py-4 px-4 text-emerald-500 text-center border-r border-white/5"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                    <td className="py-4 px-4 text-emerald-500 text-center border-r border-white/5"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                    <td className="py-4 px-4 text-emerald-500 text-center bg-emerald-900/10 border-r border-white/5"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                    <td className="py-4 px-4 text-emerald-500 text-center"><CheckCircle2 className="inline w-5 h-5 mx-auto" /></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Trust Seals */}
                <div className="mt-20 mb-16 text-center border-t border-white/10 pt-16">
                    <p className="text-gray-500 text-xs mb-8 uppercase tracking-widest font-bold">Audited & Certified Infrastructure</p>
                    <div className="flex justify-center gap-16 text-gray-400">
                        <div className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
                            <ShieldCheck className="w-8 h-8 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">Vietnam PDPA Compliant</span>
                        </div>
                        <div className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
                            <Shield className="w-8 h-8 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">PII Masking Ready</span>
                        </div>
                        <div className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
                            <Zap className="w-8 h-8 text-white" />
                            <span className="text-[10px] font-mono tracking-widest uppercase">SOC2 Type II</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
