import React from 'react';
import { CreditCard, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function BillingTab({ userPlan }: { userPlan: string }) {
    return (
        <div className="space-y-6 max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                    <CreditCard className="w-5 h-5 mr-2 text-cyan-600 dark:text-cyan-400" />
                    Billing & Plan
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Manage your subscription and payment methods.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex items-center justify-between">
                <div>
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white flex items-center">
                        Current Plan
                        <span className={cn(
                            "ml-3 px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize",
                            userPlan === 'free' ? "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300" :
                                userPlan === 'starter' ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400" :
                                    "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                        )}>
                            {userPlan}
                        </span>
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                        {userPlan === 'free' ? 'Basic reporting, 1 connection.' :
                            userPlan === 'starter' ? 'Unlimited syncs, 5 connections.' :
                                'Unlimited everything.'}
                    </p>
                </div>
                <Link
                    href="/pricing"
                    className="px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl text-sm font-medium transition-all shadow-sm"
                >
                    Change Plan
                </Link>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">Features Included</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {['Automated Daily Syncs', 'Looker Studio Integration', 'Google Sheets Add-on', 'Priority Support'].map(f => (
                        <div key={f} className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                            <CheckCircle2 className="w-4 h-4 mr-2 text-cyan-500" />
                            {f}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
