import { resolveSourceHealthState, SOURCE_HEALTH_STALE_AFTER_MS, type SourceHealthState } from "./source-health";
import { effectiveReportingContext, type ReportingContextEvidence } from "./reporting-context";

export type ReportReadinessStatus = "READY" | "NOT_READY" | "WARNING" | "UNKNOWN";
export type ReadinessCode =
  | "SOURCE_MISSING" | "SOURCE_DISCONNECTED" | "SOURCE_RECONNECT_REQUIRED" | "SOURCE_QUARANTINED"
  | "SYNC_FAILED" | "SYNC_PARTIAL" | "DATA_STALE" | "REPORTING_WINDOW_INCOMPLETE"
  | "CURRENCY_UNKNOWN" | "TIMEZONE_UNKNOWN" | "DESTINATION_UNAVAILABLE" | "DESTINATION_UNVERIFIED"
  | "SOURCE_UNVERIFIED" | "REQUIRED_PROVIDERS_INFERRED" | "EVIDENCE_LIMIT_REACHED" | "MIXED_CURRENCY" | "SYNC_IN_PROGRESS"
  | "TIMEZONE_CONFLICT" | "CURRENCY_CONFLICT" | "DESTINATION_STALE" | "DESTINATION_REQUIREMENTS_MISSING";
export type ReportingWindow = { start: string; end: string };
export type ReadinessIssue = { code: ReadinessCode; connectionId?: string; provider?: string };
export type SyncEvidence = {
  id: string; kind: "import" | "endpoint"; target: string; at: string;
  status: "success" | "failed" | "partial" | "pending" | "unknown";
};
export type SourceEvidence = {
  connectionId: string; provider: string; connectionStatus: string;
  lastError: string | null; lastSyncAt: string | null;
  latestDataDate: string | null;
  accounts: Array<{ accountId: string; status: string; lastSuccessAt: string | null }>;
  days: Array<{ accountId: string; date: string; currency: string | null; rows: number }>;
  syncs: SyncEvidence[];
  timezone: string | null;
  contexts?: ReportingContextEvidence[];
};
export type ProviderReadiness = {
  connectionId: string; provider: string; status: ReportReadinessStatus; health: SourceHealthState;
  latestSuccessfulSyncAt: string | null; latestDataDate: string | null;
  freshness: "fresh" | "stale" | "unknown";
  currencies: string[]; timezone: string | null;
  blockers: ReadinessIssue[]; warnings: ReadinessIssue[];
  evidence: {
    rowCount: number; expectedDays: number;
    accounts: Array<{ accountId: string; health: string; presentDays: number; missingDates: string[] }>;
    syncs: SyncEvidence[];
  };
};
export type ReportReadinessEvaluation = {
  workspaceId: string; clientId: string; window: ReportingWindow; evaluatedAt: string;
  status: ReportReadinessStatus; requiredProviders: string[]; requiredProvidersBasis: "assigned_sources" | "explicit";
  providers: ProviderReadiness[]; latestSuccessfulSyncAt: string | null; latestDataDate: string | null;
  freshness: "fresh" | "stale" | "unknown";
  destination: { state: "verified" | "unavailable" | "unverified" | "stale"; configuredCount: number;
    required?: string[]; receipts?: Array<{ id: string; destination: string; retrievedAt: string; dataThroughDate: string; current: boolean }> };
  currencies: string[]; timezones: string[]; blockers: ReadinessIssue[]; warnings: ReadinessIssue[];
  evidence: { derived: true; limited: boolean; timezonePersisted: boolean };
};

