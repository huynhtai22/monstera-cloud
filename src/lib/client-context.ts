/**
 * Canonical client-context URL contract.
 *
 * The `clientId` query parameter is the only source of truth for which client
 * an operational surface is viewing. This module is browser-safe: no Prisma,
 * Node builtins, or server-only imports.
 */

export const CLIENT_ID_QUERY_PARAM = "clientId";
export const ALL_CLIENTS_TOKEN = "all";
export const UNASSIGNED_CLIENT_TOKEN = "unassigned";
export const CLIENT_ID_MAX_LENGTH = 160;
export const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type ClientContextSurface = "clients" | "sources" | "reports" | "warehouse" | "exports";

export type RequestedClientKind = "missing" | "all" | "unassigned" | "id" | "malformed";

export type ParsedClientRequest =
  | { kind: "missing"; raw: null }
  | { kind: "all"; raw: typeof ALL_CLIENTS_TOKEN }
  | { kind: "unassigned"; raw: typeof UNASSIGNED_CLIENT_TOKEN }
  | { kind: "id"; raw: string }
  | { kind: "malformed"; raw: string };

export const CLIENT_CONTEXT_SURFACE_POLICY: Record<
  ClientContextSurface,
  { allowsAllClients: boolean; allowsUnassigned: boolean }
> = {
  clients: { allowsAllClients: true, allowsUnassigned: false },
  sources: { allowsAllClients: true, allowsUnassigned: false },
  reports: { allowsAllClients: true, allowsUnassigned: false },
  warehouse: { allowsAllClients: true, allowsUnassigned: true },
  exports: { allowsAllClients: true, allowsUnassigned: false },
};

/** Query keys that survive a client switch. */
export const PRESERVED_FILTER_KEYS = [
  "startDate",
  "endDate",
  "dateFrom",
  "dateTo",
  "windowStart",
  "windowEnd",
  "platform",
  "platforms",
  "source",
  "view",
  "tab",
  "search",
  "status",
  "mode",
  "dimensions",
  "metrics",
] as const;

export function isValidClientIdFormat(value: string): boolean {
  return value.length > 0 && value.length <= CLIENT_ID_MAX_LENGTH && CLIENT_ID_PATTERN.test(value);
}

export function parseRequestedClientId(raw: string | null | undefined): ParsedClientRequest {
  if (raw == null || raw === "") return { kind: "missing", raw: null };
  if (raw !== raw.trim() || raw.includes("\0")) return { kind: "malformed", raw };
  if (raw === ALL_CLIENTS_TOKEN) return { kind: "all", raw: ALL_CLIENTS_TOKEN };
  if (raw === UNASSIGNED_CLIENT_TOKEN) return { kind: "unassigned", raw: UNASSIGNED_CLIENT_TOKEN };
  if (isValidClientIdFormat(raw)) return { kind: "id", raw };
  return { kind: "malformed", raw };
}

/**
 * Writes exactly one `clientId` value (or removes it). Never appends a duplicate.
 */
export function applyClientIdParam(params: URLSearchParams, value: string | null | undefined): URLSearchParams {
  params.delete(CLIENT_ID_QUERY_PARAM);
  if (value == null || value === "") return params;
  params.set(CLIENT_ID_QUERY_PARAM, value);
  return params;
}

function collapseToSingleValue(source: URLSearchParams, key: string, dest: URLSearchParams): void {
  const values = source.getAll(key);
  if (values.length === 0) return;
  dest.set(key, values[values.length - 1]!);
}

export function switchClientKeepingFilters(
  current: URLSearchParams,
  nextClientId: string | null | undefined,
): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of PRESERVED_FILTER_KEYS) {
    collapseToSingleValue(current, key, next);
  }
  const parsed = parseRequestedClientId(nextClientId ?? null);
  if (parsed.kind === "missing") return next;
  applyClientIdParam(next, parsed.raw);
  return next;
}

