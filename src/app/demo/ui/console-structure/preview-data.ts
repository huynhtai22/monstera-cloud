import { previewOverview, type PreviewState } from "../console/fixtures";
import { buildPerformanceReport } from "@/lib/performance-reports";
import type { OperationsSummary } from "@/lib/operations-summary";

export const SAMPLE_WORKSPACE_ID = "local-preview";
export const sampleSession = { user: { id: "production-console-preview", name: "Alex Morgan", email: "preview@example.test", isAdmin: false }, expires: "2099-01-01T00:00:00.000Z" };
const sampleTime = "2026-10-02T02:41:00Z";
const clients = [{ id: "north", name: "North Supply" }, { id: "forma", name: "Forma Studio" }, { id: "goodkind", name: "Goodkind" }];
const sampleRows = [
  { id: "sample-1", platform: "meta_ads", accountId: "meta-north", accountName: "North Supply VN", connectionId: "preview-meta", campaignId: "campaign-1", campaignName: "Autumn essentials", clientId: "north", date: "2026-10-01", spend: 1250000, revenue: 4200000, conversions: 18, impressions: 45000, clicks: 840, currency: "VND" },
  { id: "sample-2", platform: "google_ads", accountId: "google-forma", accountName: "Forma Search", connectionId: "preview-google", campaignId: "campaign-2", campaignName: "Brand search", clientId: "forma", date: "2026-10-01", spend: 740000, revenue: 2850000, conversions: 12, impressions: 24000, clicks: 620, currency: "VND" },
  { id: "sample-3", platform: "tiktok_business", accountId: "tiktok-north", accountName: "North Supply TikTok", connectionId: "preview-tiktok", campaignId: "campaign-3", campaignName: "New collection", clientId: "north", date: "2026-10-01", spend: 980000, revenue: 3100000, conversions: 14, impressions: 72000, clicks: 710, currency: "VND" },
].map(row => ({ ...row, adsetId: "sample-adset", adsetName: "Sample audience", adId: "sample-ad", adName: "Sample creative", reach: Math.round(row.impressions * .8), cpc: row.spend / row.clicks, ctr: row.clicks / row.impressions * 100, roas: row.revenue / row.spend, pulledAt: sampleTime }));

export function productionOverview(state: PreviewState) {
  const overview = previewOverview(state);
  overview.workspace.name = "Studio North";
  if (state === "New workspace") return overview;
  overview.summaryCards.warehouse.dataThroughDate = "2026-10-01";
  overview.summaryCards.warehouse.asOf = sampleTime;
  overview.summaryCards.syncs.lastSyncTimeAgo = null;
  overview.warehouseSnapshot.dataThroughDate = "2026-10-01";
  overview.warehouseSnapshot.lastRefreshAt = sampleTime;
  overview.pilotActivation.dataThroughDate = "2026-10-01";
  overview.sourcesList = overview.sourcesList.map(source => ({ ...source, lastSyncAt: state === "Disconnected" || state === "Sync stuck" ? source.lastSyncAt : sampleTime }));
  return overview;
}

