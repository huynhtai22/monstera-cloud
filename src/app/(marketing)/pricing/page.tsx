"use client";

import Link from "next/link";
import { ArrowRight, Check, CircleAlert, ShieldCheck } from "lucide-react";
import {
  PLAN_LIMITS,
  formatPlanPrice,
  type PlanName,
} from "@/lib/plan-config";
import { cn } from "@/lib/utils";
import { useState } from "react";

type PublicPlan = {
  key: PlanName;
  name: string;
  audience: string;
  description: string;
  highlighted?: boolean;
};

const PUBLIC_PLANS: readonly PublicPlan[] = [
  {
    key: "free",
    name: "Free",
    audience: "Evaluate the workflow",
    description: "Create a workspace, connect a small reporting scope, and verify how Monstera fits your process.",
  },
  {
    key: "starter",
    name: "Starter",
    audience: "Solo operators and small teams",
    description: "A practical reporting foundation for a focused set of advertising accounts and destinations.",
  },
  {
    key: "professional",
    name: "Professional",
    audience: "Agencies and multi-brand teams",
    description: "More connections, team seats, reporting history, and query capacity for recurring client work.",
    highlighted: true,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    audience: "Larger managed deployments",
    description: "Higher configured limits with a sales-assisted onboarding and operating plan.",
  },
] as const;

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [currency, setCurrency] = useState<"USD" | "VND">("USD");

  return (
    <div className="min-h-screen bg-canvas px-4 pb-24 pt-20 font-sans text-ink sm:px-6 sm:pt-24 lg:px-8">
      <section className="mx-auto max-w-4xl text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 font-mono text-[11px] text-ink-mute">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Predictable workspace plans
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          Choose the reporting capacity your workspace needs.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-sm leading-relaxed text-ink-mute sm:text-base">
          Plans are based on workspace connections, seats, pipelines, and reporting limits—not warehouse row billing.
          Paid-plan activation is operator-managed during the private pilot.
        </p>
      </section>

      <section className="mx-auto mt-10 max-w-6xl" aria-labelledby="plan-options">
        <h2 id="plan-options" className="sr-only">Plan options</h2>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <div className="inline-flex rounded-full border border-line bg-panel p-1" role="group" aria-label="Billing period">
            <ToggleButton pressed={!isAnnual} onClick={() => setIsAnnual(false)}>Monthly</ToggleButton>
            <ToggleButton pressed={isAnnual} onClick={() => setIsAnnual(true)}>Annual billing</ToggleButton>
          </div>
          <div className="inline-flex rounded-full border border-line bg-panel p-1" role="group" aria-label="Display currency">
            <ToggleButton pressed={currency === "USD"} onClick={() => setCurrency("USD")}>USD</ToggleButton>
            <ToggleButton pressed={currency === "VND"} onClick={() => setCurrency("VND")}>VND</ToggleButton>
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PUBLIC_PLANS.map((plan) => (
            <PlanCard key={plan.key} plan={plan} currency={currency} isAnnual={isAnnual} />
          ))}
        </div>

        <div className="mt-6 flex gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-5 text-sm leading-relaxed text-ink-mute">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
          <p>
            Pricing is shown for planning. During the private pilot, Monstera confirms connector access and activates paid
            entitlements with you directly. The public site does not perform an automatic upgrade or subscription change.
          </p>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl" aria-labelledby="compare-plans">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">Configured limits</p>
          <h2 id="compare-plans" className="mt-3 text-3xl font-semibold tracking-tight text-ink">Compare workspace capacity</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-mute">
            These values come from the same plan configuration used by the product. Provider access is still assigned
            explicitly during the pilot.
          </p>
        </div>

        <div className="mt-8 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-panel">
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-4 font-medium text-ink-mute">Configured limit</th>
                {PUBLIC_PLANS.map((plan) => (
                  <th scope="col" key={plan.key} className="px-5 py-4 font-semibold text-ink">{plan.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-canvas">
              <ComparisonRow label="Connections" value={(plan) => formatLimit(PLAN_LIMITS[plan].maxConnections)} />
              <ComparisonRow label="Workspace seats" value={(plan) => formatLimit(PLAN_LIMITS[plan].maxSeats)} />
              <ComparisonRow label="Pipelines" value={(plan) => formatLimit(PLAN_LIMITS[plan].maxPipelines)} />
              <ComparisonRow label="Monthly queries / refreshes" value={(plan) => formatLimit(PLAN_LIMITS[plan].maxQueriesPerMonth)} />
              <ComparisonRow label="Warehouse query date range" value={(plan) => `${PLAN_LIMITS[plan].explorerMaxDateRangeDays} days`} />
              <ComparisonRow label="Rows returned per query" value={(plan) => formatLimit(PLAN_LIMITS[plan].explorerMaxRowsPerQuery)} />
              <ComparisonRow label="Advertised sync cadence" value={(plan) => PLAN_LIMITS[plan].syncLabel} />
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-5xl rounded-2xl border border-line bg-panel px-6 py-12 text-center sm:px-12">
        <ShieldCheck className="mx-auto h-6 w-6 text-emerald-400" aria-hidden />
        <h2 className="mt-4 text-3xl font-semibold tracking-tight text-ink">Start with a verified reporting workflow.</h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-ink-mute">
          Tell us which certified source and destination you need. We will confirm access requirements before any paid
          entitlement is activated.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/integrations" className="rounded-md border border-line bg-canvas px-5 py-2.5 text-sm font-medium text-ink hover:border-white/25">
            Compare integrations
          </Link>
          <Link href="/support?pilot=1" className="inline-flex items-center justify-center rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-neutral-200">
            Request pilot access
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    </div>
  );
}

function ToggleButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        pressed ? "bg-white text-black" : "text-ink-mute hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function PlanCard({
  plan,
  currency,
  isAnnual,
}: {
  plan: PublicPlan;
  currency: "USD" | "VND";
  isAnnual: boolean;
}) {
  const limits = PLAN_LIMITS[plan.key];
  const price = formatPlanPrice(plan.key, currency, isAnnual);
  const isFree = plan.key === "free";
  const isEnterprise = plan.key === "enterprise";
  const annualTotal = price.amount * 12;
  const formattedAnnual =
    currency === "VND"
      ? `${annualTotal.toLocaleString("vi-VN")} đ billed yearly`
      : `$${annualTotal.toLocaleString("en-US")} billed yearly`;

  return (
    <article className={cn(
      "flex h-full flex-col rounded-xl border bg-panel p-6",
      plan.highlighted ? "border-white/25 ring-1 ring-white/10" : "border-line",
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{plan.name}</h3>
          <p className="mt-1 text-xs text-ink-mute">{plan.audience}</p>
        </div>
        {plan.highlighted ? (
          <span className="rounded-full border border-line bg-white/[0.07] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-ink">
            Agency fit
          </span>
        ) : null}
      </div>

      <div className="mt-7 min-h-16">
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tracking-tight text-ink">{price.formatted}</span>
          {!isFree ? <span className="text-xs text-ink-mute">/ month</span> : null}
        </div>
        {isAnnual && !isFree ? <p className="mt-1 font-mono text-[10px] text-ink-mute">{formattedAnnual}</p> : null}
      </div>

      <p className="mt-4 min-h-20 text-sm leading-relaxed text-ink-mute">{plan.description}</p>
      <ul className="mt-6 space-y-3 border-t border-line pt-5 text-xs text-ink-mute">
        <PlanPoint>{formatLimit(limits.maxConnections)} connections</PlanPoint>
        <PlanPoint>{formatLimit(limits.maxSeats)} workspace seats</PlanPoint>
        <PlanPoint>{formatLimit(limits.maxPipelines)} pipelines</PlanPoint>
        <PlanPoint>{limits.syncLabel} cadence</PlanPoint>
      </ul>

      <div className="mt-auto pt-7">
        {isFree ? (
          <Link href="/register" className="flex w-full items-center justify-center rounded-md border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-ink hover:border-white/25">
            Create free account
          </Link>
        ) : isEnterprise ? (
          <Link href="mailto:support@monsteracloud.com?subject=Enterprise%20plan%20inquiry" className="flex w-full items-center justify-center rounded-md border border-line bg-canvas px-4 py-2.5 text-xs font-semibold text-ink hover:border-white/25">
            Contact sales
          </Link>
        ) : (
          <Link href={`/support?pilot=1&plan=${plan.key}`} className={cn(
            "flex w-full items-center justify-center rounded-md px-4 py-2.5 text-xs font-semibold",
            plan.highlighted ? "bg-white text-black hover:bg-neutral-200" : "border border-line bg-canvas text-ink hover:border-white/25",
          )}>
            Request pilot access
          </Link>
        )}
      </div>
    </article>
  );
}

function PlanPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

function ComparisonRow({
  label,
  value,
}: {
  label: string;
  value: (plan: PlanName) => string;
}) {
  return (
    <tr>
      <th scope="row" className="px-5 py-4 font-medium text-ink">{label}</th>
      {PUBLIC_PLANS.map((plan) => (
        <td key={plan.key} className="px-5 py-4 font-mono text-xs text-ink-mute">{value(plan.key)}</td>
      ))}
    </tr>
  );
}

function formatLimit(value: number): string {
  return value === Infinity ? "Unlimited" : value.toLocaleString("en-US");
}
