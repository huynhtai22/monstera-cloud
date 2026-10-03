"use client";

import { ArrowUpRight, Check } from "lucide-react";
import {
  PUBLIC_PLAN_IDS, PUBLIC_PLANS, publicPlanFeatures, publicPlanPrice,
  type BillingCycle, type BillingCurrency, type PublicPlanId, type PricingLanguage,
} from "@/lib/public-plan-catalog";

export function BillingCycleSwitch({ cycle, onChange, language = "en" }: {
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  language?: PricingLanguage;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-canvas p-1" aria-label="Payment term">
      {(["monthly", "annual"] as const).map(value => (
        <button key={value} type="button" aria-pressed={value === cycle} onClick={() => onChange(value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${value === cycle ? "bg-ink text-canvas" : "text-ink-mute hover:text-ink"}`}>
          {language === "vi" ? (value === "monthly" ? "Theo tháng" : "Theo năm") : value === "monthly" ? "Monthly" : "Annual"}
        </button>
      ))}
    </div>
  );
}

export function PlanOptions({ cycle, currency, currentPlan, onSelect, primaryLabel = "Start seven-day pilot", disabled = false, language = "en" }: {
  cycle: BillingCycle;
  currency: BillingCurrency;
  currentPlan?: string;
  onSelect: (plan: PublicPlanId) => void;
  primaryLabel?: string;
  disabled?: boolean;
  language?: PricingLanguage;
}) {
  const vi = language === "vi";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PUBLIC_PLAN_IDS.map(id => {
        const offer = PUBLIC_PLANS[id];
        const price = publicPlanPrice(id, currency, cycle, language);
        const label = disabled ? (vi ? "Dành cho chủ workspace" : "Workspace owner required")
          : id === "enterprise" ? (vi ? "Liên hệ tư vấn" : "Contact sales")
          : currency === "USD" ? (vi ? "Liên hệ thanh toán USD" : "Contact sales for USD") : primaryLabel;
        const description = vi
          ? id === "professional" ? "Một nơi chung cho dữ liệu hiệu suất của khách hàng." : "Giải pháp báo cáo theo nhu cầu của agency."
          : offer.description;
        return (
          <article key={id} className={`flex flex-col rounded-xl border p-5 sm:p-6 ${id === "professional" ? "border-ink/25 bg-ink/[0.025]" : "border-line bg-panel"}`}>
            <div className="flex min-h-6 items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-ink">{offer.name}</h3>
              {currentPlan === id && <span className="rounded-md bg-ink/[0.06] px-2 py-1 text-[10px] font-medium text-ink-mute">{vi ? "Gói hiện tại" : "Current plan"}</span>}
            </div>
            <p className="mt-2 min-h-10 text-xs leading-5 text-ink-mute">{description}</p>
            <div className="mt-5">
              <span className="text-[28px] font-semibold tracking-tight text-ink">{price.formatted}</span>
              <span className="ml-1 text-xs text-ink-mute">{price.suffix}</span>
              <p className="mt-1 text-[11px] text-ink-mute">{price.detail}</p>
            </div>
            <button type="button" disabled={disabled} onClick={() => onSelect(id)}
              className={`mt-5 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${id === "professional" ? "bg-ink text-canvas hover:opacity-90" : "border border-line text-ink hover:bg-ink/[0.04]"}`}>
              {label}<ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <ul className="mt-5 space-y-3 border-t border-line pt-5">
              {publicPlanFeatures(id, language).map(feature => (
                <li key={feature} className="flex gap-2.5 text-xs leading-5 text-ink-mute">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/60" /><span>{feature}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
