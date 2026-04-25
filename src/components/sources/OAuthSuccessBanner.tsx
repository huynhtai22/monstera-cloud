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
      className={`mb-6 rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        limit
          ? "border-amber-200/80 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/30"
          : "border-cyan-200/80 bg-cyan-50/90 dark:border-cyan-900/50 dark:bg-cyan-950/30"
      }`}
      role="status"
    >
      <div className="text-sm text-gray-800 dark:text-cyan-50/95">
        <span className="font-semibold">Connected successfully.</span>{" "}
        {pipelineReady ? (
          <>
            Your first sync is ready — data will flow to your destination
            automatically. Use{" "}
            <span className="font-medium">Sync Now</span> on the card below, or
            open{" "}
            <Link
              href="/reports"
              className="font-medium text-cyan-700 underline dark:text-cyan-300"
            >
              Reports
            </Link>{" "}
            for activity.
          </>
        ) : needsDestination ? (
          <>
            Next, connect a <span className="font-medium">destination</span>{" "}
            (e.g. Google Sheets™) so we can route your data.{" "}
            <Link
              href="/destinations"
              className="font-medium text-cyan-700 underline dark:text-cyan-300"
            >
              Open Destinations
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
        className="shrink-0 text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      >
        Dismiss
      </button>
    </div>
  );
}
