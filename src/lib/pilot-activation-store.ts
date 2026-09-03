import {
  DASHBOARD_REVIEWED_ACTION,
  DASHBOARD_REVIEWED_RESOURCE,
  dashboardReviewAuditId,
} from "@/lib/pilot-activation";
import prisma from "@/lib/prisma";

export class PilotActivationConflictError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "PilotActivationConflictError";
  }
}

export async function recordDashboardReviewMilestone(input: {
  workspaceId: string;
  actorUserId: string;
  now?: Date;
}): Promise<{ rows7d: number; createdAt: Date }> {
  const now = input.now ?? new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [rows7d, dataThrough, existing] = await Promise.all([
    prisma.campaignMetric.count({
      where: { workspaceId: input.workspaceId, date: { gte: sevenDaysAgo } },
    }),
    prisma.campaignMetric.aggregate({
      where: { workspaceId: input.workspaceId, date: { gte: sevenDaysAgo } },
      _max: { date: true },
    }),
    prisma.auditEvent.findFirst({
      where: { workspaceId: input.workspaceId, action: DASHBOARD_REVIEWED_ACTION },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  if (rows7d < 1) {
    throw new PilotActivationConflictError(
      "Recent KPI rows are required before the dashboard can be marked reviewed",
    );
  }
  if (existing) return { rows7d, createdAt: existing.createdAt };

  const event = await prisma.auditEvent.upsert({
    where: { id: dashboardReviewAuditId(input.workspaceId) },
    create: {
      id: dashboardReviewAuditId(input.workspaceId),
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: DASHBOARD_REVIEWED_ACTION,
      resource: DASHBOARD_REVIEWED_RESOURCE,
      resourceId: input.workspaceId,
      metadata: {
        rows7d,
        dataThroughDate: dataThrough._max.date?.toISOString() ?? null,
      },
    },
    update: {},
    select: { createdAt: true },
  });
  return { rows7d, createdAt: event.createdAt };
}
