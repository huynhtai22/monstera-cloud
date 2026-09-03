import { timeAgo } from "@/lib/time-format";

export type AccountTagEntry = { id: string; label: string } | string;

export type SourceListRow = {
  id: string;
  provider?: string;
  name: string;
  status: string;
  healthState?: string;
  errorMsg?: string;
  lastSync?: string;
  accountTags?: AccountTagEntry[];
};

export type SourceStateKind =
  | "connected"
  | "not-synced"
  | "syncing"
  | "partial"
  | "sync-issue"
  | "auth-required"
  | "stale"
  | "attention";

export type SourceState = {
  kind: SourceStateKind;
  label: string;
  subtext: string;
  detail: string;
  needsReconnect: boolean;
  canSync: boolean;
};

export const MULTI_ACCOUNT_PROVIDERS = ["meta_ads", "google_ads", "tiktok_business"] as const;

export function isMultiAccountProvider(provider?: string): boolean {
  return provider != null && (MULTI_ACCOUNT_PROVIDERS as readonly string[]).includes(provider);
}

export const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  tiktok_business: "TikTok Ads",
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
  lazada: "Lazada",
  shopify: "Shopify",
  amazon: "Amazon",
};

const ACCOUNT_NOUN: Record<string, [string, string]> = {
  google_ads: ["customer account", "customer accounts"],
  meta_ads: ["ad account", "ad accounts"],
  tiktok_business: ["advertiser", "advertisers"],
  shopee: ["shop", "shops"],
  tiktok_shop: ["shop", "shops"],
  lazada: ["store", "stores"],
  shopify: ["store", "stores"],
  amazon: ["marketplace", "marketplaces"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isGenericConnectionName(provider: string, rawName: string): boolean {
  const n = rawName.trim();
  if (!n) return true;
  if (provider === "shopee" && /^OpenSANDBOX/i.test(n)) return true;
  if (provider === "meta_ads" && /^Meta(\s*Ads)?(\s*\(\d+\s*accounts?\))?$/i.test(n)) return true;
  if (provider === "google_ads" && /^Google Ads(\s*(\(\d+\s*accounts?\)|\s*—\s*(MCC|Customer)\s+[\d-]+))?$/i.test(n)) {
    return true;
  }
  if (provider === "lazada" && /^Lazada(\s*\([A-Z]{2}\))?(\s*—\s*.+)?$/i.test(n)) return true;
  if (provider === "tiktok_shop" && /^TikTok Shop(\s*\(.+\))?$/i.test(n)) return true;
  if (provider === "amazon" && /^Amazon( Selling Partner)?$/i.test(n)) return true;
  const title = PROVIDER_DISPLAY_NAME[provider];
  if (!title) return false;
  return new RegExp(`^${escapeRegExp(title)}(\\s*\\(\\d+\\s+[a-z]+\\))?$`, "i").test(n);
}

export function displayConnectionName(provider: string, rawName?: string | null): string {
  const fallback = PROVIDER_DISPLAY_NAME[provider] ?? (rawName?.trim() || provider);
  const name = (rawName ?? "").trim();
  if (!name || isGenericConnectionName(provider, name)) return fallback;
  return name;
}

export function shopeeShopIdFrom(
  creds: Record<string, unknown> | null | undefined,
  rawName?: string | null,
): string | null {
  const fromCreds = creds?.shop_id ?? creds?.shopId;
  if (fromCreds != null && String(fromCreds).trim() !== "") {
    const asNumber = Number(fromCreds);
    if (Number.isFinite(asNumber) && asNumber > 0) return String(asNumber);
    const asText = String(fromCreds).trim();
    if (/^\d{5,}$/.test(asText)) return asText;
  }
  const match = (rawName ?? "").match(/\((\d{5,})\)\s*$/);
  return match ? match[1] : null;
}

export function isHumanAccountLabel(label: string, id: string): boolean {
  const stripped = label.replace(/^(Shop ID|Advertiser|Customer|act_|CID|MCC):\s*/i, "").trim();
  if (!stripped) return false;
  const labelDigits = stripped.replace(/\D/g, "");
  const idDigits = String(id).replace(/\D/g, "");
  if (labelDigits && idDigits && labelDigits === idDigits) return false;
  return /[A-Za-z]/.test(stripped);
}

function accountNoun(provider: string | undefined, count: number): string {
  const pair = (provider && ACCOUNT_NOUN[provider]) || ["account", "accounts"];
  return count === 1 ? pair[0] : pair[1];
}

export function summarizeAccountScope(
  provider: string | undefined,
  tags: AccountTagEntry[] | undefined,
  discoveredCount?: number,
): {
  chips: Array<{ id: string; label: string }>;
  moreCount: number;
  countLabel: string;
} {
  const list = (tags ?? []).map((tag) =>
    typeof tag === "object" ? tag : { id: tag, label: tag },
  );
  const count = Number.isFinite(discoveredCount) && (discoveredCount as number) >= 0
    ? (discoveredCount as number)
    : list.length;
  const countLabel = `${count} ${accountNoun(provider, count)}`;
  const named = list.filter((tag) => isHumanAccountLabel(tag.label, tag.id));
  if (named.length === 0) {
    return { chips: [], moreCount: 0, countLabel };
  }
  return {
    chips: named.slice(0, 2),
    moreCount: Math.max(0, named.length - 2),
    countLabel,
  };
}

export function isInFlightProviderSync(msg?: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  if (/will resume this task automatically/.test(m)) return true;
  if (/\bstill processing\b/.test(m)) return true;
  if (/did not complete before the bounded polling/.test(m)) return true;
  if (/report task/.test(m) && /\b(processing|queuing|running|init)\b/.test(m)) return true;
  return false;
}

export function humanizeSourceError(msg?: string | null): string {
  if (!msg) return "";
  const original = msg.trim();
  if (isInFlightProviderSync(original)) {
    return "TikTok is still building this report. Monstera will resume it automatically.";
  }

  let cleaned = original
    .replace(/^\[(failed|partial|error)\]\s*/i, "")
    .replace(/^\d{6,}:\s*/g, "")
    .replace(/^connection:\s*/i, "")
    .replace(/connection\s+[a-z0-9_]{15,40}\s+(has\s+)?/gi, "")
    .replace(/request_id=[a-z0-9:_-]+/gi, "")
    .replace(/TikTok report task \d+\s*/gi, "TikTok report ")
    .replace(/\s+/g, " ")
    .trim();

  if (/token|expired|unauthorized|401|oauth|re-authenticate|reconnect/i.test(cleaned)) {
    return "Authorization expired. Reconnect to resume syncing.";
  }
  if (/no active/.test(cleaned.toLowerCase()) || /customer accounts are available/i.test(cleaned)) {
    return "No accounts are available on this connection yet.";
  }
  if (cleaned.length > 140) {
    cleaned = `${cleaned.slice(0, 137)}…`;
  }
  return cleaned;
}

function isAuthFailure(row: Pick<SourceListRow, "status" | "healthState" | "errorMsg">): boolean {
  if (row.status === "disconnected" || row.healthState === "disconnected") return true;
  const msg = (row.errorMsg || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("token") ||
    msg.includes("expired") ||
    msg.includes("401") ||
    msg.includes("unauthorized") ||
    msg.includes("revoked") ||
    msg.includes("oauth") ||
    msg.includes("permission") ||
    msg.includes("access denied") ||
    msg.includes("forbidden") ||
    msg.includes("403") ||
    msg.includes("re-authenticate") ||
    msg.includes("reconnect") ||
    msg.includes("no active") ||
    msg.includes("customer accounts are available") ||
    msg.includes("session has expired")
  );
}

export function sourceStateFor(row: SourceListRow, syncBusy: boolean): SourceState {
  if (syncBusy || row.healthState === "syncing" || row.status === "syncing") {
    return {
      kind: "syncing",
      label: "Syncing",
      subtext: "Ingestion active",
      detail: "A warehouse sync is currently running.",
      needsReconnect: false,
      canSync: false,
    };
  }

  const isAuthErr = isAuthFailure(row);
  const state = row.healthState ?? row.status;

  if (isAuthErr) {
    const isMissingAccounts =
      (row.errorMsg || "").toLowerCase().includes("no active") ||
      (row.accountTags?.length === 0 && (row.errorMsg || "").includes("account"));
    return {
      kind: "auth-required",
      label: isMissingAccounts ? "No accounts" : "Needs re-auth",
      subtext: isMissingAccounts ? "Select accounts" : "OAuth expired",
      detail: humanizeSourceError(row.errorMsg) || "Authorization expired. Reconnect to resume syncing.",
      needsReconnect: true,
      canSync: false,
    };
  }

  if (isInFlightProviderSync(row.errorMsg)) {
    return {
      kind: "syncing",
      label: "Syncing",
      subtext: "Provider still processing",
      detail: humanizeSourceError(row.errorMsg),
      needsReconnect: false,
      canSync: false,
    };
  }

  if (state === "partial" || row.errorMsg?.startsWith("[partial]")) {
    return {
      kind: "partial",
      label: "Partial sync",
      subtext: "Some data failed",
      detail: humanizeSourceError(row.errorMsg) || "Some requested data was imported; review and retry the affected source.",
      needsReconnect: false,
      canSync: true,
    };
  }

  if (state === "error" || (row.errorMsg && !isAuthErr)) {
    return {
      kind: "sync-issue",
      label: "Sync issue",
      subtext: "Retry available",
      detail: humanizeSourceError(row.errorMsg) || "Last sync attempt encountered an issue. You can retry the sync now.",
      needsReconnect: false,
      canSync: true,
    };
  }

  if (state === "pending" || !row.lastSync || row.lastSync === "Never") {
    return {
      kind: "not-synced",
      label: "Ready to sync",
      subtext: "Pending initial sync",
      detail: "Authorization is ready, but no successful warehouse sync is recorded yet.",
      needsReconnect: false,
      canSync: true,
    };
  }

  if (state === "stale") {
    return {
      kind: "stale",
      label: "Data stale",
      subtext: "Last sync >24h ago",
      detail: "The last successful sync is older than the one-day freshness threshold.",
      needsReconnect: false,
      canSync: true,
    };
  }

  if (state === "unknown") {
    return {
      kind: "attention",
      label: "Needs review",
      subtext: "Unrecognized state",
      detail: "This source has an unrecognized state and is not treated as healthy.",
      needsReconnect: false,
      canSync: true,
    };
  }

  return {
    kind: "connected",
    label: "Connected",
    subtext: "Active & verified",
    detail: "Authorized and has at least one successful sync.",
    needsReconnect: false,
    canSync: true,
  };
}

export function reconnectGuidance(provider?: string): { title: string; detail: string } {
  if (provider === "google_ads") {
    return {
      title: "Sign in to Google again",
      detail: "Sign in to Google again to restore this MCC and discover customer accounts.",
    };
  }
  if (provider === "meta_ads") {
    return {
      title: "Sign in to Meta again",
      detail: "Sign in to Meta again to restore this Business Manager and discover ad accounts.",
    };
  }
  if (provider === "tiktok_business") {
    return {
      title: "Sign in to TikTok again",
      detail: "Sign in to TikTok again to restore this advertiser and resume reporting.",
    };
  }
  if (provider === "shopee") {
    return {
      title: "Sign in to Shopee again",
      detail: "Sign in to Shopee again to restore this shop and resume order sync.",
    };
  }
  if (provider === "lazada") {
    return {
      title: "Sign in to Lazada again",
      detail: "Sign in to Lazada again to restore this seller and resume order sync.",
    };
  }
  if (provider === "shopify") {
    return {
      title: "Sign in to Shopify again",
      detail: "Sign in to Shopify again to restore this store and resume order sync.",
    };
  }
  if (provider === "amazon") {
    return {
      title: "Sign in to Amazon again",
      detail: "Sign in to Amazon again to restore Selling Partner access.",
    };
  }
  if (provider === "tiktok_shop") {
    return {
      title: "Sign in to TikTok Shop again",
      detail: "Sign in to TikTok Shop again to restore this seller and resume catalog sync.",
    };
  }
  const name = (provider && PROVIDER_DISPLAY_NAME[provider]) || "this source";
  return {
    title: `Reconnect ${name}`,
    detail: `Reconnect ${name} to restore access.`,
  };
}

function formatGoogleCustomerId(raw: unknown): string {
  const clean = String(raw ?? "").replace(/\D/g, "");
  if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
  return String(raw ?? "");
}

/** One identifier chip for a connection: MCC / BM / Shop / Seller. */
export function sourceManagerBadge(opts: {
  provider: string;
  creds?: Record<string, unknown> | null;
  rawName?: string | null;
  remoteAccountId?: string | null;
}): string | null {
  const creds = opts.creds ?? {};
  const { provider } = opts;

  if (provider === "google_ads") {
    const rawRemoteId = String(opts.remoteAccountId ?? "").replace(/\D/g, "");
    const isExplicitCustomer = creds.googleAdsRootType === "customer";
    const isExplicitManager = Boolean(creds.mccId || creds.managerCustomerId || creds.googleAdsRootType === "manager");
    const cidList = Array.isArray(creds.customerIds) ? (creds.customerIds as string[]) : [];
    const resolvedMccId = isExplicitManager
      ? (creds.mccId || creds.managerCustomerId || (rawRemoteId.length > 0 ? rawRemoteId : undefined))
      : (!isExplicitCustomer && rawRemoteId.length > 0 && !cidList.includes(rawRemoteId) ? rawRemoteId : undefined);
    if (resolvedMccId) return `MCC: ${formatGoogleCustomerId(resolvedMccId)}`;
    if (cidList.length === 1 || (isExplicitCustomer && rawRemoteId.length > 0)) {
      return `CID: ${formatGoogleCustomerId(cidList[0] || rawRemoteId)}`;
    }
    if (cidList.length > 1) return `MCC: ${formatGoogleCustomerId(cidList[0])}`;
    return null;
  }

  if (provider === "meta_ads") {
    const bmId = creds.businessManagerId || creds.bmId;
    if (bmId) return `BM: ${bmId}`;
    const ads = creds.adAccounts as Array<{ id: string }> | undefined;
    if (Array.isArray(ads) && ads.length > 0) {
      return `act_${String(ads[0].id).replace(/^act_/, "")}`;
    }
    return null;
  }

  if (provider === "tiktok_business") {
    const bcId = creds.businessCenterId || creds.bcId;
    if (bcId) return `BC: ${bcId}`;
    const list = Array.isArray(creds.advertiserIds) ? (creds.advertiserIds as string[]) : [];
    if (list.length === 1) return `Adv: ${list[0]}`;
    if (list.length > 1) return `BC: ${list[0]}`;
    return null;
  }

  if (provider === "shopee") {
    const shop = shopeeShopIdFrom(creds, opts.rawName);
    return shop ? `Shop: ${shop}` : null;
  }

  if (provider === "shopify") {
    const domain = creds.shopDomain || creds.domain;
    return domain ? `Store: ${String(domain)}` : null;
  }

  if (provider === "lazada") {
    const seller = creds.sellerId || creds.seller_id;
    if (!seller) return null;
    const country = creds.country ? ` (${creds.country})` : "";
    return `Seller: ${seller}${country}`;
  }

  if (provider === "amazon") {
    const sp = creds.sellingPartnerId;
    if (sp && sp !== "pending_user_config") return `SP: ${sp}`;
    return null;
  }

  if (provider === "tiktok_shop") {
    const seller = creds.sellerId || creds.seller_id;
    return seller ? `Seller: ${seller}` : null;
  }

  return null;
}

export function formatLastSyncLabel(
  dateStr?: string | null,
): { text: string; title: string } {
  if (!dateStr || dateStr === "Never") {
    return { text: "Never", title: "No successful sync recorded" };
  }
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) {
    return { text: dateStr, title: dateStr };
  }
  const { text } = timeAgo(date.toISOString());
  const title = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return { text: text ?? title, title };
}
