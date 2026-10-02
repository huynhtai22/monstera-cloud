import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";
import { withSystemScope } from "@/lib/tenant-guard";
import prisma from "@/lib/prisma";
import { executeScheduledDataHealthCheck } from "@/lib/agent-console/scheduler";
import {
  getAgentConsoleMonitoringWorkspaceIds,
  isAgentConsoleMonitoringRuntimeAvailable,
} from "@/lib/agent-console/availability";

export async function GET(req: Request) {
  const denied = requireCronSecret(req, "agent_console");
  if (denied) return denied;
  return runAgentConsoleCron();
}

export async function POST(req: Request) {
  const denied = requireCronSecret(req, "agent_console");
  if (denied) return denied;
  return runAgentConsoleCron();
}

async function runAgentConsoleCron() {
  if (!isAgentConsoleMonitoringRuntimeAvailable()) {
    return NextResponse.json({
      status: "unavailable",
      message: "Agent console monitoring or worker execution is disabled or unavailable",
      executedCount: 0,
      results: [],
    }, { status: 503 });
  }

  return withSystemScope(async () => {
    const now = new Date();
    const workspaceIds = getAgentConsoleMonitoringWorkspaceIds();
    const activeResponsibilities = await prisma.agentResponsibility.findMany({
      where: {
        status: "active",
        nextDueAt: { lte: now },
        ...(workspaceIds.length ? { workspaceId: { in: workspaceIds } } : {}),
      },
      take: 10,
    });

    const results = [];
    for (const resp of activeResponsibilities) {
      try {
        const outcome = await executeScheduledDataHealthCheck({
          workspaceId: resp.workspaceId,
          responsibilityId: resp.id,
          // Anchor recovery to the missed due time, not today's date. This makes
          // outage catch-up distinct from any check already recorded today.
          scheduledSlot: resp.nextDueAt ?? now,
          now,
        });
        results.push({ responsibilityId: resp.id, outcome: outcome.status });
      } catch (err) {
        results.push({ responsibilityId: resp.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({
      executedCount: results.length,
      results,
      timestamp: now.toISOString(),
    });
  });
}
