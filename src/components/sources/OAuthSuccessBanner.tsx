"use client";

import React from "react";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";

const PROVIDER_LABELS: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_business: "TikTok Ads",
  tiktok_shop: "TikTok Shop",
  shopee: "Shopee",
  shopify: "Shopify",
  amazon: "Amazon",
  lazada: "Lazada",
};

export interface OAuthSuccessBannerProps {
  provider: string;
  pipelineReady: boolean;
  needsDestination: boolean;
  limit: boolean;
  onDismiss: () => void;
}

export function OAuthSuccessBanner({
  provider,
  pipelineReady,
  needsDestination,
  limit,
  onDismiss,
}: OAuthSuccessBannerProps) {
  const providerLabel = PROVIDER_LABELS[provider] ?? "Source";

  return (
    <div
      className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 ${
        limit
          ? "border-amber-500/30 bg-amber-950/20"
          : "border-line bg-panel"
      }`}
      role="status"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <p className="text-xs font-semibold text-ink">{providerLabel} connected</p>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-mute">
          {limit ? (
            <>Your sync limit is reached. <Link href="/settings?tab=billing" className="font-medium text-ink underline">Review your plan</Link>.</>
          ) : needsDestination ? (
            <>Choose where to send your data. <Link href="/exports" className="font-medium text-ink underline">Set up a destination</Link>.</>
          ) : (
            <>Ready to import data. <Link href="#connected-sources" className="font-medium text-ink underline">{pipelineReady ? "Run the first sync" : "Review your source"}</Link>.</>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-ink-mute hover:bg-white/[0.04] hover:text-ink transition-colors"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