const LOCAL_URL_ORIGIN = "https://monstera.invalid";

export function withClientContextAndParams(
  pathname: string,
  requested: string | null | undefined,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  const parsed = parseRequestedClientId(requested ?? null);
  if (parsed.kind !== "missing") applyClientIdParam(params, parsed.raw);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (key === CLIENT_ID_QUERY_PARAM) continue;
      params.set(key, value);
    }
  }
  return canonicalHref(pathname, params);
}

export function withClientContext(href: string, requested: string | null | undefined): string {
  const hasOrigin = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = hasOrigin ? new URL(href) : new URL(href, LOCAL_URL_ORIGIN);
  const parsed = parseRequestedClientId(requested ?? null);
  if (parsed.kind === "missing") {
    url.searchParams.delete(CLIENT_ID_QUERY_PARAM);
  } else {
    applyClientIdParam(url.searchParams, parsed.raw);
  }
  if (hasOrigin) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Carries the safe, cross-surface filters with a client context link. Page- or
 * account-specific state is deliberately excluded: those values can refer to
 * a different client's data after navigation.
 */
export function withClientContextAndFilters(
  href: string,
  requested: string | null | undefined,
  current: URLSearchParams,
): string {
  const hasOrigin = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = hasOrigin ? new URL(href) : new URL(href, LOCAL_URL_ORIGIN);
  for (const key of PRESERVED_FILTER_KEYS) {
    if (!url.searchParams.has(key)) collapseToSingleValue(current, key, url.searchParams);
  }

  const parsed = parseRequestedClientId(requested ?? null);
  if (parsed.kind === "missing") {
    url.searchParams.delete(CLIENT_ID_QUERY_PARAM);
  } else {
    applyClientIdParam(url.searchParams, parsed.raw);
  }
  if (hasOrigin) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function canonicalHref(pathname: string, params: URLSearchParams): string {
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function surfaceForPathname(pathname: string): ClientContextSurface | null {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  if (path === "/clients" || path.startsWith("/clients/")) return "clients";
  if (path === "/sources" || path.startsWith("/sources/")) return "sources";
  if (path === "/reports" || path.startsWith("/reports/")) return "reports";
  if (path === "/explorer" || path.startsWith("/explorer/")) return "warehouse";
  if (path === "/exports" || path.startsWith("/exports/")) return "exports";
  return null;
}

export function shouldPropagateClientContext(pathname: string): boolean {
  return surfaceForPathname(pathname) !== null;
}

export function surfaceAllowsAllClients(surface: ClientContextSurface): boolean {
  return CLIENT_CONTEXT_SURFACE_POLICY[surface].allowsAllClients;
}

export function surfaceAllowsUnassigned(surface: ClientContextSurface): boolean {
  return CLIENT_CONTEXT_SURFACE_POLICY[surface].allowsUnassigned;
}

/**
 * Distinct cache-key fragment so missing, `all`, `unassigned`, and a real id
 * never share a cached payload.
 */
export function clientContextCacheParams(requested: string | null | undefined): { clientScope: string } {
  const parsed = parseRequestedClientId(requested);
  switch (parsed.kind) {
    case "missing":
      return { clientScope: "missing" };
    case "all":
      return { clientScope: "all" };
    case "unassigned":
      return { clientScope: "unassigned" };
    case "id":
      return { clientScope: `id:${parsed.raw}` };
    case "malformed":
      return { clientScope: "malformed" };
  }
}

/**
 * Normalize a client value for analyst (and similar workspace-scoped) request
 * builders. The All Clients sentinel is a browser URL representation, not a
 * database identity: it must be omitted so the server treats the request as
 * workspace-wide. Concrete ids — including unknown ones — pass through
 * untouched so server-side strict validation still applies.
 */
export function normalizeAnalystClientId(raw: string | null | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value === ALL_CLIENTS_TOKEN) return undefined;
  return value;
}
