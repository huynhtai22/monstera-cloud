"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function PlanLimitCard({
  title,
  detail,
  upgradeHref = "/support?pilot=1&plan=starter",
  actionLabel = "Request upgrade",
}: {
  title: string;
  detail: string;
  upgradeHref?: string;
  actionLabel?: string;
}) {
  return (
    <div
      className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-mute">{detail}</p>
          <Link
            href={upgradeHref}
            className="mt-3 inline-flex items-center justify-center rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-neutral-200"
          >
            {actionLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
