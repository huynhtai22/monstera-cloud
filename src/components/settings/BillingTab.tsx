"use client";

import React, { useState } from "react";
import useSWR from "swr";
import {
  CreditCard,
  Sparkles,
  Check,
  ArrowRight,
  ExternalLink,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PLAN_PRICING,
  PLAN_VND_ANNUAL_TOTALS,
  type PlanName,
  formatPlanPrice,
  getPlanLimits,
} from "@/lib/plan-config";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { ManagePlanModal } from "@/components/settings/ManagePlanModal";

interface BillingTabProps {
  workspacePlan: string;
  workspaceStatus?: string;
  workspaceId?: string;
  subscriptionEndsAt?: string | Date | null;
  isOwner: boolean;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch");
  return data;
};

export function BillingTab({
  workspacePlan,
  workspaceStatus,
  workspaceId,
  subscriptionEndsAt,
  isOwner,
}: BillingTabProps) {
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [isAnnual, setIsAnnual] = useState(true);
  const [currency, setCurrency] = useState<"VND" | "USD">("VND");

  // VietQR Modal state
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{
    name: string;
    displayName: string;
    amount: number;
    billingCycle: "monthly" | "annual";
  }>({
    name: "professional",
    displayName: "Agency Pro",
    amount: 14_900_000,
    billingCycle: "annual",
  });

  const { data: billingData } = useSWR(
    workspaceId ? `/api/workspaces/${workspaceId}/billing` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const currentPlan = (billingData?.plan || workspacePlan || "free").toLowerCase();
  const currentLimits = getPlanLimits(currentPlan);
  const usage = billingData?.usage || { connectionsCount: 0, membersCount: 1, pipelinesCount: 0 };
  const orders = Array.isArray(billingData?.orders) ? billingData.orders : [];

  const paidThrough = subscriptionEndsAt
    ? new Date(subscriptionEndsAt)
    : billingData?.subscriptionEndsAt
    ? new Date(billingData.subscriptionEndsAt)
    : null;

  const paidThroughLabel =
    paidThrough && !Number.isNaN(paidThrough.getTime())
      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(paidThrough)
      : null;

  const isTrial = workspaceStatus === "PILOT" || billingData?.status === "PILOT";

  const getAmountVnd = (plan: PlanName, annual: boolean): number => {
    if (annual) {
      return PLAN_VND_ANNUAL_TOTALS[plan] ?? (PLAN_PRICING[plan]?.vndAnnualMonthly ?? 0) * 12;
    }
    return PLAN_PRICING[plan]?.vndMonthly ?? 0;
  };

  const handleOpenCheckout = (planId: PlanName, cycle: "monthly" | "annual", amount: number) => {
    const displayNames: Record<string, string> = {
      starter: "Studio",
      professional: "Agency Pro",
      enterprise: "Enterprise",
    };
    setSelectedPlan({
      name: planId,
      displayName: displayNames[planId] || planId,
      amount,
      billingCycle: cycle,
    });
    setManageModalOpen(false);
    setQrModalOpen(true);
  };

  const planTiers: Array<{
    id: PlanName;
    name: string;
    badge?: string;
    popular?: boolean;
    description: string;
    features: string[];
  }> = [
    {
      id: "starter",
      name: "Studio",
      description: "For boutique growth studios & emerging media buyers.",
      features: [
        "Up to 6 Connected Ad Accounts",
        "Up to 50 Team Seats",
        "90-Day Data Explorer History",
        "Looker Studio & API Keys",
        "Daily + On-Demand Syncs",
      ],
    },
    {
      id: "professional",
      name: "Agency Pro",
      badge: "Most Popular",
      popular: true,
      description: "The complete data platform for scaling performance marketing agencies.",
      features: [
        "Up to 15 Connected Ad Accounts",
        "Up to 50 Team Seats",
        "365-Day (1 Year) Warehouse History",
        "Raw CSV & REST Data Exports",
        "Looker Studio & High-Speed API",
        "10-Minute Refresh Cooldown",
        "Priority Ingestion Queue",
      ],
    },
    {
      id: "enterprise",
      name: "Enterprise",
      badge: "High Scale",
      description: "Custom infrastructure for large media agencies and holding groups.",
      features: [
        "100+ Connected Ad Accounts",
        "Unlimited Team Members",
        "2-Year (730 Days) Warehouse History",
        "Custom Data Connectors Development",
        "Dedicated Data Engineer",
        "Custom SLA & High Throughput",
      ],
    },
  ];

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <h3 className="flex items-center text-lg font-semibold text-ink">
          <CreditCard className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          Billing &amp; Plans
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Manage your agency plan, resource quotas, and domestic PayOS invoices.
        </p>
      </div>

      {/* Current Plan Bento Card */}
      <div className="rounded-xl border border-line bg-canvas p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-line">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">
                Current Workspace Plan
              </span>
              {isTrial && (
                <span className="rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                  7-Day Trial
                </span>
              )}
              {!isTrial && currentPlan === "professional" && (
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  Active Pro
                </span>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <h4 className="text-2xl font-bold capitalize text-ink">
                {isTrial ? "Agency Pro (Trial)" : currentLimits.displayName || workspacePlan}
              </h4>
            </div>

            {paidThroughLabel ? (
              <p className="mt-2 text-xs text-ink-mute">
                {isTrial ? (
                  <>
                    Your 7-day trial ends on{" "}
                    <span className="font-medium text-ink">{paidThroughLabel}</span>. Upgrade before then to preserve your Agency Pro limits.
                  </>
                ) : (
                  <>
                    Paid access active through{" "}
                    <span className="font-medium text-ink">{paidThroughLabel}</span>. Renew anytime to extend your terms.
                  </>
                )}
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-mute">
                Your workspace is currently on its assigned tier. Domestic-transfer terms appear here upon PayOS confirmation.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isOwner && workspaceId ? (
              <button
                type="button"
                onClick={() => setManageModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all shadow-sm"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Manage Plan</span>
              </button>
            ) : (
              <span className="text-xs text-ink-mute">Only workspace owners can modify plans</span>
            )}
          </div>
        </div>

        {/* Resource Usage & Limits Grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-line/60 bg-panel/60 p-3.5">
            <span className="text-[11px] font-medium text-ink-mute">Connected Sources</span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-lg font-bold text-ink">{usage.connectionsCount}</span>
              <span className="text-xs text-ink-mute">/ {currentLimits.maxConnections}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-emerald-400"
                style={{
                  width: `${Math.min(100, Math.round((usage.connectionsCount / (currentLimits.maxConnections || 1)) * 100))}%`,
                }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-line/60 bg-panel/60 p-3.5">
            <span className="text-[11px] font-medium text-ink-mute">Team Seats</span>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-lg font-bold text-ink">{usage.membersCount}</span>
              <span className="text-xs text-ink-mute">/ {currentLimits.maxSeats}</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-emerald-400"
                style={{
                  width: `${Math.min(100, Math.round((usage.membersCount / (currentLimits.maxSeats || 1)) * 100))}%`,
                }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-line/60 bg-panel/60 p-3.5">
            <span className="text-[11px] font-medium text-ink-mute">History Retention</span>
            <div className="mt-1 text-lg font-bold text-ink">
              {currentLimits.maxHistoryDays ? `${currentLimits.maxHistoryDays}d` : "365d"}
            </div>
            <span className="text-[10px] text-ink-mute">Warehouse Lookback</span>
          </div>

          <div className="rounded-lg border border-line/60 bg-panel/60 p-3.5">
            <span className="text-[11px] font-medium text-ink-mute">Refresh Rate</span>
            <div className="mt-1 text-lg font-bold text-ink">
              {currentLimits.syncLabel}
            </div>
            <span className="text-[10px] text-ink-mute">{currentLimits.scheduledRefresh === "hourly" ? "10m cooldown" : "Daily sync"}</span>
          </div>
        </div>
      </div>

      {/* Interactive Plan Selector Section (like Cursor / Codex) */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-ink">Choose a Different Plan</h4>
            <p className="text-xs text-ink-mute">
              Select an agency tier to upgrade capacity or lock in annual domestic savings.
            </p>
          </div>

          {/* Monthly / Annual & Currency Controls */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
              <button
                type="button"
                onClick={() => setIsAnnual(false)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  !isAnnual ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
                )}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setIsAnnual(true)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  isAnnual ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
                )}
              >
                <span>Annual</span>
                <span className="rounded bg-emerald-500/20 px-1 text-[10px] font-semibold text-emerald-300">
                  -20%
                </span>
              </button>
            </div>

            <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
              <button
                type="button"
                onClick={() => setCurrency("VND")}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-all",
                  currency === "VND" ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
                )}
              >
                VND
              </button>
              <button
                type="button"
                onClick={() => setCurrency("USD")}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-all",
                  currency === "USD" ? "bg-white/[0.08] text-ink font-semibold" : "text-ink-mute hover:text-ink"
                )}
              >
                USD
              </button>
            </div>
          </div>
        </div>

        {/* Plan Cards Grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {planTiers.map((plan) => {
            const priceInfo = formatPlanPrice(plan.id, currency, isAnnual);
            const isCurrent =
              currentPlan === plan.id ||
              (plan.id === "professional" && (currentPlan === "pro" || currentPlan === "agency"));
            const amountVnd = getAmountVnd(plan.id, isAnnual);

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col justify-between rounded-xl border p-5 transition-all duration-200",
                  plan.popular
                    ? "border-emerald-500/50 bg-canvas/80 shadow-md shadow-emerald-950/20 ring-1 ring-emerald-500/30"
                    : "border-line bg-canvas hover:border-line/80"
                )}
              >
                {plan.badge && (
                  <div className="absolute -top-2.5 right-4">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        plan.popular
                          ? "bg-emerald-500 text-slate-950 shadow-sm"
                          : "bg-white/10 text-ink border border-line"
                      )}
                    >
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-ink text-sm sm:text-base">{plan.name}</h5>
                    {isCurrent && (
                      <span className="rounded bg-white/[0.06] border border-line px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-mute min-h-[30px]">{plan.description}</p>

                  <div className="mt-3 pb-3 border-b border-line">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold tracking-tight text-ink">
                        {priceInfo.formatted}
                      </span>
                      <span className="text-[11px] text-ink-mute">
                        {currency === "VND" ? "/tháng" : "/mo"}
                      </span>
                    </div>
                    {isAnnual && (
                      <p className="mt-0.5 text-[10px] text-ink-mute">
                        {currency === "VND"
                          ? `Billed annually (${amountVnd.toLocaleString("vi-VN")} đ)`
                          : `Billed annually`}
                      </p>
                    )}
                  </div>

                  <ul className="mt-3.5 space-y-2 text-xs text-ink">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400 mt-0.5" />
                        <span className="text-[11px] leading-snug">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-5 pt-3 border-t border-line/60">
                  {isCurrent ? (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-md border border-line bg-white/[0.03] py-2 text-xs font-semibold text-ink-mute opacity-80 cursor-default"
                    >
                      Current Plan
                    </button>
                  ) : isOwner ? (
                    <button
                      type="button"
                      onClick={() => handleOpenCheckout(plan.id, isAnnual ? "annual" : "monthly", amountVnd)}
                      className={cn(
                        "flex w-full items-center justify-center gap-1 rounded-md py-2 text-xs font-semibold transition-all active:scale-[0.98]",
                        plan.popular
                          ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-sm"
                          : "border border-line bg-white/[0.05] text-ink hover:bg-white/[0.09]"
                      )}
                    >
                      <span>Choose {plan.name}</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="w-full rounded-md border border-line bg-white/[0.02] py-2 text-xs text-ink-mute opacity-50 cursor-not-allowed"
                    >
                      Owner required
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* PayOS & VietQR Order History Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-ink-mute" />
            <h4 className="text-sm font-semibold text-ink">Domestic Invoices &amp; Payment History</h4>
          </div>
          <span className="text-[11px] text-ink-mute">Powered by PayOS &amp; VietQR</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-canvas">
          {orders.length === 0 ? (
            <div className="p-6 text-center text-xs text-ink-mute">
              No domestic payment orders recorded yet. Upgrade anytime using VietQR to generate an instant transaction receipt.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-panel/50 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
                    <th className="py-2.5 px-4">Order Code</th>
                    <th className="py-2.5 px-4">Plan &amp; Cycle</th>
                    <th className="py-2.5 px-4">Amount</th>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {orders.map((order: any) => {
                    const date = order.createdAt ? new Date(order.createdAt) : null;
                    const dateLabel = date
                      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date)
                      : "—";

                    const isPaid = order.status === "PAID";
                    const isPending = order.status === "PENDING" || order.status === "CREATING";

                    return (
                      <tr key={order.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4 font-mono text-ink">#{order.orderCode}</td>
                        <td className="py-3 px-4 capitalize text-ink">
                          {order.plan} ({order.billingCycle || "annual"})
                        </td>
                        <td className="py-3 px-4 font-medium text-ink">
                          {Number(order.amount).toLocaleString("vi-VN")} {order.currency || "VND"}
                        </td>
                        <td className="py-3 px-4 text-ink-mute">{dateLabel}</td>
                        <td className="py-3 px-4">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                              isPaid
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : isPending
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-white/[0.04] text-ink-mute border border-line"
                            )}
                          >
                            {order.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isPending && isOwner ? (
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenCheckout(
                                  order.plan as PlanName,
                                  order.billingCycle as "monthly" | "annual",
                                  order.amount
                                )
                              }
                              className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] font-medium text-ink hover:bg-white/[0.06] transition-colors"
                            >
                              <span>Pay Now</span>
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          ) : (
                            <span className="text-[11px] text-ink-mute">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Plan Comparison Modal */}
      <ManagePlanModal
        isOpen={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        currentPlan={currentPlan}
        workspaceId={workspaceId || ""}
        isOwner={isOwner}
        onSelectPlan={(plan, cycle, amount) => handleOpenCheckout(plan, cycle, amount)}
      />

      {/* VietQR / PayOS Modal */}
      <VietQrModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        planName={selectedPlan.name}
        planDisplayName={selectedPlan.displayName}
        billingCycle={selectedPlan.billingCycle}
        amountVnd={selectedPlan.amount}
        workspaceId={workspaceId}
      />
    </div>
  );
}
