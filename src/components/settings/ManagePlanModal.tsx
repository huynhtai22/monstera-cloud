"use client";

import React, { useState } from "react";
import { Check, Sparkles, Shield, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PLAN_PRICING,
  PLAN_VND_ANNUAL_TOTALS,
  type PlanName,
  formatPlanPrice,
} from "@/lib/plan-config";

interface ManagePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan: string;
  workspaceId?: string;
  isOwner: boolean;
  onSelectPlan: (plan: PlanName, billingCycle: "monthly" | "annual", amountVnd: number) => void;
}

export function ManagePlanModal({
  isOpen,
  onClose,
  currentPlan,
  isOwner,
  onSelectPlan,
}: ManagePlanModalProps) {
  const [isAnnual, setIsAnnual] = useState(true);
  const [currency, setCurrency] = useState<"VND" | "USD">("VND");

  if (!isOpen) return null;

  const normalizedCurrent = currentPlan.toLowerCase();

  const getAmountVnd = (plan: PlanName): number => {
    if (isAnnual) {
      return PLAN_VND_ANNUAL_TOTALS[plan] ?? (PLAN_PRICING[plan]?.vndAnnualMonthly ?? 0) * 12;
    }
    return PLAN_PRICING[plan]?.vndMonthly ?? 0;
  };

  const plans: Array<{
    id: PlanName;
    name: string;
    badge?: string;
    description: string;
    popular?: boolean;
    features: string[];
    highlightFeature?: string;
  }> = [
    {
      id: "starter",
      name: "Studio",
      description: "For boutique growth studios & emerging media buyers.",
      features: [
        "Up to 6 Connected Ad Accounts",
        "Up to 50 Team Seats",
        "90-Day Data Explorer Lookback",
        "Looker Studio & API Keys",
        "Daily + On-Demand Syncs",
        "Meta, Google, TikTok & Shopee",
      ],
    },
    {
      id: "professional",
      name: "Agency Pro",
      badge: "Most Popular",
      popular: true,
      description: "The complete operating system for scaling performance agencies.",
      highlightFeature: "10-Minute Sync Cooldown + Hourly Warehouse Refresh",
      features: [
        "Up to 15 Connected Ad Accounts",
        "Up to 50 Team Seats",
        "365-Day (1 Year) Warehouse History",
        "Raw CSV & REST Data Exports",
        "Looker Studio & High-Speed API",
        "10-Minute Refresh Cooldown",
        "Priority Ingestion Queue & Fencing",
      ],
    },
    {
      id: "enterprise",
      name: "Enterprise",
      badge: "High Scale",
      description: "Custom capacity & infrastructure for large media holding groups.",
      features: [
        "100+ Connected Ad Accounts",
        "Unlimited Team Members",
        "2-Year (730 Days) Warehouse History",
        "Custom Data Connectors Development",
        "Dedicated Data Engineer & Slack Channel",
        "Custom SLA & High-Throughput Pipelines",
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-sm sm:py-10">
      <div className="relative w-full max-w-5xl rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-black/60 sm:p-8">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 rounded-lg p-2 text-ink-mute hover:bg-white/[0.06] hover:text-ink transition-colors"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Manage Agency Plan</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Choose the right plan for your agency
          </h2>
          <p className="mt-2 text-sm text-ink-mute">
            Scale your multi-platform ad warehouse, team members, and high-frequency syncs. Upgrade or switch tiers at any time.
          </p>

          {/* Controls: Billing Interval & Currency Switchers */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {/* Monthly / Annual Toggle */}
            <div className="inline-flex rounded-lg border border-line bg-canvas p-1">
              <button
                type="button"
                onClick={() => setIsAnnual(false)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  !isAnnual ? "bg-white/[0.08] text-ink font-semibold shadow-sm" : "text-ink-mute hover:text-ink"
                )}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setIsAnnual(true)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                  isAnnual ? "bg-white/[0.08] text-ink font-semibold shadow-sm" : "text-ink-mute hover:text-ink"
                )}
              >
                <span>Annual</span>
                <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  Save 20%
                </span>
              </button>
            </div>

            {/* Currency Toggle */}
            <div className="inline-flex rounded-lg border border-line bg-canvas p-1">
              <button
                type="button"
                onClick={() => setCurrency("VND")}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                  currency === "VND" ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
                )}
              >
                VND (VietQR)
              </button>
              <button
                type="button"
                onClick={() => setCurrency("USD")}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                  currency === "USD" ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
                )}
              >
                USD ($)
              </button>
            </div>
          </div>
        </div>

        {/* Plan Cards Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const priceInfo = formatPlanPrice(plan.id, currency, isAnnual);
            const isCurrent =
              normalizedCurrent === plan.id ||
              (plan.id === "professional" && (normalizedCurrent === "pro" || normalizedCurrent === "agency"));
            const amountVnd = getAmountVnd(plan.id);

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col justify-between rounded-xl border p-6 transition-all duration-200",
                  plan.popular
                    ? "border-emerald-500/50 bg-canvas/80 shadow-lg shadow-emerald-950/20 ring-1 ring-emerald-500/30"
                    : "border-line bg-canvas hover:border-line/80"
                )}
              >
                {/* Popular Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span
                      className={cn(
                        "rounded-full px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
                        plan.popular
                          ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                          : "bg-white/10 text-ink border border-line"
                      )}
                    >
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
                    {isCurrent && (
                      <span className="rounded-md border border-line bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                        Current Plan
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-mute min-h-[32px]">{plan.description}</p>

                  {/* Pricing Display */}
                  <div className="mt-4 pb-4 border-b border-line">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
                        {priceInfo.formatted}
                      </span>
                      <span className="text-xs text-ink-mute">
                        {currency === "VND"
                          ? isAnnual ? "/tháng" : "/tháng"
                          : isAnnual ? "/mo" : "/mo"}
                      </span>
                    </div>
                    {isAnnual && (
                      <p className="mt-1 text-[11px] text-ink-mute">
                        {currency === "VND"
                          ? `Billed annually (${amountVnd.toLocaleString("vi-VN")} đ/năm)`
                          : `Billed annually`}
                      </p>
                    )}
                  </div>

                  {/* Features List */}
                  <ul className="mt-5 space-y-2.5 text-xs text-ink">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                        <span className="leading-snug">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Card Action Button */}
                <div className="mt-6 pt-4 border-t border-line/60">
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-lg border border-line bg-white/[0.03] py-2.5 text-xs font-semibold text-ink-mute opacity-80 cursor-default"
                    >
                      Current Plan
                    </button>
                  ) : isOwner ? (
                    <button
                      type="button"
                      onClick={() => onSelectPlan(plan.id, isAnnual ? "annual" : "monthly", amountVnd)}
                      className={cn(
                        "flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all active:scale-[0.98]",
                        plan.popular
                          ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/25"
                          : "border border-line bg-white/[0.06] text-ink hover:bg-white/[0.1] hover:border-line/80"
                      )}
                    >
                      <span>Choose {plan.name}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-lg border border-line bg-white/[0.02] py-2.5 text-xs text-ink-mute opacity-60 cursor-not-allowed"
                    >
                      Owner required
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-4 py-3 text-xs text-ink-mute">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>Instant domestic activation via VietQR / PayOS. Zero card transaction fees.</span>
          </div>
          <span className="text-[11px] text-ink-mute">Need a custom contract? Contact <a href="mailto:support@monsteracloud.com" className="text-ink underline hover:text-emerald-400">support@monsteracloud.com</a></span>
        </div>
      </div>
    </div>
  );
}
