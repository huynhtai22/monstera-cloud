import { evaluateReportReadiness, reportingDates, type ReportingWindow, type SourceEvidence } from "@/lib/report-readiness";
export const readinessScenarios = ["gap", "fresh", "stale", "disconnected", "unknown", "empty", "mixed"] as const;
export type ReadinessScenario = typeof readinessScenarios[number];
export function sampleReadiness(clientId: string, window: ReportingWindow, scenario: ReadinessScenario, recovered: "none" | "complete" | "partial" = "none") {
  const now = new Date("2026-10-02T03:00:00Z");
  const dates = reportingDates(window);
  const accounts = clientId === "north" ? ["meta-north", "tiktok-north"] : [clientId === "forma" ? "google-forma" : "meta-goodkind"];
  const sources: SourceEvidence[] = accounts.map((accountId, index) => {
    const provider = accountId.startsWith("google") ? "google_ads" : accountId.startsWith("tiktok") ? "tiktok_business" : "meta_ads";
    const missing = index === accounts.length - 1 && (scenario === "gap" || recovered === "partial");
    const syncAt = scenario === "stale" && recovered === "none" ? "2026-09-28T03:00:00Z" : now.toISOString();
    const present = missing && recovered !== "complete" ? dates.slice(0, Math.max(0, dates.length - 2)) : dates;
    return { connectionId: `readiness-${accountId}`, provider, connectionStatus: scenario === "disconnected" ? "disconnected" : "connected", lastError: null, lastSyncAt: syncAt, latestDataDate: present.at(-1) ?? null, timezone: "Asia/Ho_Chi_Minh", accounts: [{ accountId, status: "healthy", lastSuccessAt: syncAt }], contexts: scenario === "unknown" ? [] : [{ accountId, providerTimezone: "Asia/Ho_Chi_Minh", providerCurrency: scenario === "mixed" && index > 0 ? "USD" : "VND", providerObservedAt: now.toISOString(), overrideTimezone: null, overrideCurrency: null, overrideAt: null }], days: present.map(date => ({ accountId, date, currency: scenario === "mixed" && index > 0 ? "USD" : "VND", rows: 12 })), syncs: [{ id: `sample-import-${accountId}`, kind: "import", target: accountId, at: syncAt, status: "success" }] };
  });
  return evaluateReportReadiness({ workspaceId: "local-preview", clientId, window, now, sources: scenario === "empty" ? [] : sources, requiredProviders: [...new Set(sources.map(source => source.provider))], requiredProvidersBasis: "explicit", destination: { state: "unverified", configuredCount: 1, required: ["google_sheets"], receipts: [] } });
}
