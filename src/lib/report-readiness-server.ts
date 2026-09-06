import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { ScopedTransaction } from "./warehouse-query";
import { RbacError } from "@/lib/rbac";
import { evaluateReportReadiness, type ReportingWindow, type SyncEvidence } from "./report-readiness";
import { parseReadinessRequest } from "./report-readiness-request";
import { reportingDataset } from "./report-delivery";

const CAP = 5_000;
const readinessHooks: {
  afterClients?: () => Promise<void>;
  afterSources?: () => Promise<void>;
  afterMetricDays?: () => Promise<void>;
  beforeEvaluate?: () => Promise<void>;
} = {};

/** @internal TEST-ONLY transaction interleaving seams. */
export function _setReadinessTestHooks(hooks: typeof readinessHooks): void {
  readinessHooks.afterClients = hooks.afterClients;
  readinessHooks.afterSources = hooks.afterSources;
  readinessHooks.afterMetricDays = hooks.afterMetricDays;
  readinessHooks.beforeEvaluate = hooks.beforeEvaluate;
}
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

export type LoadReportReadinessOptions = { clientId?: string; after?: string; limit?: number; tx?: ScopedTransaction };

/**
 * Read-only, bounded, consistent readiness snapshot. Caller must authorize
 * workspace membership first. Runs in its own RepeatableRead transaction, or
 * inside a caller-provided transaction client so consumers (e.g. the verified
 * report blueprint) can evaluate readiness in the SAME database snapshot as
 * their own metric rows, dataset fingerprints and delivery receipts.
 */
export async function loadReportReadiness(workspaceId: string, window: ReportingWindow, options: LoadReportReadinessOptions = {}) {
  const { tx: _tx, ...validationOptions } = options;
  void _tx;
  if (!parseReadinessRequest({ workspaceId, start: window.start, end: window.end, ...validationOptions })) {
    throw new RbacError("Invalid readiness request", "INVALID_REQUEST", 400);
  }
  const run = (tx: ScopedTransaction) => loadReportReadinessInTransaction(tx, workspaceId, window, options);
  if (options.tx) return run(options.tx);
  return prisma.$transaction(run, { isolationLevel: "RepeatableRead", timeout: 15_000 });
}

