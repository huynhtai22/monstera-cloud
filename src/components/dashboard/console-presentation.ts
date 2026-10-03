import type { DashboardOverviewDTO } from "@/lib/dashboard-overview";

export const PROVIDER_NAMES: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  lazada: "Lazada",
  shopify: "Shopify",
};

export function formatCompactNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatCurrency(n: number, currency?: string | null): string {
  if (!Number.isFinite(n) || n === 0) return currency ? `0 ${currency}` : "$0";
  const c = (currency ?? "USD").trim().toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: c,
      maximumFractionDigits: c === "VND" ? 0 : 2,
      notation: n >= 1_000_000 ? "compact" : "standard",
    }).format(n);
  } catch {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ${c}`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ${c}`;
    return `${Math.round(n).toLocaleString()} ${c}`;
  }
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export type StatePresentation = {
  label: string;
  detail: string;
  dotClassName: string;
  textClassName: string;
};

export function warehouseStatePresentation(
  status:
    | DashboardOverviewDTO["summaryCards"]["warehouse"]["status"]
    | undefined,
): StatePresentation {
  switch (status) {
    case "fresh":
      return {
        label: "Fresh",
        detail: "Warehouse data is current.",
        dotClassName: "bg-emerald-400",
        textClassName: "text-emerald-400",
      };
    case "refreshing":
      return {
        label: "Syncing",
        detail: "A warehouse refresh is in progress.",
        dotClassName: "bg-neutral-400",
        textClassName: "text-neutral-300",
      };
    case "stale":
      return {
        label: "Stale",
        detail: "Warehouse data needs a refresh.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
    case "partial":
      return {
        label: "Partial",
        detail: "The latest refresh completed for only some sources.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
    case "failed":
      return {
        label: "Refresh failed",
        detail: "The latest refresh did not complete.",
        dotClassName: "bg-red-400",
        textClassName: "text-red-400",
      };
    default:
      return {
        label: "Not synced",
        detail: "No warehouse data has been imported yet.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
  }
}

export function sourceStatePresentation(
  state: DashboardOverviewDTO["sourcesList"][number]["state"],
): StatePresentation {
  switch (state) {
    case "fresh":
      return {
        label: "Healthy",
        detail: "Authorized with a recent successful sync.",
        dotClassName: "bg-emerald-400",
        textClassName: "text-emerald-400",
      };
    case "stale":
      return {
        label: "Stale",
        detail: "The last successful sync is more than a day old.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
    case "stuck":
      return { label: "Sync stuck", detail: "The sync has exceeded one hour. Review and retry.", dotClassName: "bg-amber-400", textClassName: "text-amber-300" };
    case "error":
      return {
        label: "Needs attention",
        detail: "Authorization or connection setup needs attention.",
        dotClassName: "bg-red-400",
        textClassName: "text-red-400",
      };
    case "partial":
      return {
        label: "Partial sync",
        detail:
          "Some requested data was imported; review the source before delivery.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
    case "syncing":
      return {
        label: "Syncing",
        detail: "A warehouse sync is in progress.",
        dotClassName: "bg-neutral-400",
        textClassName: "text-neutral-300",
      };
    case "disconnected":
      return {
        label: "Disconnected",
        detail: "This source cannot sync until it is reconnected.",
        dotClassName: "bg-red-400",
        textClassName: "text-red-400",
      };
    case "unknown":
      return {
        label: "State needs review",
        detail:
          "This source has an unrecognized state and is not treated as healthy.",
        dotClassName: "bg-red-400",
        textClassName: "text-red-400",
      };
    default:
      return {
        label: "Connected — not synced",
        detail: "No successful warehouse sync is recorded yet.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
  }
}

export function destinationStatePresentation(
  status: DashboardOverviewDTO["destinationsList"][number]["status"],
): StatePresentation {
  switch (status) {
    case "healthy":
      return {
        label: "Healthy",
        detail: "A recent destination operation completed.",
        dotClassName: "bg-emerald-400",
        textClassName: "text-emerald-400",
      };
    case "active":
      return {
        label: "Active",
        detail: "The destination is configured and available.",
        dotClassName: "bg-emerald-400",
        textClassName: "text-emerald-400",
      };
    case "ready":
      return {
        label: "Ready",
        detail: "Configured and awaiting its first successful operation.",
        dotClassName: "bg-sky-400",
        textClassName: "text-sky-400",
      };
    case "syncing":
      return {
        label: "In progress",
        detail: "A destination operation is currently running.",
        dotClassName: "bg-neutral-400",
        textClassName: "text-neutral-300",
      };
    case "partial":
      return {
        label: "Partial",
        detail: "Some destination pipelines need attention.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
    case "stale":
      return {
        label: "Stale",
        detail: "The destination has not completed recently.",
        dotClassName: "bg-amber-400",
        textClassName: "text-amber-400",
      };
    case "error":
      return {
        label: "Needs attention",
        detail: "The latest destination operation failed.",
        dotClassName: "bg-red-400",
        textClassName: "text-red-400",
      };
    default:
      return {
        label: "Not configured",
        detail: "Set up this destination to begin using it.",
        dotClassName: "bg-neutral-500",
        textClassName: "text-ink-mute",
      };
  }
}