export const READINESS_MESSAGES: Record<ReadinessCode, string> = {
  SOURCE_MISSING: "Assign the required sources to this client in Sources.",
  SOURCE_DISCONNECTED: "A required source is disconnected. Reconnect it in Sources.",
  SOURCE_RECONNECT_REQUIRED: "An account requires authorization. Reconnect its source, then import again.",
  SOURCE_QUARANTINED: "An account is quarantined. Review its permissions with your operator before retrying.",
  SYNC_FAILED: "A source or account import failed. Inspect Sync activity and retry the affected account.",
  SYNC_PARTIAL: "Only part of a source imported. Recover the failed accounts before delivery.",
  DATA_STALE: "The last successful sync is over 24 hours old. Refresh and recheck.",
  REPORTING_WINDOW_INCOMPLETE: "Daily rows are missing for an account. Import this window; missing rows are not assumed to mean zero activity.",
  CURRENCY_UNKNOWN: "Some rows have no known currency. Verify the account currency before delivery.",
  TIMEZONE_UNKNOWN: "Reporting timezone is not recorded. Verify it with the provider before delivery.",
  DESTINATION_UNAVAILABLE: "A configured client destination is unavailable. Review its connection and pipeline.",
  DESTINATION_UNVERIFIED: "No saved client/window delivery proof. Manually verify retrieval in the intended destination.",
  SOURCE_UNVERIFIED: "There is insufficient synchronization evidence for this source.",
  REQUIRED_PROVIDERS_INFERRED: "Required providers are inferred from this client's assigned sources. Confirm no source is missing.",
  EVIDENCE_LIMIT_REACHED: "The evidence limit was reached. Narrow the window or ask an operator to inspect it.",
  MIXED_CURRENCY: "Multiple currencies are present. Keep totals separate; no conversion is certified.",
  SYNC_IN_PROGRESS: "An import is still running. Recheck after it finishes.",
  TIMEZONE_CONFLICT: "Account timezones conflict, or an override differs from the provider. Resolve the reporting context before delivery.",
  CURRENCY_CONFLICT: "Account currency conflicts with the provider, override or metric rows. Reconcile before delivery.",
  DESTINATION_STALE: "Delivery evidence predates the current dataset or reporting configuration. Retrieve this client/window again.",
  DESTINATION_REQUIREMENTS_MISSING: "Choose the destinations that must receive this client's report.",
};
const DAY = 86_400_000;
export function defaultReportingWindow(now = new Date()): ReportingWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY);
  return { start: new Date(end.getTime() - 6 * DAY).toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
export function reportingDates(window: ReportingWindow): string[] {
  const dates: string[] = [];
  for (let t = Date.parse(window.start); t <= Date.parse(window.end) && dates.length <= 90; t += DAY) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}
const UNKNOWN_CODES = new Set<ReadinessCode>(["CURRENCY_UNKNOWN", "TIMEZONE_UNKNOWN", "SOURCE_UNVERIFIED", "EVIDENCE_LIMIT_REACHED"]);
function decision(blockers: ReadinessIssue[], warnings: ReadinessIssue[]): ReportReadinessStatus {
  if (blockers.length) return "NOT_READY";
  if (warnings.some(w => UNKNOWN_CODES.has(w.code))) return "UNKNOWN";
  return warnings.length ? "WARNING" : "READY";
}
function latest(values: Array<string | null>): string | null {
  return values.filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
}
const unique = (values: string[]) => [...new Set(values)].sort();

/** Pure, deterministic rule set. Input is internal evidence, NEVER browser-supplied assertions. */
export function evaluateReportReadiness(input: {
  workspaceId: string; clientId: string; window: ReportingWindow; now: Date;
  requiredProviders: string[]; requiredProvidersBasis: "assigned_sources" | "explicit";
  sources: SourceEvidence[]; destination: ReportReadinessEvaluation["destination"]; limited?: boolean;
}): ReportReadinessEvaluation {
  const dates = reportingDates(input.window);
  const staleBefore = new Date(input.now.getTime() - SOURCE_HEALTH_STALE_AFTER_MS);
  const providers: ProviderReadiness[] = input.sources.map(source => {
    const blockers: ReadinessIssue[] = [], warnings: ReadinessIssue[] = [];
    const add = (code: ReadinessCode, uncertain = false) => {
      const list = uncertain ? warnings : blockers;
      if (!list.some(i => i.code === code)) list.push({ code, connectionId: source.connectionId, provider: source.provider });
    };
    const health = resolveSourceHealthState({ connectionStatus: source.connectionStatus, lastError: source.lastError, lastSyncAt: source.lastSyncAt, staleBefore });
    if (health === "disconnected") add("SOURCE_DISCONNECTED");
    if (health === "partial") add("SYNC_PARTIAL");
    if (health === "error") add("SYNC_FAILED");
    if (health === "pending" || health === "unknown") add("SOURCE_UNVERIFIED", true);
    const accountIds = unique([...source.accounts.map(a => a.accountId), ...source.days.map(d => d.accountId)]);
    for (const account of source.accounts) {
      if (account.status === "reconnect_required") add("SOURCE_RECONNECT_REQUIRED");
      else if (account.status === "quarantined") add("SOURCE_QUARANTINED");
      else if (account.status === "degraded") add("SYNC_PARTIAL");
      else if (account.status !== "healthy") add("SOURCE_UNVERIFIED", true);
    }
    // Latest outcome PER target. A successful sibling/top-level job cannot clear another account or endpoint.
    const byTarget = new Map<string, SyncEvidence>();
    const outcomePriority = { failed: 0, partial: 1, unknown: 2, pending: 3, success: 4 };
    for (const sync of [...source.syncs].sort((a,b) => b.at.localeCompare(a.at) || outcomePriority[a.status] - outcomePriority[b.status] || a.id.localeCompare(b.id))) {
      const key = `${sync.kind}:${sync.target}`;
      if (!byTarget.has(key)) byTarget.set(key, sync);
    }
    const syncs = [...byTarget.values()];
    for (const sync of syncs) {
      if (sync.status === "partial") add("SYNC_PARTIAL");
      if (sync.status === "failed") add("SYNC_FAILED");
      if (sync.status === "unknown") add("SOURCE_UNVERIFIED", true);
      if (sync.status === "pending") add("SYNC_IN_PROGRESS", true);
    }
    // lastSyncAt may represent a partial run; do not describe it as full-source success then.
    const latestSuccessfulSyncAt = latest([
      ...(health === "fresh" || health === "stale" ? [source.lastSyncAt] : []),
      ...source.accounts.map(a => a.lastSuccessAt),
      ...source.syncs.filter(s => s.status === "success").map(s => s.at),
    ]);
    const freshness = !latestSuccessfulSyncAt ? "unknown" : Date.parse(latestSuccessfulSyncAt) < staleBefore.getTime() ? "stale" : "fresh";
    // Fresh sibling success never masks a stale connection/account.
    if (health === "stale" || freshness === "stale" || source.accounts.some(a => a.lastSuccessAt && Date.parse(a.lastSuccessAt) < staleBefore.getTime())) add("DATA_STALE");
    if (!latestSuccessfulSyncAt) add("SOURCE_UNVERIFIED", true);
    const accounts = accountIds.map(accountId => {
      const present = new Set(source.days.filter(d => d.accountId === accountId && d.rows > 0).map(d => d.date));
      const missingDates = dates.filter(d => !present.has(d));
      return { accountId, health: source.accounts.find(a => a.accountId === accountId)?.status ?? "untracked", presentDays: dates.length - missingDates.length, missingDates };
    });
    // A bounded scan cannot prove that an omitted date is absent from the database.
    if (!input.limited && (!accounts.length || accounts.some(a => a.missingDates.length))) add("REPORTING_WINDOW_INCOMPLETE");
    const currencies = unique(source.days.map(d => d.currency?.trim().toUpperCase() ?? "").filter(c => /^[A-Z]{3}$/.test(c)));
    if (!currencies.length || source.days.some(d => !/^[A-Z]{3}$/.test(d.currency?.trim().toUpperCase() ?? ""))) add("CURRENCY_UNKNOWN", true);
    // Account evidence is mandatory. A legacy source-level timezone is not proof.
    const contexts = accountIds.map(accountId => {
      const context = effectiveReportingContext(source.contexts?.find(c => c.accountId === accountId));
      if (!context.timezone) add("TIMEZONE_UNKNOWN", true);
      if (!context.currency) add("CURRENCY_UNKNOWN", true);
      if (context.timezoneConflict) add("TIMEZONE_CONFLICT");
      if (context.currencyConflict || (context.currency && source.days.some(d => d.accountId === accountId && d.currency && d.currency.toUpperCase() !== context.currency))) add("CURRENCY_CONFLICT");
      return context;
    });
    const timezones = unique(contexts.flatMap(c => c.timezone ? [c.timezone] : []));
    if (!accountIds.length) add("TIMEZONE_UNKNOWN", true);
    if (timezones.length > 1) add("TIMEZONE_CONFLICT");
    return {
      connectionId: source.connectionId, provider: source.provider, status: decision(blockers,warnings), health,
      latestSuccessfulSyncAt, latestDataDate: source.latestDataDate, freshness, currencies, timezone: timezones.length === 1 ? timezones[0] : null,
      blockers, warnings, evidence: { rowCount: source.days.reduce((n,d) => n + d.rows, 0), expectedDays: dates.length, accounts, syncs },
    };
  });
  const blockers = providers.flatMap(p => p.blockers), warnings = providers.flatMap(p => p.warnings);
  const requiredProviders = unique(input.requiredProviders);
  if (!requiredProviders.length && !input.limited) blockers.push({ code: "SOURCE_MISSING" });
  for (const provider of requiredProviders) {
    if (!input.limited && !providers.some(p => p.provider === provider)) blockers.push({ code: "SOURCE_MISSING", provider });
  }
  if (input.requiredProvidersBasis === "assigned_sources") warnings.push({ code: "REQUIRED_PROVIDERS_INFERRED" });
  if (input.destination.state === "unavailable") blockers.push({ code: "DESTINATION_UNAVAILABLE" });
  else if (input.destination.state === "stale") blockers.push({ code: "DESTINATION_STALE" });
  else if (input.destination.state !== "verified") warnings.push({ code: "DESTINATION_UNVERIFIED" });
  if (!input.destination.required?.length) warnings.push({ code: "DESTINATION_REQUIREMENTS_MISSING" });
  if (input.limited) warnings.push({ code: "EVIDENCE_LIMIT_REACHED" });
  const currencies = unique(providers.flatMap(p => p.currencies));
  if (currencies.length > 1) warnings.push({ code: "MIXED_CURRENCY" });
  if (unique(providers.flatMap(p => p.timezone ? [p.timezone] : [])).length > 1) blockers.push({ code: "TIMEZONE_CONFLICT" });
  return {
    workspaceId: input.workspaceId, clientId: input.clientId, window: input.window, evaluatedAt: input.now.toISOString(),
    status: decision(blockers,warnings), requiredProviders, requiredProvidersBasis: input.requiredProvidersBasis,
    providers, latestSuccessfulSyncAt: latest(providers.map(p => p.latestSuccessfulSyncAt)),
    latestDataDate: latest(providers.map(p => p.latestDataDate)),
    freshness: !providers.length || providers.some(p => p.freshness === "unknown") ? "unknown" : providers.some(p => p.freshness === "stale") ? "stale" : "fresh",
    destination: input.destination, currencies, timezones: unique(providers.flatMap(p => p.timezone ? [p.timezone] : [])),
    blockers, warnings, evidence: { derived: true, limited: Boolean(input.limited), timezonePersisted: providers.length > 0 && providers.every(p => Boolean(p.timezone)) },
  };
}
