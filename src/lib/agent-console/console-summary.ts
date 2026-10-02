import type { DataHealthSetupDraft } from "./setup-contracts";
import prisma from "@/lib/prisma";
import { requireWorkspaceRole } from "./persistence";
import { isAgentConsoleMonitoringAvailable } from "./availability";

export interface AgentConsoleOperationalSummary {
  workspaceId: string;
  cadence: "daily";
  schedulerStatus: "active" | "delayed" | "paused" | "unavailable" | "no_responsibility";
  monitoringAvailable: boolean;
  supportedCadenceLabel: string;
  nextScheduledCheck: string | null;
  lastSuccessfulCheck: string | null;
  lastAttemptedCheck: string | null;
  dataThroughCoverage: string | null;
  activeBlockers: string[];
  responsibilities: Array<{
    id: string;
    kind: string;
    status: string;
    cadence: string;
    version: number;
    nextDueAt: string | null;
    lastSuccessfulAt: string | null;
    scopeCount: number;
  }>;
  setupDrafts: DataHealthSetupDraft[];
  openCases: Array<{
    id: string;
    title: string;
    description: string | null;
    state: string;
    priority: string;
    version: number;
    requiredAction: string | null;
    createdAt: string;
  }>;
}

/**
 * Returns operational truth for the Agent First Console:
 * - Scheduler status: active, delayed (if overdue >60m), paused, unavailable, or no_responsibility
 * - Exact supported cadence (daily only)
 * - Last successful check, next check, and actual data-through coverage
 * - Active blockers and open actionable cases
 */
export async function getAgentConsoleOperationalSummary(
  workspaceId: string,
  userId?: string,
  now = new Date()
): Promise<AgentConsoleOperationalSummary> {
  if (userId) {
    await requireWorkspaceRole(prisma, workspaceId, userId, ["owner", "admin", "member", "viewer"]);
  }
  const responsibilities = await prisma.agentResponsibility.findMany({
    where: { workspaceId },
    include: {
      scopes: {
        where: { scopeRevision: { gt: 0 } },
      },
      evaluations: {
        orderBy: { scheduledSlot: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const openCases = await prisma.agentCase.findMany({
    where: {
      workspaceId,
      state: { not: "resolved" },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const activeResp = responsibilities.find((r) => r.status === "active");
  const pausedResp = responsibilities.find((r) => r.status === "paused");

  let schedulerStatus: AgentConsoleOperationalSummary["schedulerStatus"] = "no_responsibility";
  let nextScheduledCheck: string | null = null;
  let lastSuccessfulCheck: string | null = null;
  let lastAttemptedCheck: string | null = null;
  const activeBlockers: string[] = [];

  const monitoringAvailable = isAgentConsoleMonitoringAvailable(workspaceId);

  if (activeResp) {
    nextScheduledCheck = activeResp.nextDueAt ? activeResp.nextDueAt.toISOString() : null;
    lastSuccessfulCheck = activeResp.lastSuccessfulAt ? activeResp.lastSuccessfulAt.toISOString() : null;
    lastAttemptedCheck = activeResp.lastAttemptedAt ? activeResp.lastAttemptedAt.toISOString() : null;

    if (!monitoringAvailable) {
      schedulerStatus = "unavailable";
      activeBlockers.push("WORKER_UNAVAILABLE: Monitoring worker is currently unavailable or disabled");
    } else if (activeResp.nextDueAt && activeResp.nextDueAt.getTime() + 60 * 60 * 1000 < now.getTime()) {
      schedulerStatus = "delayed";
      activeBlockers.push("SCHEDULER_DELAYED: Scheduled check is overdue by more than 60 minutes");
    } else {
      schedulerStatus = "active";
    }

    const latestEval = activeResp.evaluations[0];
    if (latestEval?.blockerCode) {
      activeBlockers.push(latestEval.blockerCode);
    }
  } else if (pausedResp) {
    schedulerStatus = "paused";
    lastSuccessfulCheck = pausedResp.lastSuccessfulAt ? pausedResp.lastSuccessfulAt.toISOString() : null;
    activeBlockers.push("RESPONSIBILITY_PAUSED: Automated health monitoring is currently paused");
  } else if (!monitoringAvailable) {
    schedulerStatus = "unavailable";
    activeBlockers.push("WORKER_UNAVAILABLE: Monitoring worker is currently unavailable or disabled");
  }

  // Get data-through coverage across confirmed responsibility scoped connections
  let scopedConnIds: string[] = [];
  if (activeResp) {
    scopedConnIds = Array.from(new Set(activeResp.scopes.filter(s => s.scopeRevision === activeResp.scopeRevision).map((s) => s.connectionId)));
  } else if (pausedResp) {
    scopedConnIds = Array.from(new Set(pausedResp.scopes.filter(s => s.scopeRevision === pausedResp.scopeRevision).map((s) => s.connectionId)));
  }

  let dataThroughCoverage: string | null = null;
  if (scopedConnIds.length > 0) {
    const connections = await prisma.connection.findMany({
      where: { workspaceId, id: { in: scopedConnIds } },
      select: { lastDataThrough: true, status: true },
    });

    const datesThrough = connections
      .map((c) => c.lastDataThrough)
      .filter((d): d is Date => d !== null);

    // If any scoped connection has no dataThrough date, coverage is unknown/partial
    if (datesThrough.length === connections.length && datesThrough.length > 0) {
      const minDate = new Date(Math.min(...datesThrough.map((d) => d.getTime())));
      dataThroughCoverage = minDate.toISOString().slice(0, 10);
    }
  }

  return {
    workspaceId,
    cadence: "daily",
    schedulerStatus,
    monitoringAvailable,
    supportedCadenceLabel: "Daily checks (evaluation target)",
    nextScheduledCheck,
    lastSuccessfulCheck,
    lastAttemptedCheck,
    dataThroughCoverage,
    activeBlockers,
    responsibilities: responsibilities.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      cadence: r.cadence,
      version: r.version,
      nextDueAt: r.nextDueAt ? r.nextDueAt.toISOString() : null,
      lastSuccessfulAt: r.lastSuccessfulAt ? r.lastSuccessfulAt.toISOString() : null,
      scopeCount: r.scopes.filter(s => s.scopeRevision === r.scopeRevision).length,
    })),
    setupDrafts: responsibilities.filter(r => r.kind === "data_health" && r.status === "draft").map(r => ({
      id: r.id, version: r.version, timezone: r.timezone, updatedAt: r.updatedAt.toISOString(),
      scopes: r.scopes.filter(s => s.scopeRevision === r.scopeRevision).map(s => ({
        connectionId: s.connectionId, provider: s.provider, providerAccountId: s.providerAccountId, accountName: s.accountName,
      })),
    })),
    openCases: openCases.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      state: c.state,
      priority: c.priority,
      version: c.version,
      requiredAction: c.requiredAction,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}
