"use client";

import React from "react";
import Link from "next/link";

export interface OAuthSuccessBannerProps {
  provider: string;
  pipelineReady: boolean;
  needsDestination: boolean;
  limit: boolean;
  onDismiss: () => void;
}

export function OAuthSuccessBanner({
  pipelineReady,
  needsDestination,
  limit,
  onDismiss,
}: OAuthSuccessBannerProps) {
  return (
    <div
      className={`mb-6 rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        limit
          ? "border-amber-500/30 bg-amber-950/20"
          : "border-line bg-panel"
      }`}
      role="status"
    >
      <div className="text-sm text-ink">
        <span className="font-semibold">Connected successfully.</span>{" "}
        {pipelineReady ? (
          <>
            Your first sync is ready — data will flow to your destination
            automatically. Use{" "}
            <span className="font-medium">Sync Now</span> on the card below, or
            open{" "}
            <Link
              href="/reports"
              className="font-medium text-accent underline"
            >
              Reports
            </Link>{" "}
            for activity.
          </>
        ) : needsDestination ? (
          <>
            Next, create a <span className="font-medium">pipeline</span>{" "}
            in the Dashboard to start syncing data.{" "}
            <Link
              href="/console"
              className="font-medium text-accent underline"
            >
              Go to Dashboard
            </Link>
            .
          </>
        ) : limit ? (
          <>
            You&apos;ve reached your plan&apos;s sync limit — manage syncs in{" "}
            <Link
              href="/settings"
              className="font-medium text-amber-800 underline dark:text-amber-200"
            >
              Settings
            </Link>{" "}
            or upgrade to add more.
          </>
        ) : (
          <>You can manage this source below.</>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-xs font-medium text-ink-mute hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}