async function loadReportReadinessInTransaction(tx: ScopedTransaction, workspaceId: string, window: ReportingWindow, options: { clientId?: string; after?: string; limit?: number }) {
    const limit = options.clientId ? 1 : Math.min(options.limit ?? 50, 50);
    const clients = await tx.client.findMany({
      where: { workspaceId, ...(options.clientId ? { id: options.clientId } : options.after ? { id: { gt: options.after } } : {}) },
      select: { id: true, name: true, requiredProviders: true, requiredDestinations: true, requirementsConfiguredAt: true }, orderBy: { id: "asc" }, take: limit + 1,
    });
    await readinessHooks.afterClients?.();
    if (options.clientId && !clients.length) throw new RbacError("Client not found", "NOT_FOUND", 404);
    const selected = clients.slice(0, limit);
    if (!selected.length) return { evaluations: [], nextCursor: null };
    const clientIds = selected.map(c => c.id);

    const activeAssignments = await tx.clientProviderAccountAssignment.findMany({
      where: { workspaceId, clientId: { in: clientIds }, status: "active" },
      select: { clientId: true, connectionId: true, provider: true, accountId: true },
    });

    const assignedConnIdsByClient = new Map<string, Set<string>>();
    for (const a of activeAssignments) {
      if (!assignedConnIdsByClient.has(a.clientId)) assignedConnIdsByClient.set(a.clientId, new Set());
      assignedConnIdsByClient.get(a.clientId)!.add(a.connectionId);
    }

    const sourceScopes = selected.flatMap<Prisma.ConnectionWhereInput>(client => {
      const assignedIds = Array.from(assignedConnIdsByClient.get(client.id) ?? []);
      if (assignedIds.length > 0) {
        return [{ id: { in: assignedIds }, ...(client.requirementsConfiguredAt ? { provider: { in: client.requiredProviders } } : {}) }];
      }
      return [client.requirementsConfiguredAt
        ? { clientId: client.id, provider: { in: client.requiredProviders } }
        : { clientId: client.id }];
    });
    const destinationScopes = selected.map(client => client.requirementsConfiguredAt
      ? { clientId: client.id, provider: { in: client.requiredDestinations } }
      : { clientId: client.id });
    const pipelineScopes = selected.map(client => client.requirementsConfiguredAt
      ? { clientId: client.id, destinationConnection: { provider: { in: client.requiredDestinations } } }
      : { clientId: client.id });
    const sources = await tx.connection.findMany({
      where: { workspaceId, type: "source", OR: sourceScopes }, take: CAP + 1, orderBy: { id: "asc" },
      select: { id: true, clientId: true, provider: true, status: true, lastError: true, lastSyncAt: true },
    });
    await readinessHooks.afterSources?.();
    const ids = sources.slice(0, CAP).map(c => c.id);
    // Redundant relational workspace filters reject even corrupt cross-workspace FK assignments.
    const clientMetricClauses: Prisma.CampaignMetricWhereInput[] = selected.map(client => {
      const clientAssignments = activeAssignments.filter(a => a.clientId === client.id);
      if (clientAssignments.length > 0) {
        return {
          workspaceId,
          connectionId: { in: ids },
          OR: clientAssignments.map(a => ({
            connectionId: a.connectionId,
            platform: a.provider,
            accountId: a.accountId,
          })),
        };
      }
      return {
        workspaceId,
        connectionId: { in: ids },
        connection: { workspaceId, clientId: client.id },
      };
    });
    const metricWhere: Prisma.CampaignMetricWhereInput = {
      workspaceId,
      connectionId: { in: ids },
      OR: clientMetricClauses,
    };
    const days = await tx.campaignMetric.groupBy({
        by: ["connectionId", "accountId", "date", "currency"],
        where: { ...metricWhere, date: { gte: new Date(`${window.start}T00:00:00Z`), lte: new Date(`${window.end}T23:59:59.999Z`) } },
        _count: { _all: true }, orderBy: [{ connectionId: "asc" }, { accountId: "asc" }, { date: "asc" }, { currency: "asc" }], take: CAP + 1,
      });
    await readinessHooks.afterMetricDays?.();
    const dataDates = await tx.campaignMetric.groupBy({ by: ["connectionId"], where: metricWhere, _max: { date: true } });
    const accounts = await tx.providerAccountHealth.findMany({
        where: { workspaceId, connectionId: { in: ids }, connection: { workspaceId } }, take: CAP + 1, orderBy: { id: "asc" },
        select: { connectionId: true, accountId: true, status: true, lastSuccessAt: true },
      });
    const runs = await tx.providerSyncRun.findMany({
        where: { workspaceId, connectionId: { in: ids }, connection: { workspaceId } },
        take: CAP + 1, orderBy: [{ startedAt: "desc" }, { id: "asc" }],
        select: { id: true, connectionId: true, endpoint: true, status: true, startedAt: true, completedAt: true },
      });
      // Outcomes are read only internally; DTOs never include result/error/provider payloads.
    // WarehouseImportJob has JSON children rather than a connection FK. Scope
    // it in PostgreSQL before applying CAP so another client's large job fleet
    // cannot hide, limit, or otherwise influence this client's sync evidence.
    const jobs = ids.length === 0 ? [] : await tx.$queryRaw<Array<{
      id: string; status: string; items: unknown; results: unknown; createdAt: Date;
      finishedAt: Date | null; since: string; until: string;
    }>>(Prisma.sql`
      SELECT "id", "status", "items", "results", "createdAt", "finishedAt", "since", "until"
      FROM "WarehouseImportJob"
      WHERE "workspaceId" = ${workspaceId}
        AND "since" <= ${window.end}
        AND "until" >= ${window.start}
        AND (
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof("items") = 'array' THEN "items" ELSE '[]'::jsonb END
            ) item WHERE item->>'connectionId' IN (${Prisma.join(ids)})
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof("results") = 'array' THEN "results" ELSE '[]'::jsonb END
            ) result WHERE result->>'connectionId' IN (${Prisma.join(ids)})
          )
        )
      ORDER BY "createdAt" DESC, "id" ASC
      LIMIT ${CAP + 1}
    `);
    const destinations = await tx.connection.findMany({
        where: { workspaceId, type: "destination", OR: destinationScopes }, take: CAP + 1, orderBy: { id: "asc" },
        select: { id: true, clientId: true, provider: true, status: true },
      });
    const pipelines = await tx.pipeline.findMany({
        where: { workspaceId, OR: pipelineScopes, sourceConnectionId: { in: ids }, sourceConnection: { workspaceId }, destinationConnection: { workspaceId } },
        take: CAP + 1, orderBy: { id: "asc" }, select: {
          clientId: true, status: true, healthStatus: true, sourceConnectionId: true,
          destinationConnection: { select: { id: true, provider: true, status: true } },
        },
      });
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
    await readinessHooks.beforeEvaluate?.();
    const evaluations = await Promise.all(selected.map(async client => {
      const clientConnIds = assignedConnIdsByClient.get(client.id);
      const assigned = sources.slice(0, CAP).filter(s => (clientConnIds && clientConnIds.has(s.id)) || s.clientId === client.id);
      const [snapshot, contexts, latestReceipts] = await Promise.all([
        reportingDataset(tx, workspaceId, client.id, window, client.requirementsConfiguredAt && client.requiredProviders.length > 0 ? client.requiredProviders : undefined),
        tx.accountReportingContext.findMany({ where: { workspaceId, connectionId: { in: assigned.map(s => s.id) }, connection: { workspaceId } }, take: CAP + 1, orderBy: { id: "asc" } }),
        Promise.all(client.requiredDestinations.map(destination => tx.destinationDeliveryReceipt.findFirst({ where: { workspaceId, clientId: client.id, destination, windowStart: window.start, windowEnd: window.end }, orderBy: [{ retrievedAt: "desc" }, { id: "desc" }] }))),
      ]);
      const receipts = latestReceipts.flatMap(r => r ? [{ id: r.id, destination: r.destination, retrievedAt: r.retrievedAt.toISOString(), dataThroughDate: r.dataThroughDate, current: !snapshot.limited && r.datasetFingerprint === snapshot.fingerprint && r.retrievedAt.getTime() >= snapshot.evidenceAt }] : []);
      const verified = client.requiredDestinations.length > 0 && client.requiredDestinations.every(d => receipts.some(r => r.destination === d && r.current));
      const clientDestinations = [
        ...destinations.filter(d => d.clientId === client.id),
        ...pipelines.filter(p => p.clientId === client.id).map(p => p.destinationConnection),
      ];
      const uniqueDestinations = [...new Map(clientDestinations.map(destination => [destination.id, destination])).values()];
      const unavailable = clientDestinations.some(d => ["disconnected", "error"].includes(d.status))
        || pipelines.some(p => p.clientId === client.id && (p.healthStatus === "error" || p.status !== "active"));
      return evaluateReportReadiness({
        workspaceId, clientId: client.id, window, now, limited: limited || snapshot.limited || contexts.length > CAP,
        requiredProviders: client.requirementsConfiguredAt ? client.requiredProviders : assigned.map(s => s.provider), requiredProvidersBasis: client.requirementsConfiguredAt ? "explicit" : "assigned_sources",
        requirementsConfiguredAt: iso(client.requirementsConfiguredAt),
        destination: {
          state: unavailable ? "unavailable" : verified ? "verified" : receipts.some(r => !r.current) ? "stale" : "unverified",
          configuredCount: uniqueDestinations.length,
          required: client.requiredDestinations,
          receipts,
          connections: uniqueDestinations.map(destination => ({ id: destination.id, provider: destination.provider, status: destination.status })),
          pipelines: pipelines.filter(p => p.clientId === client.id).map(p => ({
            sourceConnectionId: p.sourceConnectionId,
            destinationConnectionId: p.destinationConnection.id,
            status: p.status,
            healthStatus: p.healthStatus,
          })),
        },
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
}
