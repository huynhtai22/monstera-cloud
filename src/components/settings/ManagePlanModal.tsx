"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, X } from "lucide-react";
import { BillingCycleSwitch, PlanOptions } from "@/components/pricing/PlanOptions";
import { agencyProAmount, canPurchaseAgencyPro, planName, type BillingCycle, type BillingCurrency } from "@/lib/public-plan-catalog";
import type { PlanName } from "@/lib/plan-config";

interface ManagePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlan: string;
  workspaceStatus?: string;
  subscriptionProvider?: string | null;
  subscriptionEndsAt?: string | null;
  workspaceId?: string;
  isOwner: boolean;
  onSelectPlan: (plan: PlanName, billingCycle: BillingCycle, amountVnd: number) => void;
}

export function ManagePlanModal(props: ManagePlanModalProps) {
  return props.isOpen ? <PlanDialog {...props} /> : null;
}

function PlanDialog({ onClose, currentPlan, workspaceStatus = "ACTIVE", subscriptionProvider, subscriptionEndsAt, isOwner, onSelectPlan }: ManagePlanModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [currency, setCurrency] = useState<BillingCurrency>("VND");
  const [review, setReview] = useState(false);
  const eligible = canPurchaseAgencyPro(currentPlan, workspaceStatus, { provider: subscriptionProvider, endsAt: subscriptionEndsAt });

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  const contactSales = () => { window.location.href = "mailto:support@monsteracloud.com?subject=Monstera%20billing%20enquiry"; };

  return createPortal(<dialog ref={dialogRef} aria-labelledby="manage-plan-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm">
    <div className="p-5 sm:p-7">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div><p className="mb-1 text-xs text-ink-mute">Workspace billing · {planName(currentPlan)}</p><h2 id="manage-plan-title" className="text-xl font-semibold tracking-tight">{review ? "Review your payment" : "Your plan, on your terms"}</h2><p className="mt-2 text-sm text-ink-mute">{review ? "Nothing is charged until you approve a bank transfer." : "Simple prepaid access. No automatic bank deductions."}</p></div>
        <button type="button" aria-label="Close plan options" onClick={onClose} className="rounded-lg p-2 text-ink-mute hover:bg-ink/[0.06]"><X className="h-4 w-4" /></button>
      </header>
      {review ? <section className="space-y-5">
        <button type="button" onClick={() => setReview(false)} className="flex items-center gap-2 text-xs text-ink-mute"><ArrowLeft className="h-3.5 w-3.5" />Back to plans</button>
        <dl className="divide-y divide-line rounded-xl border border-line px-5 text-sm">
          <div className="flex justify-between gap-3 py-4"><dt>Plan</dt><dd>Agency Pro · {cycle === "annual" ? "365 days" : "30 days"}</dd></div>
          <div className="flex justify-between gap-3 py-4"><dt>Transfer amount</dt><dd className="font-semibold">{agencyProAmount(cycle).toLocaleString("vi-VN")} ₫</dd></div>
          <div className="flex justify-between gap-3 py-4"><dt>Payment method</dt><dd>PayOS · VietQR</dd></div>
        </dl>
        <p className="text-sm leading-6 text-ink-mute">Access starts only after PayOS verifies your payment. If you have time remaining, this payment extends it by {cycle === "annual" ? "365" : "30"} days. Selecting a plan or returning from checkout does not activate it.</p>
        <p className="text-xs leading-5 text-ink-mute">This is a new prepaid term, not a prorated tier switch. No automatic credit or refund is applied. Contact us before paying if you need a different arrangement.</p>
        <button type="button" disabled={!isOwner || !eligible} onClick={() => onSelectPlan("professional", cycle, agencyProAmount(cycle))} className="min-h-11 w-full rounded-lg bg-ink px-4 text-sm font-medium text-canvas disabled:opacity-50">Continue to secure payment</button>
      </section> : <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><BillingCycleSwitch cycle={cycle} onChange={setCycle} /><label className="flex items-center gap-2 text-xs text-ink-mute">Currency<select aria-label="Billing currency" value={currency} onChange={event => setCurrency(event.target.value as BillingCurrency)} className="rounded-lg border border-line bg-panel px-3 py-2 text-ink"><option value="VND">VND · VietQR</option><option value="USD">USD · contact sales</option></select></label></div>
        <PlanOptions cycle={cycle} currency={currency} currentPlan={currentPlan} disabled={!isOwner} primaryLabel={!eligible ? "Discuss a plan change" : currentPlan === "professional" ? "Extend Agency Pro" : "Upgrade to Agency Pro"} onSelect={plan => { if (plan === "enterprise" || currency === "USD" || !eligible) contactSales(); else setReview(true); }} />
        <div className="mt-5 border-t border-line pt-4 text-xs leading-5 text-ink-mute"><p><span className="font-medium text-ink">Moving to Free?</span> For dated PayOS plans and trials, simply don’t renew. Your workspace and data remain, with Free limits after expiry. There is no recurring bank charge to cancel.</p><p className="mt-2">Legacy plans without an expiry and changes to a different paid tier need a <a href="mailto:support@monsteracloud.com" className="underline underline-offset-4">billing review</a>.</p></div>
      </>}
    </div>
  </dialog>, document.body);
}
