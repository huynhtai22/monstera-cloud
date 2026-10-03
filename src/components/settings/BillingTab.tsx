"use client";

import { useState } from "react";
import useSWR from "swr";
import { ArrowUpRight, Receipt } from "lucide-react";
import { getPlanLimits } from "@/lib/plan-config";
import { agencyProAmount, planName, type BillingCycle } from "@/lib/public-plan-catalog";
import { VietQrModal } from "@/components/pricing/VietQrModal";
import { ManagePlanModal } from "@/components/settings/ManagePlanModal";

interface BillingTabProps {
  workspacePlan: string;
  workspaceStatus?: string;
  workspaceId?: string;
  subscriptionEndsAt?: string | Date | null;
  isOwner: boolean;
}

interface BillingData {
  plan: string;
  status: string;
  subscriptionEndsAt: string | null;
  subscriptionProvider: string | null;
  usage: { connectionsCount: number; membersCount: number; pipelinesCount: number };
  orders: { id: string; orderCode: number; plan: string; amount: number; currency: string; status: string; createdAt: string }[];
}

const fetcher = async (url: string): Promise<BillingData> => {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Unable to load billing");
  return data;
};

function dateLabel(value?: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function BillingTab(props: BillingTabProps) {
  return <WorkspaceBilling key={props.workspaceId ?? "no-workspace"} {...props} />;
}

function WorkspaceBilling({ workspacePlan, workspaceStatus, workspaceId, subscriptionEndsAt, isOwner }: BillingTabProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const [checkoutCycle, setCheckoutCycle] = useState<BillingCycle | null>(null);
  const { data, error, isLoading, mutate } = useSWR<BillingData>(workspaceId ? `/api/workspaces/${workspaceId}/billing` : null, fetcher);
  const currentPlan = (data?.plan ?? workspacePlan ?? "free").toLowerCase();
  const status = data?.status ?? workspaceStatus ?? "ACTIVE";
  const deadline = dateLabel(data ? data.subscriptionEndsAt : subscriptionEndsAt);
  const trial = status === "PILOT";
  const limits = getPlanLimits(currentPlan);
  const expiresToFree = !!deadline && (trial || data?.subscriptionProvider === "vietqr_domestic");
  const usage = data ? [
    { label: "Source connections", used: data.usage.connectionsCount, max: limits.maxConnections },
    { label: "Workspace members", used: data.usage.membersCount, max: limits.maxSeats },
  ] : [];

  return <div className="mx-auto max-w-4xl space-y-7 pb-8">
    <header><h2 className="text-xl font-semibold tracking-tight text-ink">Plan & billing</h2><p className="mt-1.5 text-sm text-ink-mute">Your workspace, usage and payment history in one place.</p></header>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 p-4 text-sm text-ink"><span>We couldn’t refresh billing. Plan changes are paused until it loads.</span><button type="button" onClick={() => void mutate()} className="underline underline-offset-4">Try again</button></div> : null}
    <section aria-label="Current plan" className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6">
        <div><div className="mb-2 flex items-center gap-2 text-xs text-ink-mute"><span>Current plan</span><span className="rounded-md border border-line px-2 py-0.5">{trial ? "Trial" : status === "SUSPENDED" ? "Suspended" : "Active"}</span></div><h3 className="text-2xl font-semibold tracking-tight text-ink">{planName(currentPlan)}</h3><p className="mt-2 text-sm text-ink-mute">{trial ? "Explore your reporting workflow before you pay." : currentPlan === "free" ? "A starting point for your workspace." : "Your reporting workspace, ready for work."}</p></div>
        <button type="button" onClick={() => setManageOpen(true)} disabled={!isOwner || !workspaceId || !data || !!error} className="flex min-h-10 items-center gap-2 rounded-lg bg-ink px-4 text-xs font-semibold text-canvas disabled:opacity-50">Manage plan<ArrowUpRight className="h-3.5 w-3.5" /></button>
      </div>
      <dl className="grid gap-5 border-t border-line bg-ink/[0.015] p-5 text-sm sm:grid-cols-3 sm:p-6">
        <div><dt className="text-xs text-ink-mute">{trial ? "Trial ends" : "Access through"}</dt><dd className="mt-2 font-medium text-ink">{deadline ?? (currentPlan === "free" ? "No expiry" : "No expiry recorded")}</dd></div>
        <div><dt className="text-xs text-ink-mute">Agency Pro continuation</dt><dd className="mt-2 font-medium text-ink">{agencyProAmount("monthly").toLocaleString("vi-VN")} ₫ / 30 days</dd></div>
        <div><dt className="text-xs text-ink-mute">Self-serve payment</dt><dd className="mt-2 font-medium text-ink">PayOS bank transfer</dd><p className="mt-1 text-xs text-ink-mute">No automatic bank deductions</p></div>
      </dl>
      <p className="border-t border-line px-5 py-4 text-xs leading-5 text-ink-mute sm:px-6">{expiresToFree ? `Without another payment, this workspace moves to Free after ${deadline}. Your workspace and data are preserved; Free limits apply.` : "Payments activate access only after verification. For legacy plans or an unlisted expiry, contact support before changing tiers."}{!isOwner ? " Only the workspace owner can change billing." : ""}</p>
    </section>
    <section aria-labelledby="billing-usage"><h3 id="billing-usage" className="mb-3 text-sm font-medium text-ink">Workspace usage</h3>{isLoading || !data ? <p className="text-xs text-ink-mute">{error ? "Usage unavailable." : "Loading usage…"}</p> : <div className="grid gap-3 sm:grid-cols-2">{usage.map(item => <div key={item.label} className="rounded-xl border border-line p-4"><div className="flex justify-between gap-3 text-xs"><span className="text-ink-mute">{item.label}</span><span className="font-medium text-ink">{item.used} / {Number.isFinite(item.max) ? item.max : "Unlimited"}</span></div><progress aria-label={item.label} value={item.used} max={Number.isFinite(item.max) ? item.max : Math.max(item.used, 1)} className="mt-3 h-1 w-full appearance-none overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-ink/10 [&::-webkit-progress-value]:bg-ink/60 [&::-moz-progress-bar]:bg-ink/60" /></div>)}</div>}<p className="mt-3 text-xs leading-5 text-ink-mute">Connections count connected sources, not individual ad accounts. Existing data is retained when plan limits change.</p></section>
    <section aria-labelledby="billing-history"><div className="mb-3 flex items-center justify-between"><h3 id="billing-history" className="text-sm font-medium text-ink">Payment history</h3><span className="text-xs text-ink-mute">Latest 10 orders</span></div>
      {!data ? <p className="text-xs text-ink-mute">{error ? "History unavailable." : "Loading payments…"}</p> : data.orders.length ? <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="border-b border-line text-ink-mute"><tr>{["Order", "Created", "Amount", "Status"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-line">{data.orders.map(order => <tr key={order.id}><td className="px-4 py-4 text-ink">#{order.orderCode}<span className="mt-1 block text-ink-mute">{planName(order.plan)}</span></td><td className="px-4 py-4 text-ink-mute">{dateLabel(order.createdAt)}</td><td className="px-4 py-4 text-ink">{new Intl.NumberFormat(order.currency === "VND" ? "vi-VN" : "en-US", { style: "currency", currency: order.currency }).format(order.amount)}</td><td className="px-4 py-4"><span className="rounded-md bg-ink/[0.05] px-2 py-1 text-ink-mute">{order.status}</span></td></tr>)}</tbody></table></div> : <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-6"><Receipt className="h-5 w-5 text-ink-mute" /><div><p className="text-sm text-ink">No payments yet</p><p className="mt-1 text-xs text-ink-mute">Your PayOS orders will appear here. Starting a trial does not create a charge.</p></div></div>}
      <p className="mt-3 text-xs text-ink-mute">Payment records are read-only, not tax invoices. <a className="underline underline-offset-4" href="mailto:support@monsteracloud.com">Contact billing support</a></p>
    </section>
    <ManagePlanModal isOpen={manageOpen} onClose={() => setManageOpen(false)} currentPlan={currentPlan} workspaceStatus={status} subscriptionProvider={data?.subscriptionProvider} subscriptionEndsAt={data?.subscriptionEndsAt} workspaceId={workspaceId} isOwner={isOwner && !!data && !error} onSelectPlan={(_plan, cycle) => { setManageOpen(false); setCheckoutCycle(cycle); }} />
    <VietQrModal isOpen={checkoutCycle !== null} onClose={() => { setCheckoutCycle(null); void mutate(); }} planName="professional" planDisplayName="Agency Pro" amountVnd={agencyProAmount(checkoutCycle ?? "monthly")} billingCycle={checkoutCycle ?? "monthly"} workspaceId={workspaceId} />
  </div>;
}
