import prisma from "@/lib/prisma";
import { RbacError } from "@/lib/rbac";
import { evaluateReportReadiness, type ReportingWindow, type SyncEvidence } from "./report-readiness";
import { parseReadinessRequest } from "./report-readiness-request";
import { reportingDataset } from "./report-delivery";

const CAP = 5_000;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const iso = (value: Date | null) => value?.toISOString() ?? null;
function outcome(value: unknown): SyncEvidence["status"] {
  if (["success", "completed", "done"].includes(String(value))) return "success";
  if (["failed", "error"].includes(String(value))) return "failed";
  if (value === "partial") return "partial";
  if (["queued", "running", "pending"].includes(String(value))) return "pending";
  return "unknown";
}

/** Read-only, bounded, consistent snapshot. Caller must authorize workspace membership first. */
export async function loadReportReadiness(workspaceId: string, window: ReportingWindow, options: { clientId?: string; after?: string; limit?: number } = {}) {
  if (!parseReadinessRequest({ workspaceId, start: window.start, end: window.end, ...options })) {
    throw new RbacError("Invalid readiness request", "INVALID_REQUEST", 400);
  }
  return prisma.$transaction(async tx => {
    const limit = options.clientId ? 1 : Math.min(options.limit ?? 50, 50);
    const clients = await tx.client.findMany({
      where: { workspaceId, ...(options.clientId ? { id: options.clientId } : options.after ? { id: { gt: options.after } } : {}) },
      select: { id: true, name: true, requiredProviders: true, requiredDestinations: true, requirementsConfiguredAt: true }, orderBy: { id: "asc" }, take: limit + 1,
    });
    if (options.clientId && !clients.length) throw new RbacError("Client not found", "NOT_FOUND", 404);
    const selected = clients.slice(0, limit);
    if (!selected.length) return { evaluations: [], nextCursor: null };
    const clientIds = selected.map(c => c.id);
    const sources = await tx.connection.findMany({
      where: { workspaceId, clientId: { in: clientIds }, type: "source" }, take: CAP + 1, orderBy: { id: "asc" },
      select: { id: true, clientId: true, provider: true, status: true, lastError: true, lastSyncAt: true },
    });
    const ids = sources.slice(0, CAP).map(c => c.id);
    // Redundant relational workspace filters reject even corrupt cross-workspace FK assignments.
    const metricWhere = { workspaceId, connectionId: { in: ids }, connection: { workspaceId, clientId: { in: clientIds } } };
    const [days, dataDates, accounts, runs, jobs, destinations, pipelines] = await Promise.all([
      tx.campaignMetric.groupBy({
        by: ["connectionId", "accountId", "date", "currency"],
        where: { ...metricWhere, date: { gte: new Date(`${window.start}T00:00:00Z`), lte: new Date(`${window.end}T23:59:59.999Z`) } },
        _count: { _all: true }, orderBy: [{ connectionId: "asc" }, { accountId: "asc" }, { date: "asc" }, { currency: "asc" }], take: CAP + 1,
      }),
      tx.campaignMetric.groupBy({ by: ["connectionId"], where: metricWhere, _max: { date: true } }),
      tx.providerAccountHealth.findMany({
        where: { workspaceId, connectionId: { in: ids }, connection: { workspaceId } }, take: CAP + 1, orderBy: { id: "asc" },
        select: { connectionId: true, accountId: true, status: true, lastSuccessAt: true },
      }),
      tx.providerSyncRun.findMany({
        where: { workspaceId, connectionId: { in: ids }, connection: { workspaceId } },
        take: CAP + 1, orderBy: [{ startedAt: "desc" }, { id: "asc" }],
        select: { id: true, connectionId: true, endpoint: true, status: true, startedAt: true, completedAt: true },
      }),
      // Outcomes are read only internally; DTOs never include result/error/provider payloads.
      tx.warehouseImportJob.findMany({
        where: { workspaceId, since: { lte: window.end }, until: { gte: window.start } },
        take: CAP + 1, orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, status: true, items: true, results: true, createdAt: true, finishedAt: true, since: true, until: true },
      }),
      tx.connection.findMany({
        where: { workspaceId, clientId: { in: clientIds }, type: "destination" }, take: CAP + 1, orderBy: { id: "asc" },
        select: { id: true, clientId: true, status: true },
      }),
      tx.pipeline.findMany({
        where: { workspaceId, clientId: { in: clientIds }, sourceConnection: { workspaceId }, destinationConnection: { workspaceId } },
        take: CAP + 1, orderBy: { id: "asc" }, select: {
          clientId: true, status: true, healthStatus: true, sourceConnectionId: true,
          destinationConnection: { select: { id: true, status: true } },
        },
      }),
    ]);
    const limited = [sources, days, accounts, runs, jobs, destinations, pipelines].some(rows => rows.length > CAP);
    const now = new Date();
    const syncByConnection = new Map<string, SyncEvidence[]>();
    const idSet = new Set(ids);
    const add = (id: string, sync: SyncEvidence) => {
      if (idSet.has(id)) syncByConnection.set(id, [...(syncByConnection.get(id) ?? []), sync]);
    };
    for (const run of runs.slice(0, CAP)) {
      // Endpoint path is internal identity, not a free-text message or request URL.
      const target = /^[\w/.-]{1,160}$/.test(run.endpoint) ? run.endpoint : "unrecognized_endpoint";
      add(run.connectionId, { id: run.id, kind: "endpoint", target, status: outcome(run.status), at: (run.completedAt ?? run.startedAt).toISOString() });
    }
    for (const job of jobs.slice(0, CAP)) {
      const results = array(job.results).map(record).filter(r => r !== null);
      // Include every child, even if the enclosing job says completed.
      const entries = [...array(job.items).map(record).filter(r => r !== null), ...results];
      const seen = new Set<string>();
      for (const item of entries) {
        if (typeof item.connectionId !== "string" || !idSet.has(item.connectionId)) continue;
        const account = typeof item.accountId === "string" ? item.accountId : typeof item.adAccountId === "string" ? item.adAccountId : "all";
        const key = `${item.connectionId}:${account}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const matches = results.filter(r => r.connectionId === item.connectionId && (r.accountId ?? r.adAccountId ?? "all") === account);
        const statuses = matches.map(r => r.outcome === "partial" ? "partial" : r.ok === false ? "failed" : outcome(r.outcome ?? (r.ok === true ? "success" : "unknown")));
        let status: SyncEvidence["status"] = statuses.includes("failed") ? "failed" : statuses.includes("partial") ? "partial" : statuses.includes("unknown") ? "unknown" : statuses.length ? "success" : outcome(job.status) === "success" ? "unknown" : outcome(job.status);
        // A narrow successful retry cannot erase a failure for the rest of the requested window.
        if (status === "success" && (job.since > window.start || job.until < window.end)) continue;
        if (status === "success" && !job.finishedAt) status = "pending";
        add(item.connectionId, { id: job.id, kind: "import", target: account, status, at: (job.finishedAt ?? job.createdAt).toISOString() });
      }
    }
    const evaluations = await Promise.all(selected.map(async client => {
      const assigned = sources.slice(0, CAP).filter(s => s.clientId === client.id);
      const [snapshot, contexts, latestReceipts] = await Promise.all([
        reportingDataset(tx, workspaceId, client.id, window),
        tx.accountReportingContext.findMany({ where: { workspaceId, connectionId: { in: assigned.map(s => s.id) }, connection: { workspaceId, clientId: client.id } }, take: CAP + 1, orderBy: { id: "asc" } }),
        Promise.all(client.requiredDestinations.map(destination => tx.destinationDeliveryReceipt.findFirst({ where: { workspaceId, clientId: client.id, destination, windowStart: window.start, windowEnd: window.end }, orderBy: [{ retrievedAt: "desc" }, { id: "desc" }] }))),
      ]);
      const receipts = latestReceipts.flatMap(r => r ? [{ id: r.id, destination: r.destination, retrievedAt: r.retrievedAt.toISOString(), dataThroughDate: r.dataThroughDate, current: !snapshot.limited && r.datasetFingerprint === snapshot.fingerprint && r.retrievedAt.getTime() >= snapshot.evidenceAt }] : []);
      const verified = client.requiredDestinations.length > 0 && client.requiredDestinations.every(d => receipts.some(r => r.destination === d && r.current));
      const clientDestinations = [
        ...destinations.filter(d => d.clientId === client.id),
        ...pipelines.filter(p => p.clientId === client.id).map(p => p.destinationConnection),
      ];
      const unavailable = clientDestinations.some(d => ["disconnected", "error"].includes(d.status))
        || pipelines.some(p => p.clientId === client.id && (p.healthStatus === "error" || p.status !== "active"));
      return evaluateReportReadiness({
        workspaceId, clientId: client.id, window, now, limited: limited || snapshot.limited || contexts.length > CAP,
        requiredProviders: client.requirementsConfiguredAt ? client.requiredProviders : assigned.map(s => s.provider), requiredProvidersBasis: client.requirementsConfiguredAt ? "explicit" : "assigned_sources",
        destination: { state: unavailable ? "unavailable" : verified ? "verified" : receipts.some(r => !r.current) ? "stale" : "unverified", configuredCount: new Set(clientDestinations.map(d => d.id)).size, required: client.requiredDestinations, receipts },
        sources: assigned.map(s => ({
          connectionId: s.id, provider: s.provider, connectionStatus: s.status, lastError: s.lastError,
          lastSyncAt: iso(s.lastSyncAt), latestDataDate: dataDates.find(d => d.connectionId === s.id)?._max.date?.toISOString().slice(0, 10) ?? null,
          accounts: accounts.filter(a => a.connectionId === s.id).map(a => ({ accountId: a.accountId, status: a.status, lastSuccessAt: iso(a.lastSuccessAt) })),
          days: days.slice(0, CAP).filter(d => d.connectionId === s.id).map(d => ({ accountId: d.accountId, date: d.date.toISOString().slice(0,10), currency: d.currency, rows: d._count._all })),
          syncs: syncByConnection.get(s.id) ?? [],
          // Neither UTC storage nor a UI locale proves the provider reporting timezone.
          timezone: null,
          contexts: contexts.filter(c => c.connectionId === s.id).map(c => ({ accountId: c.accountId, providerTimezone: c.providerTimezone, providerCurrency: c.providerCurrency, providerObservedAt: iso(c.providerObservedAt), overrideTimezone: c.overrideTimezone, overrideCurrency: c.overrideCurrency, overrideAt: iso(c.overrideAt) })),
        })),
      });
    }));
    return { evaluations, nextCursor: clients.length > limit ? selected.at(-1)!.id : null };
  }, { isolationLevel: "RepeatableRead", timeout: 15_000 });
}
