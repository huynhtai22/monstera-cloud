import type { ReadinessIssue, ReportingWindow } from "./report-readiness";
import type { SourceState } from "./source-list-display";
import { withClientContextAndParams } from "./client-context";

export function sourceRecoveryHref(connectionId: string, clientId?: string | null, window?: ReportingWindow): string {
  return withClientContextAndParams(`/sources/${encodeURIComponent(connectionId)}`, clientId, window ? { startDate: window.start, endDate: window.end } : undefined) + "#source-recovery";
}

export function reportRecoveryHref(clientId: string, window?: ReportingWindow): string {
  return withClientContextAndParams("/reports", clientId, {
    view: "performance",
    ...(window ? { startDate: window.start, endDate: window.end } : {}),
  }) + "#report-readiness";
}

export function validRecoveryWindow(start: string | null, end: string | null): ReportingWindow | undefined {
  const valid = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
  return valid(start) && valid(end) && start <= end ? { start, end } : undefined;
}

export type RecoveryAction = { label: string; href?: string; configure?: boolean; recheck?: boolean };
export function readinessRecovery(issue: ReadinessIssue, clientId: string, window: ReportingWindow): RecoveryAction {
  const source = issue.connectionId ? sourceRecoveryHref(issue.connectionId, clientId, window) : withClientContextAndParams("/sources", clientId, { tab: "accounts" });
  switch (issue.code) {
    case "SOURCE_MISSING": return { label: "Assign client sources", href: withClientContextAndParams("/sources", clientId, { tab: "accounts" }) };
    case "SOURCE_DISCONNECTED": case "SOURCE_RECONNECT_REQUIRED": return { label: "Review authorization", href: source };
    case "SOURCE_QUARANTINED": case "SYNC_FAILED": case "SYNC_PARTIAL": case "SOURCE_UNVERIFIED": return { label: "Review affected source", href: source };
    case "DATA_STALE": case "REPORTING_WINDOW_INCOMPLETE": return { label: "Import reporting window", href: withClientContextAndParams("/explorer", clientId, { startDate: window.start, endDate: window.end }) + "#warehouse-refresh" };
    case "CURRENCY_UNKNOWN": case "TIMEZONE_UNKNOWN": case "TIMEZONE_CONFLICT": case "CURRENCY_CONFLICT": case "REQUIRED_PROVIDERS_INFERRED": case "DESTINATION_REQUIREMENTS_MISSING": return { label: "Review reporting configuration", configure: true };
    case "DESTINATION_UNAVAILABLE": case "DESTINATION_UNVERIFIED": case "DESTINATION_STALE": return { label: "Review report readiness", href: reportRecoveryHref(clientId, window) };
    case "SYNC_IN_PROGRESS": return { label: "Recheck progress", recheck: true };
    case "EVIDENCE_LIMIT_REACHED": case "MIXED_CURRENCY": return { label: "Inspect this reporting window", href: withClientContextAndParams("/explorer", clientId, { startDate: window.start, endDate: window.end }) };
  }
}

/** Authorization and ingestion are separate signals. Never infer report readiness from either. */
export function sourceTrustFacts(state: SourceState, lastSync?: string | null, dataThrough?: string | null) {
  const knownSuccess = Boolean(lastSync && lastSync !== "Never" && Number.isFinite(Date.parse(lastSync)));
  return {
    authorization: state.needsReconnect ? "Action required" : state.kind === "attention" ? "Needs verification" : "Connected",
    latestSuccessfulImport: knownSuccess && lastSync ? new Date(lastSync).toISOString() : null,
    dataThrough: dataThrough && Number.isFinite(Date.parse(dataThrough)) ? new Date(dataThrough).toISOString().slice(0, 10) : null,
  };
}
