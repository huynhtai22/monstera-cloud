"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SourceOutcomeNotice = {
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
    container: "border-emerald-500/30 bg-emerald-950/20 text-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-950/25",
    iconBox: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    actionButton: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-500/40",
  },
  partial: {
    icon: AlertCircle,
    container: "border-amber-500/30 bg-amber-950/20 text-amber-100 dark:border-amber-500/30 dark:bg-amber-950/25",
    iconBox: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    actionButton: "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:border-amber-500/40",
  },
  blocked: {
    icon: Loader2,
    container: "border-sky-500/30 bg-sky-950/20 text-sky-100 dark:border-sky-500/30 dark:bg-sky-950/25",
    iconBox: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    actionButton: "border-sky-500/30 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 hover:border-sky-500/40",
  },
  cooldown: {
    icon: Clock3,
    container: "border-amber-500/30 bg-amber-950/20 text-amber-100 dark:border-amber-500/30 dark:bg-amber-950/25",
    iconBox: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    actionButton: "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:border-amber-500/40",
  },
  error: {
    icon: AlertCircle,
    container: "border-rose-500/30 bg-rose-950/20 text-rose-100 dark:border-rose-500/30 dark:bg-rose-950/25",
    iconBox: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    actionButton: "border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:border-rose-500/40",
  },
} as const;

export function SourceOutcomeBanner({
  notice,
  onDismiss,
}: {
  notice: SourceOutcomeNotice;
  onDismiss: () => void;
}) {
  const style = OUTCOME_STYLE[notice.kind];
  const Icon = style.icon;
  const isAlert = notice.kind === "partial" || notice.kind === "error";

  return (
    <div
      className={cn(
        "relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border p-4 sm:p-5 shadow-xs backdrop-blur-md transition-all",
        style.container,
      )}
      role={isAlert ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
            style.iconBox,
          )}
        >
          <Icon
            className={cn(
              "h-4 w-4",
              notice.kind === "blocked" && "motion-safe:animate-spin motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-sm font-semibold tracking-tight text-white">{notice.title}</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300 dark:text-slate-300">
            {notice.detail}
          </p>
          {notice.action && (
            <div className="mt-3">
              <Link
                href={notice.action.href}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                  style.actionButton,
                )}
              >
                <span>{notice.action.label}</span>
                <ArrowRight className="h-3.5 w-3.5 opacity-80" />
              </Link>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-3.5 right-3.5 sm:static flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        aria-label="Dismiss source outcome"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
