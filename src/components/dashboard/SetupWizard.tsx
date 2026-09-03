"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/analytics-events";
import type { PilotActivationState } from "@/lib/pilot-activation";
import { trialDaysRemaining } from "@/lib/pilot-activation";
import { cn } from "@/lib/utils";
import { primaryButtonLinkClassName } from "@/components/ui/PrimaryButton";

type SetupWizardProps = {
  activation: PilotActivationState;
  plan: string;
  workspaceStatus: string;
  onDismiss?: () => void;
};

const recoveryCopy: Record<string, { title: string; description: string }> = {
  source_authorization_failed: {
    title: "Reconnect the source",
    description: "Authorization is incomplete or expired. Open the source and reconnect it before importing again.",
  },
  import_failed: {
    title: "Retry the import",
    description: "The latest import failed. Your existing data is safe; review the import result and retry it.",
  },
  partial_import: {
    title: "Review the partial import",
    description: "Some selected accounts did not finish. Fix the affected source before treating the dashboard as ready.",
  },
  zero_recent_rows: {
    title: "No recent rows arrived",
    description: "The source completed without usable rows from the last seven days. Check the account selection and date range, then import again.",
  },
  stale_data: {
    title: "Refresh stale data",
    description: "The connected source has not produced current data. Review its status and run a fresh import.",
  },
};

export function SetupWizard({ activation, plan, workspaceStatus, onDismiss }: SetupWizardProps) {
  const { data: session } = useSession();
  const firstName = session?.user?.name?.split(/\s+/)[0] ?? "there";
  const activated = activation.status === "activated";
  const completed = [
    activation.currentStep !== "connect_source",
    activation.rows7d > 0,
    activated,
  ];
  const doneCount = completed.filter(Boolean).length;
  const remaining = trialDaysRemaining(activation.trialEndsAt);
  const trialDate = activation.trialEndsAt
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(activation.trialEndsAt))
    : null;
  const recovery = activation.blockers[0] ? recoveryCopy[activation.blockers[0]] : null;

  if (activated) {
    return (
      <section className="relative z-10 rounded-lg border border-emerald-400/20 bg-panel p-5 sm:p-6" aria-labelledby="activation-complete-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-emerald-400/20 bg-emerald-400/[0.06]">
            <Sparkles className="h-5 w-5 text-emerald-300" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="activation-complete-title" className="text-base font-semibold text-ink">
              Your KPI dashboard is ready, {firstName}.
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-mute">
              Activation is complete with {activation.rows7d.toLocaleString()} recent metric rows. Delivery is optional—choose the destination that fits your client workflow.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/docs" className="rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04]">Google Sheets</Link>
              <Link href="/looker-studio" className="rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04]">Looker Studio</Link>
              <Link href="/exports" className="rounded-md border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/[0.04]">API &amp; exports</Link>
            </div>
          </div>
          {onDismiss ? (
            <button
              type="button"
              onClick={() => {
                trackEvent("pilot_activation_guide_dismissed");
                onDismiss();
              }}
              className="shrink-0 rounded text-xs font-semibold text-ink-mute hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const steps = [
    {
      label: "Connect one enabled source",
      description: "Choose Meta Ads, Google Ads, TikTok Ads, or Shopee and complete authorization for this workspace.",
      href: "/sources",
      cta: "Connect a source",
    },
    {
      label: "Import recent data",
      description: "Import at least one metric row from the last seven days and confirm that it reached the warehouse.",
      href: "/explorer",
      cta: "Open Data Explorer",
    },
    {
      label: "Review Performance & Spend",
      description: "Check spend, revenue, ROAS, traffic, and channel mix on the populated panel below.",
      href: "#performance-spend",
      cta: "Review KPI panel",
    },
  ];
  const activeIndex = Math.max(0, completed.findIndex((done) => !done));
  const activeHref = activation.currentStep === "fix_source" && activation.sourceConnectionId
    ? `/sources/${activation.sourceConnectionId}`
    : steps[activeIndex].href;

  return (
    <section className="relative z-10 rounded-lg border border-line bg-panel p-5 sm:p-6" aria-labelledby="activation-guide-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Pilot activation</p>
          <h2 id="activation-guide-title" className="mt-1.5 text-base font-semibold text-ink">
            Hi {firstName}, let&apos;s build your first useful dashboard.
          </h2>
          <p className="mt-1 text-sm text-ink-mute">{doneCount} of 3 activation steps complete. You can leave and resume here at any time.</p>
        </div>
        <div className="rounded-md border border-line bg-canvas px-3 py-2 text-right text-[11px] text-ink-mute">
          <p className="font-semibold text-ink">{workspaceStatus === "PILOT" ? "Agency Pro trial" : plan}</p>
          {trialDate ? <p>{remaining} day{remaining === 1 ? "" : "s"} remaining · ends {trialDate}</p> : <p>Current plan: {plan}</p>}
          <p>Then 1,490,000 VND/month</p>
        </div>
      </div>

      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-canvas" aria-label={`${doneCount} of 3 activation steps complete`}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(doneCount / 3) * 100}%` }} />
      </div>

      {recovery ? (
        <div role="status" className="mb-4 flex gap-3 rounded-md border border-amber-500/30 bg-amber-950/20 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-xs font-semibold text-amber-100">{recovery.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-100/75">{recovery.description}</p>
          </div>
        </div>
      ) : null}

      <ol className="space-y-3">
        {steps.map((step, index) => {
          const done = completed[index];
          const active = index === activeIndex;
          return (
            <li key={step.label} className={cn("flex flex-col gap-3 rounded-lg border px-4 py-4 sm:flex-row sm:items-start sm:gap-4", done ? "border-line bg-canvas/70 opacity-70" : active ? "border-line bg-white/[0.04]" : "border-line bg-canvas/40 opacity-50")}>
              <div className="mt-0.5 shrink-0">
                {done ? <CheckCircle2 className="h-5 w-5 text-accent" strokeWidth={1.5} /> : active ? <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line"><span className="h-2 w-2 rounded-full bg-accent" /></span> : <Circle className="h-5 w-5 text-ink-mute" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-semibold", done ? "text-ink-mute line-through" : "text-ink")}>{index + 1}. {step.label}</p>
                {!done ? <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">{step.description}</p> : null}
              </div>
              {active ? (
                <Link
                  href={activeHref}
                  className={primaryButtonLinkClassName + " inline-flex shrink-0 items-center gap-1.5"}
                  onClick={() => trackEvent("pilot_activation_step_clicked", { step: activation.currentStep })}
                >
                  {activation.currentStep === "fix_source" ? "Fix source" : step.cta} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : done ? <span className="shrink-0 text-xs font-medium text-ink-mute">Done</span> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
