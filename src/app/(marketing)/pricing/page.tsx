import Link from "next/link";
import { CheckCircle2, X, Check, ShieldCheck, Shield, Zap } from "lucide-react";
import { CheckoutButton } from "@/components/CheckoutButton";

export default function PricingPage() {
    return (
        <div className="min-h-screen pt-32 pb-24 bg-white dark:bg-slate-950 font-sans">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

                <div className="text-center space-y-4 mb-12">
                    <div className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium text-emerald-800 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/30 ring-1 ring-inset ring-emerald-600/20 mb-6 font-semibold">
                        Simple, Flat Pricing
                    </div>
                    <h1 className="text-slate-900 dark:text-white text-4xl md:text-6xl font-extrabold leading-tight tracking-tight">Stop paying per row.</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-lg md:text-xl font-normal max-w-2xl mx-auto">
                        Legacy ELT tools punish you for growth. Monstera Cloud gives you <span className="font-semibold text-slate-900 dark:text-white">unlimited syncs</span> for one transparent monthly fee.
                    </p>
                </div>

                {/* Billing Toggle */}
                <div className="flex p-1 mb-16 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-[280px] mx-auto">
                    <label className="flex cursor-pointer h-10 grow items-center justify-center overflow-hidden rounded-md px-2 transition-all has-[:checked]:bg-white dark:has-[:checked]:bg-slate-800 has-[:checked]:shadow-sm has-[:checked]:text-emerald-700 dark:has-[:checked]:text-emerald-400 text-slate-500 text-sm font-semibold">
                        <span>Monthly</span>
                        <input className="hidden" name="billing-cycle" type="radio" value="monthly" />
                    </label>
                    <label className="flex cursor-pointer h-10 grow items-center justify-center overflow-hidden rounded-md px-2 transition-all has-[:checked]:bg-white dark:has-[:checked]:bg-slate-800 has-[:checked]:shadow-sm has-[:checked]:text-emerald-700 dark:has-[:checked]:text-emerald-400 text-slate-500 text-sm font-semibold">
                        <span className="flex items-center gap-1.5">Annual <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400 font-bold">SAVE 20%</span></span>
                        <input defaultChecked className="hidden" name="billing-cycle" type="radio" value="annual" />
                    </label>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {/* Starter Plan */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-xl font-bold">Starter</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">Ideal for developers</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">$49</span>
                                <span className="text-slate-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                2 Active Pipelines
                            </li>
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Unlimited Rows Synced
                            </li>
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Basic Transformations
                            </li>
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Daily Sync Frequency
                            </li>
                            <li className="flex items-center gap-3 text-slate-400 dark:text-slate-600 text-sm line-through">
                                <X className="text-slate-300 dark:text-slate-700 w-5 h-5 shrink-0" />
                                Premium APAC Connectors
                            </li>
                        </ul>
                        <CheckoutButton plan="starter" className="w-full py-3 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                            Subscribe to Starter
                        </CheckoutButton>
                    </div>

                    {/* Pro Plan (Most Popular) */}
                    <div className="border-2 border-emerald-500 dark:border-emerald-600 bg-white dark:bg-slate-900 shadow-xl rounded-xl p-6 relative overflow-hidden flex flex-col h-full md:-translate-y-4">
                        <div className="absolute top-0 right-0 bg-emerald-500 dark:bg-emerald-600 text-white text-[10px] font-bold px-4 py-1.5 rounded-bl-lg uppercase tracking-widest z-10">
                            Recommended
                        </div>
                        <div className="flex justify-between items-start mb-6 z-10 relative">
                            <div>
                                <h3 className="text-slate-900 dark:text-white text-xl font-bold">Pro</h3>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">For growing brands</p>
                            </div>
                            <div className="text-right">
                                <span className="text-3xl font-bold text-slate-900 dark:text-white">$149</span>
                                <span className="text-slate-500 text-sm block">/month</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1 z-10 relative">
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                10 Active Pipelines
                            </li>
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                Premium APAC E-Commerce Connectors
                            </li>
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                Advanced Transformations (PII, Currency)
                            </li>
                            <li className="flex items-start gap-3 text-slate-700 dark:text-slate-200 text-sm font-medium">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0 stroke-[3]" />
                                Hourly Sync Frequency
                            </li>
                        </ul>
                        <div className="z-10 relative">
                            <CheckoutButton plan="professional" className="w-full py-3 rounded-lg bg-emerald-600 text-white font-bold shadow-md shadow-emerald-600/20 hover:bg-emerald-700 transition-all">
                                Subscribe to Professional
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
                                <span className="text-2xl font-bold text-slate-900 dark:text-white">Custom</span>
                            </div>
                        </div>
                        <ul className="space-y-4 mb-8 flex-1">
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Unlimited Pipelines
                            </li>
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                On-Premise / VPC Deployment
                            </li>
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                Custom API Connectors
                            </li>
                            <li className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm">
                                <Check className="text-emerald-600 w-5 h-5 shrink-0" />
                                15-Minute Sync Frequency
                            </li>
                        </ul>
                        <Link href="/solutions" className="block text-center w-full py-3 rounded-lg bg-slate-900 dark:bg-slate-800 text-white font-bold hover:bg-slate-800 transition-colors">
                            Talk to Sales
                        </Link>
                    </div>
                </div>

                {/* Feature Comparison Table */}
                <div className="mt-24 overflow-hidden max-w-5xl mx-auto">
                    <h3 className="text-slate-900 dark:text-white text-2xl font-bold mb-8 text-center">Compare Features</h3>
                    <div className="overflow-x-auto -mx-4 px-4">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800">
                                    <th className="py-4 font-semibold text-slate-400 dark:text-slate-500 text-sm uppercase tracking-wider">Features</th>
                                    <th className="py-4 px-2 font-bold text-slate-900 dark:text-white text-sm text-center">Starter</th>
                                    <th className="py-4 px-2 font-bold text-sm text-center text-slate-900 dark:text-white">Pro</th>
                                    <th className="py-4 px-2 font-bold text-slate-900 dark:text-white text-sm text-center">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                                <tr>
                                    <td className="py-4 text-sm text-slate-600 dark:text-slate-300">Active Pipelines</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">2</td>
                                    <td className="py-4 px-2 text-sm text-slate-900 dark:text-white font-medium text-center">10</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">Unlimited</td>
                                </tr>
                                <tr>
                                    <td className="py-4 text-sm text-slate-600 dark:text-slate-300">Sync Frequency</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">Daily</td>
                                    <td className="py-4 px-2 text-sm text-slate-900 dark:text-white font-medium text-center">Hourly</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">15 Minutes</td>
                                </tr>
                                <tr>
                                    <td className="py-4 text-sm text-slate-600 dark:text-slate-300">Premium Connectors</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">—</td>
                                    <td className="py-4 px-2 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5" /></td>
                                    <td className="py-4 px-2 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5" /></td>
                                </tr>
                                <tr>
                                    <td className="py-4 text-sm text-slate-600 dark:text-slate-300">Support Level</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">Community</td>
                                    <td className="py-4 px-2 text-sm text-slate-900 dark:text-white font-medium text-center">Priority email</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">Dedicated slack</td>
                                </tr>
                                <tr>
                                    <td className="py-4 text-sm text-slate-600 dark:text-slate-300">On-Premise / VPC</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">—</td>
                                    <td className="py-4 px-2 text-sm text-slate-500 dark:text-slate-400 text-center">—</td>
                                    <td className="py-4 px-2 text-sm text-emerald-600 text-center"><CheckCircle2 className="inline w-5 h-5" /></td>
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