export function sampleApiPayload(url: URL, state: PreviewState): unknown {
  const overview = productionOverview(state);
  const empty = state === "New workspace";
  const attention = ["Disconnected", "Needs attention", "Sync stuck"].includes(state);
  const monitoringDraft = state === "Monitoring draft";
  const monitoringSetup = state === "Monitoring setup" || monitoringDraft;
  const monitoringActive = state === "Monitoring active";
  const q = url.searchParams;
  const clientId = q.get("clientId");
  const sourceList = empty ? [] : overview.sourcesList;
  const connections = sourceList.map((source, index) => ({ id: source.id, workspaceId: SAMPLE_WORKSPACE_ID, type: "source", name: source.name, provider: source.provider, status: source.state === "disconnected" ? "disconnected" : "connected", healthState: source.state, lastError: source.lastError, lastSyncAt: source.lastSyncAt, lastDataThrough: "2026-10-01", createdAt: "2026-09-01T02:00:00Z", updatedAt: sampleTime, clientId: index === 1 ? "forma" : index === 3 ? "goodkind" : "north", accountCount: source.accountCount, credentials: JSON.stringify({ adAccounts: Array.from({ length: source.accountCount }, (_, i) => ({ id: `${source.id}-account-${i}`, name: `${source.name} ${i + 1}` })), selectedAccountIds: [`${source.id}-account-0`], selectedCustomerIds: [`${source.id}-account-0`], accounts: [{ id: `${source.id}-account-0`, name: source.name }], shop_id: source.provider === "shopee" ? "sample-shop" : undefined, managerId: source.provider === "google_ads" ? "1234567890" : undefined }) }));
  const scopedConnections = connections.filter(connection => !clientId || clientId === "all" || clientId === connection.clientId);
  const workspace = { ...overview.workspace, role: "owner", createdAt: "2026-09-01T00:00:00Z", timezone: "Asia/Ho_Chi_Minh", enabledProviders: connections.map(c => c.provider), entitlements: { allowLooker: true }, _count: { connections: connections.length, pipelines: 0, clients: empty ? 0 : 3, members: 2 }, counts: { members: 2, clients: empty ? 0 : 3, connections: connections.length, sourceConnections: connections.length, pipelines: 0, apiKeys: 1 }, sources: connections, health: { status: attention ? "error" : "healthy", latestSyncAt: sampleTime, latestJobStatus: "completed", latestJobFinishedAt: sampleTime, failingConnections: attention ? 1 : 0, failingDetails: [] } };
  const clientRows = empty ? [] : clients.map(client => ({ ...client, workspaceId: SAMPLE_WORKSPACE_ID, createdAt: sampleTime, updatedAt: sampleTime, description: "Sample client · production directory", connections: connections.filter(connection => connection.clientId === client.id), _count: { connections: connections.filter(connection => connection.clientId === client.id).length, accountAssignments: 1, pipelines: 0 }, accountAssignments: [], reportSchedules: [] }));
  const metrics = empty ? [] : sampleRows.filter(row => (!clientId || clientId === "all" || row.clientId === clientId) && (!q.get("platform") || row.platform === q.get("platform")) && (!q.get("accountId") || row.accountId === q.get("accountId")) && (!q.get("accountIds") || q.get("accountIds")!.split(",").includes(row.accountId)) && (!q.get("startDate") || row.date >= q.get("startDate")!) && (!q.get("endDate") || row.date <= q.get("endDate")!));
  const window = { start: q.get("startDate") ?? q.get("start") ?? "2026-09-25", end: q.get("endDate") ?? q.get("end") ?? "2026-10-01" };
  const evaluation = (id: string) => ({ workspaceId: SAMPLE_WORKSPACE_ID, clientId: id, window, evaluatedAt: sampleTime, status: "WARNING", dataStatus: empty ? "UNKNOWN" : attention ? "NOT_READY" : "READY", dataBlockers: empty ? [{ code: "SOURCE_MISSING" }] : attention ? [{ code: "SOURCE_RECONNECT_REQUIRED", connectionId: "preview-google", provider: "google_ads" }] : [], dataWarnings: [], requiredProviders: ["meta_ads"], requiredProvidersBasis: "explicit", providers: [], latestSuccessfulSyncAt: empty ? null : sampleTime, latestDataDate: empty ? null : "2026-10-01", freshness: empty ? "unknown" : "fresh", destination: { state: "unverified", configuredCount: 0, required: ["sheets"], receipts: [], connections: [], pipelines: [] }, currencies: empty ? [] : ["VND"], timezones: ["Asia/Ho_Chi_Minh"], blockers: [], warnings: [{ code: "DESTINATION_UNVERIFIED" }], evidence: { derived: true, limited: false, timezonePersisted: true }, dependencyEvidence: { contractVersion: "report-readiness-evidence-v1", window, sources: [], requiredProviders: [], requiredProvidersBasis: "explicit", destination: {}, limited: false, outcome: { status: "WARNING", dataStatus: "READY", providerStates: [], blockers: [], warnings: [], currencies: ["VND"], timezones: ["Asia/Ho_Chi_Minh"] } } });
  const p = url.pathname;
  if (p === "/api/auth/session") return sampleSession;
  if (p === "/api/agent/onboarding-entry") return { workspaceId: SAMPLE_WORKSPACE_ID, sample: true };
  if (p === "/api/agent-console/summary") return {
    workspaceId: SAMPLE_WORKSPACE_ID,
    cadence: "daily",
    schedulerStatus: monitoringActive ? "active" : monitoringSetup ? "no_responsibility" : "unavailable",
    monitoringAvailable: monitoringSetup || monitoringActive,
    supportedCadenceLabel: monitoringSetup ? "Daily checks are available for explicit approval in this sample" : "Daily checks are not enabled in this sample workspace",
    nextScheduledCheck: monitoringActive ? "2026-10-03T02:41:00.000Z" : null,
    lastSuccessfulCheck: monitoringActive ? "2026-10-02T02:41:00.000Z" : null,
    lastAttemptedCheck: monitoringActive ? "2026-10-02T02:41:00.000Z" : null,
    dataThroughCoverage: monitoringActive ? "2026-10-01" : null,
    activeBlockers: monitoringActive ? ["IMPORT_COVERAGE_INCOMPLETE: One selected account needs a bounded retry"] : monitoringSetup ? [] : ["WORKER_UNAVAILABLE: Monitoring is not enabled in this preview"],
    responsibilities: monitoringActive ? [{ id: "sample-health-responsibility", kind: "data_health", status: "active", cadence: "daily", version: 2, nextDueAt: "2026-10-03T02:41:00.000Z", lastSuccessfulAt: "2026-10-02T02:41:00.000Z", scopeCount: 3 }] : [],
    setupDrafts: monitoringDraft ? [{ id: "sample-saved-draft", version: 1, timezone: "Asia/Ho_Chi_Minh", updatedAt: sampleTime,
      scopes: [{ connectionId: "preview-meta", provider: "meta_ads", providerAccountId: "sample-account", accountName: "Sample provider account" }] }] : [],
    openCases: monitoringActive ? [{ id: "sample-health-case", title: "One Meta Ads import needs verification", description: "The latest check found an incomplete window for one selected account. Monstera has not marked that coverage complete.", state: "open", priority: "high", version: 1, requiredAction: "recovery_import", createdAt: "2026-10-02T02:41:00.000Z" }] : [],
  };
  if (p === "/api/runs") return { runs: [] };
  if (p === "/api/workspaces") return [workspace];
  if (p === "/api/clients") return clientRows;
  if (p === "/api/integrations/config") return { metaAds: true, googleAds: true, tiktokBusiness: true, shopee: true, lazada: true };
  if (p.endsWith("/connections")) return q.get("unassigned") ? [] : scopedConnections;
  if (p === "/api/pipelines" || p === "/api/report-schedules") return [];
  if (p === "/api/sync-logs") return { logs: empty ? [] : [{ id: "sample-sync", pipelineId: "sample-pipeline", status: "success", rowsSynced: 3, durationMs: 1240, createdAt: sampleTime, pipeline: { id: "sample-pipeline", name: "Sample warehouse import", source: { provider: "meta_ads", name: "Studio North · Meta" }, destination: { provider: "google_sheets", name: "Sample Sheets" } } }], pagination: { total: 1, hasMore: false } };
  if (p === "/api/metrics/platforms") return { platforms: [...new Set(metrics.map(row => row.platform))] };
  if (p === "/api/metrics/accounts") return { accounts: metrics.map(row => ({ accountId: row.accountId, accountName: row.accountName, platform: row.platform, currency: row.currency, rowCount: 1 })) };
  if (p === "/api/metrics/query") return { metrics, summary: { totalRecords: metrics.length, totalSpend: metrics.reduce((sum, row) => sum + row.spend, 0), platforms: [...new Set(metrics.map(row => row.platform))], dateRange: { earliest: metrics.length ? "2026-10-01" : null, latest: metrics.length ? "2026-10-01" : null } }, pagination: { nextCursor: null, hasMore: false, totalApprox: metrics.length }, freshness: { dataThroughDate: metrics.length ? "2026-10-01" : null, lastImportAt: sampleTime } };
  if (p === "/api/reports/performance") return { report: buildPerformanceReport(metrics), client: clients.find(c => c.id === clientId), latestDataDate: empty ? null : "2026-10-01", dateRange: { startDate: window.start, endDate: window.end }, anomalies: [] };
  if (p === "/api/reports/readiness") return { evaluation: clientId && clientId !== "all" ? evaluation(clientId) : undefined, evaluations: clientRows.map(client => evaluation(client.id)), nextCursor: null };
  if (p.startsWith("/api/reports/readiness/")) return { evaluation: evaluation(p.split("/").at(-1)!) };
  if (p === "/api/anomalies") return { anomalies: [], summary: { total: 0, critical: 0, warning: 0 }, byClient: {} };
  if (p === "/api/data-explorer/shopee-catalog") return { campaigns: [], products: [], lastRun: null };
  if (p.endsWith("/client-accounts")) return { accounts: connections.map(connection => ({ provider: connection.provider, accountId: `${connection.id}-account-0`, accountName: connection.name, assignedClient: clients.find(c => c.id === connection.clientId), authoritativeConnectionId: connection.id, assignedAt: sampleTime, assignedBy: sampleSession.user.id, isAssigned: true, hasMultipleRootConnections: false, availableConnections: [{ id: connection.id, name: connection.name, provider: connection.provider, status: connection.status, isAuthoritative: true }] })), total: connections.length, unassignedCount: 0 };
  if (p.includes("/discovered-accounts") || p.endsWith("/accounts")) return { accounts: empty ? [] : [{ id: "sample-account", name: "Sample provider account" }], inventory: { status: "complete" } };
  if (p.startsWith("/api/connections/")) { const connection = connections.find(c => c.id === p.split("/")[3]); return { connection: connection ? { ...connection, workspace: { name: "Studio North" } } : null, pipelines: [], recentLogs: [] }; }
  if (p === "/api/settings/api-keys") return [{ id: "sample-key", name: "Sample destination key", keyMasked: "mc_preview••••sample", createdAt: sampleTime, lastUsedAt: null, isActive: true }];
  if (p === "/api/settings/data-quality") return { rules: [], violations: [], telegramChatId: "" };
  if (p.endsWith("/billing")) return { plan: "professional", status: "ACTIVE", subscriptionEndsAt: null, subscriptionProvider: null, usage: { connectionsCount: connections.length, membersCount: 2, pipelinesCount: 0 }, orders: [] };
  if (p.endsWith("/members")) return { members: [{ id: "sample-owner", role: "owner", user: sampleSession.user, userId: sampleSession.user.id, createdAt: sampleTime }] };
  if (p.endsWith("/invitations")) return [];
  if (p === "/api/auth/sessions") return { sessions: [{ jti: "sample-session", current: true, createdAt: sampleTime, lastSeenAt: sampleTime, deviceLabel: "Preview browser", revokedAt: null, revokedReason: null, graceEndsAt: null, seenIp: true }] };
  if (p === "/api/auth/login-events") return { events: [] };
  if (p === "/api/geo") return { country: "VN", isVietnam: true, currency: "VND" };
  if (p === "/api/operations/summary") {
    const section = <T,>(data: T, href: string, needsAttention = false) => ({ state: empty ? "empty" as const : needsAttention ? "attention" as const : "ready" as const, data, truncated: false, limit: 25, reason: null, href });
    return { version: "operations-summary-v1", workspaceId: SAMPLE_WORKSPACE_ID, generatedAt: sampleTime, clientContext: { status: clientId && clientId !== "all" ? "resolved" : "all", client: clients.find(c => c.id === clientId) ?? null, scope: clientId && clientId !== "all" ? "explicit" : "workspace" }, navigation: { sources: "/sources", reports: "/reports", clients: "/clients", explorer: "/explorer", exports: "/exports", operations: "/operations" }, sections: {
      connectorHealth: section({ quarantineThreshold: 3, totals: { total: connections.length, healthy: connections.length - (attention ? 1 : 0), degraded: 0, quarantined: 0, reconnectRequired: attention ? 1 : 0, unknown: 0 }, attention: attention ? [{ connectionId: "preview-google", provider: "google_ads", accountId: "google-forma", accountName: "Forma Search", status: "reconnect_required", errorCategory: "auth", consecutiveFailures: 1, lastSuccessAt: sampleTime, lastErrorSummary: "Sample authorization expired" }] : [] }, "/sources", attention),
      freshness: section({ sourceFreshnessHours: 24, escalationHours: 26, totals: { fresh: connections.length - (attention ? 1 : 0), stale: 0, error: attention ? 1 : 0, pending: 0, disconnected: 0, syncing: 0, partial: 0, unknown: 0, stuck: 0 }, attention: attention ? [{ connectionId: "preview-google", provider: "google_ads", name: "Google Ads portfolio", state: "error", lastSyncAt: sampleTime, lastDataThrough: "2026-10-01" }] : [] }, "/sources", attention),
      ingestion: section({ windowDays: 7, totals: { total: empty ? 0 : 1, queued: 0, running: 0, completed: empty ? 0 : 1, partial: 0, failed: 0 }, recentFailures: [], syncLogErrors: [], syncLogErrorTotal: 0 }, "/explorer"),
      readiness: section({ window, evaluatedClients: clientRows.length, totals: { ready: 0, notReady: attention ? 1 : 0, warning: clientRows.length, unknown: 0 }, clients: clientRows.map(c => ({ clientId: c.id, clientName: c.name, status: "WARNING", blockers: [], warnings: ["DESTINATION_UNVERIFIED"] })) }, "/reports", true),
      delivery: section({ recencyHours: 168, totals: { receipts: 0, stale: 0, clients: 0 }, latest: [] }, "/exports"),
      anomalies: section({ windowDays: 14, totals: { total: 0, critical: 0, warning: 0 }, items: [] }, "/reports"),
    } } satisfies OperationsSummary;
  }
  return null;
}
