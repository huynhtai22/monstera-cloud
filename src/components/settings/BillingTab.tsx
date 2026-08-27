"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, CreditCard, Lock } from "lucide-react";
import { formatPlanPrice, getPlanDisplayName, getPlanLimits, PLAN_LIMITS, suggestedUpgradePlan } from "@/lib/plan-config";
import { cn } from "@/lib/utils";

const RUNGS = ["free", "starter", "professional"] as const;

function featureList(plan: (typeof RUNGS)[number]): string[] {
  const limits = PLAN_LIMITS[plan];
  const dest =
    plan === "free"
      ? "Sheets only (Looker Studio on Studio+)"
      : "Warehouse + Sheets + Looker Studio included — no destination fee";
  const seats = plan === "free" ? "1 seat" : "Unlimited seats (50-seat abuse cap)";
  const extra =
    plan === "professional"
      ? ["CSV + REST API", "Daily + on-demand"]
      : plan === "starter"
        ? ["Daily scheduled sync + on-demand"]
        : ["On-demand sync only", "14-day lookback / query history"];
  return [
    `${limits.maxWorkspaces} workspace${limits.maxWorkspaces === 1 ? "" : "s"}`,
    `${limits.maxSourceProviders} source${limits.maxSourceProviders === 1 ? "" : "s"}`,
    `${limits.maxConnections} ad accounts (workspace total)`,
    dest,
    seats,
    ...extra,
  ];
}

export function BillingTab({ workspacePlan }: { workspacePlan: string }) {
  const current = getPlanLimits(workspacePlan);
  const upgrade = suggestedUpgradePlan(workspacePlan);
  const [currency, setCurrency] = useState<"USD" | "VND">("USD");

  useEffect(() => {
    let active = true;
    async function resolveCurrency() {
      try {
        const response = await fetch("/api/geo");
        if (!response.ok) return;
        const geo = await response.json() as { currency?: string };
        if (!active) return;
        setCurrency(geo.currency === "VND" ? "VND" : "USD");
      } catch {
        // USD remains the safe fallback when location detection is unavailable.
      }
    }
    void resolveCurrency();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h3 className="flex items-center text-lg font-semibold text-ink">
          <CreditCard className="mr-2 h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          Plan
        </h3>
        <p className="mt-1 text-sm text-ink-mute">
          Workspace entitlements. Catalog approved — public checkout is not charging yet. Request pilot access to change the rung.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-canvas p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-mute">Current workspace plan</p>
        <p className="mt-1 text-xl font-semibold text-ink">{getPlanDisplayName(workspacePlan)}</p>
        <p className="mt-1 font-mono text-xs text-ink-mute">id: {workspacePlan}</p>
        <ul className="mt-4 grid gap-1.5 text-sm text-ink-mute sm:grid-cols-2">
          <li>{current.maxConnections} source connections</li>
          <li>{current.maxSourceProviders} source platforms</li>
          <li>{current.syncLabel}</li>
          <li>{current.allowLooker ? "Sheets + Looker Studio" : "Sheets only"}</li>
        </ul>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {RUNGS.map((plan) => {
          const price = formatPlanPrice(plan, currency, true);
          const isCurrent = workspacePlan === plan || (plan === "starter" && current.displayName === "Studio");
          const highlighted = plan === "starter";
          return (
            <article
              key={plan}
              className={cn(
                "flex flex-col rounded-xl border bg-panel p-5",
                isCurrent ? "border-white/30 ring-1 ring-white/10" : "border-line",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">{PLAN_LIMITS[plan].displayName}</h4>
                {isCurrent ? (
                  <span className="rounded border border-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-mute">
                    Current
                  </span>
                ) : null}
              </div>
              <p className="text-2xl font-bold text-ink">
                {plan === "free" ? "Free" : price.formatted}
                {plan !== "free" ? <span className="ml-1 text-xs font-normal text-ink-mute">/mo annual</span> : null}
              </p>
              {plan !== "free" ? (
                <p className="mt-0.5 font-mono text-[10px] text-ink-mute">
                  {formatPlanPrice(plan, currency, false).formatted}/mo month-to-month
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-ink-mute">Trial — not a paid plan</p>
              )}
              <ul className="mt-4 flex-1 space-y-2 text-xs text-ink-mute">
                {featureList(plan).map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {plan === "free" || isCurrent ? (
                <p className="mt-4 text-center text-[11px] text-ink-mute">
                  {isCurrent ? "This workspace" : "Included"}
                </p>
              ) : (
                <Link
                  href={`/support?pilot=1&plan=${plan === upgrade ? upgrade : plan}`}
                  className={cn(
                    "mt-4 inline-flex items-center justify-center rounded-md px-3 py-2 text-xs font-semibold",
                    highlighted ? "bg-white text-black hover:bg-neutral-200" : "border border-line bg-canvas text-ink hover:bg-white/[0.04]",
                  )}
                >
                  Request upgrade
                </Link>
              )}
            </article>
          );
        })}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-200/[0.04] px-4 py-3 text-xs text-ink-mute">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200/80" />
        <p>
          Catalog approved 27 Aug 2026. Checkout is not charging yet. USD uses Paddle; VND uses PayOS/VietQR.
          Destinations are included on Studio and Agency — there is no second-destination upsell.
        </p>
      </div>
    </div>
  );
}
