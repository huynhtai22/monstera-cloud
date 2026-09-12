import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";
import prisma from "@/lib/prisma";
import { executeScheduleDispatch, isScheduleDue } from "@/lib/report-dispatch";
import { logger } from "@/lib/logger";
import { withSystemScope } from "@/lib/tenant-guard";

/**
 * GET /api/cron/report-schedules
 * Cron job endpoint that processes active report schedules and dispatches briefs
 * only for schedules that are currently due according to their cron expression.
 *
 * The schedule sweep is inherently cross-workspace, so the scan and its
 * dispatches run inside the bounded fleet system scope (the same pattern as
 * token-prefetch and warehouse-jobs). Cron authentication happens before the
 * scope opens, dispatch helpers issue workspace-scoped queries, and the guard
 * stays active for every path outside this callback.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const summary = await withSystemScope(async () => {
      const activeSchedules = await prisma.reportSchedule.findMany({
        where: { enabled: true },
      });

      const now = new Date();
      const results = [];
      let dueCount = 0;
      let skipped = 0;
      let succeeded = 0;
      let failed = 0;

      for (const schedule of activeSchedules) {
        if (!isScheduleDue(schedule.cron, schedule.lastSentAt, now)) {
          skipped++;
          continue;
        }

        dueCount++;
        try {
          const dispatchResult = await executeScheduleDispatch(schedule.id);
          results.push(dispatchResult);
          succeeded++;
        } catch (err: unknown) {
          failed++;
          logger.error(`[cron:report-schedules] Failed dispatching schedule ${schedule.id}:`, err);
          results.push({
            scheduleId: schedule.id,
            clientId: schedule.clientId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        totalActive: activeSchedules.length,
        due: dueCount,
        skipped,
        succeeded,
        failed,
        results,
      };
    });

    return NextResponse.json({
      ok: true,
      totalActive: summary.totalActive,
      due: summary.due,
      skipped: summary.skipped,
      succeeded: summary.succeeded,
      failed: summary.failed,
      results: summary.results,
    });
  } catch (error: unknown) {
    logger.error("[cron:report-schedules] Fatal execution error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal cron failure" },
      { status: 500 }
    );
  }
}
