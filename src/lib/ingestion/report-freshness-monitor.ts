import prisma from "../prisma";
import { withSystemScope } from "../tenant-guard";
import { withDatabaseTenantContext } from "../database-tenant-context";
import { loadReportReadiness } from "../report-readiness-server";
import { defaultReportingWindow } from "../report-readiness";
import { buildFreshnessJourney, freshnessIncidentKey } from "../freshness-journey";
import { emitMonitor } from "../observability/monitors";

const BATCH_SIZE = 3;
const TICK_MS = 15 * 60 * 1000;
const ACTION = "report_freshness.changed";

export function freshnessMonitorPage(total: number, now: Date): number {
  return total > 0 ? (Math.floor(now.getTime() / TICK_MS) % Math.ceil(total / BATCH_SIZE)) * BATCH_SIZE : 0;
}

/** Internal-only journal, never an activation or verification authority. */
export async function recordFreshnessObservation(input: {
  workspaceId: string; clientId: string; observedAt: Date; status: string; incidentKey: string;
}): Promise<boolean> {
  // Publication is a separate READ COMMITTED transaction: compare against the
  // latest committed journal AFTER obtaining the lock, never a stale RR view.
  return withDatabaseTenantContext(prisma, input.workspaceId, async tx => {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`report-freshness:${input.workspaceId}:${input.clientId}`}, 0)) AS locked`;
    if (!lock?.locked) return false;
    if (!await tx.client.findFirst({ where: { id: input.clientId, workspaceId: input.workspaceId }, select: { id: true } })) return false;
    const previous = await tx.clientFreshnessState.findUnique({
      where: { workspaceId_clientId: { workspaceId: input.workspaceId, clientId: input.clientId } },
    });
    if (previous && previous.checkedAt >= input.observedAt) return false;
    const changed = previous?.incidentKey !== input.incidentKey;
    await tx.clientFreshnessState.upsert({
      where: { workspaceId_clientId: { workspaceId: input.workspaceId, clientId: input.clientId } },
      create: { workspaceId: input.workspaceId, clientId: input.clientId, status: input.status, incidentKey: input.incidentKey, checkedAt: input.observedAt, changedAt: input.observedAt },
      update: { status: input.status, incidentKey: input.incidentKey, checkedAt: input.observedAt, ...(changed ? { changedAt: input.observedAt } : {}) },
    });
    if (!changed) return false;
    await tx.auditEvent.create({ data: {
      workspaceId: input.workspaceId, action: ACTION, resource: "client", resourceId: input.clientId,
      metadata: { status: input.status, incidentKey: input.incidentKey, observedAt: input.observedAt.toISOString(), previousStatus: previous?.status ?? null },
    } });
    return true;
  }, { isolationLevel: "ReadCommitted", timeout: 5_000 });
}

/** Bounded, rotating sample. Never report a sampled page as fleet-wide health. */
export async function monitorReportFreshness(now = new Date()) {
  if (process.env.REPORT_FRESHNESS_MONITOR_ENABLED !== "1") return { enabled: false };
  const { total, clients, offset } = await withSystemScope(async () => {
    const where = { workspace: { status: { in: ["PILOT", "ACTIVE"] as ("PILOT" | "ACTIVE")[] } } };
    const total = await prisma.client.count({ where });
    const offset = freshnessMonitorPage(total, now);
    const clients = await prisma.client.findMany({ where, orderBy: { id: "asc" }, skip: offset, take: BATCH_SIZE, select: { id: true, workspaceId: true } });
    return { total, clients, offset };
  });
  let changed = 0, unavailable = 0, attention = 0;
  for (const client of clients) {
    let status: string, incidentKey: string;
    try {
      const result = await withDatabaseTenantContext(prisma, client.workspaceId, tx =>
        loadReportReadiness(client.workspaceId, defaultReportingWindow(now), { clientId: client.id, limit: 1, now, tx }),
      { isolationLevel: "RepeatableRead", timeout: 5_000 });
      if (result.nextCursor || result.evaluations.length !== 1) throw new Error("Incomplete client evidence");
      const journey = buildFreshnessJourney(result.evaluations[0]);
      status = journey.status;
      incidentKey = freshnessIncidentKey(journey);
      if (status !== "READY") attention++;
    } catch {
      status = "UNAVAILABLE";
      incidentKey = "evidence_unavailable";
      unavailable++;
    }
    try {
      if (await recordFreshnessObservation({ workspaceId: client.workspaceId, clientId: client.id, observedAt: now, status, incidentKey })) {
        changed++;
        emitMonitor("report_freshness_changed", { workspaceId: client.workspaceId, clientId: client.id, status, observedAt: now.toISOString() });
      }
    } catch {
      // Persistence failures are visible, never silently interpreted as healthy.
      emitMonitor("report_freshness_unavailable", { workspaceId: client.workspaceId, clientId: client.id });
      if (status !== "UNAVAILABLE") unavailable++;
    }
  }
  return { enabled: true, totalClients: total, checked: clients.length, offset, attention, unavailable, changed,
    sampled: clients.length < total, estimatedSweepMinutes: Math.ceil(total / BATCH_SIZE) * 15 };
}
