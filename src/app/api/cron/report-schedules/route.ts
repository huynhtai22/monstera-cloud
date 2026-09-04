import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";
import prisma from "@/lib/prisma";
import { executeScheduleDispatch } from "@/lib/report-dispatch";
import { logger } from "@/lib/logger";

/**
 * GET /api/cron/report-schedules
 * Cron job endpoint that processes active report schedules and dispatches briefs.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const activeSchedules = await prisma.reportSchedule.findMany({
      where: { enabled: true },
    });

    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (const schedule of activeSchedules) {
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

    return NextResponse.json({
      ok: true,
      processed: activeSchedules.length,
      succeeded,
      failed,
      results,
    });
  } catch (error: unknown) {
    logger.error("[cron:report-schedules] Fatal execution error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal cron failure" },
      { status: 500 }
    );
  }
}
