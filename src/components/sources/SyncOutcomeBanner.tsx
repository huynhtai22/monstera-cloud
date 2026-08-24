"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SyncOutcomeNotice = {
  kind: "success" | "partial" | "blocked" | "cooldown" | "error";
  title: string;
  detail: string;
  action?: {
    href: string;
    label: string;
  };
};

const OUTCOME_STYLE = {
  success: {
    icon: CheckCircle2,
    container: "border-emerald-500/30 bg-emerald-950/20 text-emerald-100",
    iconClassName: "text-emerald-400",
  },
  partial: {
    icon: AlertCircle,
    container: "border-amber-500/30 bg-amber-950/20 text-amber-100",
    iconClassName: "text-amber-400",
  },
  blocked: {
    icon: Loader2,
    container: "border-sky-500/30 bg-sky-950/20 text-sky-100",
    iconClassName: "text-sky-400",
  },
  cooldown: {
    icon: Clock3,
    container: "border-amber-500/30 bg-amber-950/20 text-amber-100",
    iconClassName: "text-amber-400",
  },
  error: {
    icon: AlertCircle,
    container: "border-red-500/30 bg-red-950/20 text-red-100",
    iconClassName: "text-red-400",
  },
} as const;

export function SyncOutcomeBanner({
  notice,
  onDismiss,
}: {
  notice: SyncOutcomeNotice;
  onDismiss: () => void;
}) {
  const style = OUTCOME_STYLE[notice.kind];
  const Icon = style.icon;
  const isAlert = notice.kind === "partial" || notice.kind === "error";

  return (
    <div
      className={cn("flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3.5 py-3", style.container)}
      role={isAlert ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon
          className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconClassName, notice.kind === "blocked" && "motion-safe:animate-spin motion-reduce:animate-none")}
          aria-hidden="true"
        />
        <div>
          <p className="text-xs font-semibold">{notice.title}</p>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-ink-mute">{notice.detail}</p>
          {notice.action && (
            <Link
              href={notice.action.href}
              className="mt-2 inline-flex rounded-md border border-current/20 bg-black/10 px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              {notice.action.label}
            </Link>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 text-ink-mute transition-colors hover:bg-black/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        aria-label="Dismiss sync outcome"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
