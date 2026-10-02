"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SourceOutcomeNotice = {
  kind: "success" | "partial" | "blocked" | "cooldown" | "error";
  title: string;
  detail: string;
  action?: { href: string; label: string };
};

export function SourceOutcomeBanner({ notice, onDismiss }: { notice: SourceOutcomeNotice; onDismiss: () => void }) {
  const Icon = notice.kind === "success" ? CheckCircle2 : notice.kind === "blocked" || notice.kind === "cooldown" ? Clock3 : AlertCircle;
  const tone = notice.kind === "success" ? "text-emerald-600 dark:text-emerald-400" : notice.kind === "error" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400";
  return <div className="flex items-start gap-3 rounded-lg border border-line bg-panel px-4 py-3" role={notice.kind === "error" ? "alert" : "status"}>
    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-ink">{notice.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-mute">{notice.detail}</p>
      {notice.action && <Link href={notice.action.href} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink underline underline-offset-4">{notice.action.label}<ArrowRight className="h-3 w-3" aria-hidden="true" /></Link>}
    </div>
    <button type="button" onClick={onDismiss} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-mute transition-colors hover:bg-surface-muted hover:text-ink" aria-label="Dismiss source outcome"><X className="h-4 w-4" aria-hidden="true" /></button>
  </div>;
}
