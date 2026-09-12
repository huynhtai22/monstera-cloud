import { NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/request-auth";
import prisma from "@/lib/prisma";
import {
  beginDispatchAttempt,
  claimScheduleDispatch,
  dispatchOccurrenceDate,
  executeScheduleDispatch,
  isScheduleDue,
  releaseScheduleDispatch,
} from "@/lib/report-dispatch";
import { logger } from "@/lib/logger";
import { withSystemScope } from "@/lib/tenant-guard";

/**
 * GET /api/cron/report-schedules
 * Cron job endpoint that processes active report schedules and dispatches briefs
 * only for schedules that are currently due according to their cron expression.
 *
 * Concurrency contract: overlapping callers (GitHub Pilot cron, Vercel master
 * cron) never deliver the same schedule twice. Discovery is the only operation
 * that needs the bounded fleet system scope; each due schedule is then claimed
 * with an atomic, workspace-qualified, ownership-tracked lease (see
 * `claimScheduleDispatch`) BEFORE any provider delivery. The lease owner
 * completes it (lastSentAt + lease clear in one atomic update) after a
 * successful delivery, releases it after a handled failure, and a crashed
 * owner's lease simply expires. No network await runs with elevated system
 * scope and no database transaction is held across provider delivery.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    // Fleet discovery is the only query that cannot carry a workspace filter,
    // so it alone runs inside the bounded fleet system scope. Everything after
    // this await — claiming, dispatching, completing — uses guarded,
    // explicitly workspace-qualified operations with no elevated scope.
    const activeSchedules = await withSystemScope(async () =>
      prisma.reportSchedule.findMany({
        where: { enabled: true },
      }),
    );

    const now = new Date();
    const occurrenceDate = dispatchOccurrenceDate(now);
    const results = [];
    let dueCount = 0;
    let skipped = 0;
    let skippedClaimed = 0;
    let skippedAmbiguous = 0;
    let succeeded = 0;
    let failed = 0;

    for (const schedule of activeSchedules) {
      if (!isScheduleDue(schedule.cron, schedule.lastSentAt, now)) {
        skipped++;
        continue;
      }

      dueCount++;
      try {
        // Atomic claim: exactly one concurrent sweep can own a schedule's
        // dispatch. Zero affected rows means another owner holds a live lease
        // (or completed the schedule first) — skipped, not failed.
        const token = await claimScheduleDispatch(schedule);
        if (!token) {
          skippedClaimed++;
          results.push({
            scheduleId: schedule.id,
            clientId: schedule.clientId,
            status: "already_claimed",
          });
          continue;
        }

        // Durable occurrence/attempt state: an AMBIGUOUS or already-CONFIRMED
        // occurrence is suppressed before any provider contact, and an
        // orphaned PROVIDER_STARTED attempt resolves to AMBIGUOUS.
        const attempt = await beginDispatchAttempt(schedule, occurrenceDate, token);
        if (attempt.state === "suppressed") {
          const ambiguous = attempt.reason === "AMBIGUOUS";
          if (ambiguous) skippedAmbiguous++;
          else skippedClaimed++;
          results.push({
            scheduleId: schedule.id,
            clientId: schedule.clientId,
            status: ambiguous ? "ambiguous" : "already_delivered",
            occurrenceDate,
          });
          await releaseScheduleDispatch(schedule.id, schedule.workspaceId, token);
          continue;
        }

        try {
          const dispatchResult = await executeScheduleDispatch(schedule.id, {
            token,
            attempt: attempt.context,
          });
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
          // Ownership-checked best-effort release so the next tick can retry;
          // a release failure is logged without masking the original error.
          try {
            await releaseScheduleDispatch(schedule.id, schedule.workspaceId, token);
          } catch (releaseErr: unknown) {
            logger.error(`[cron:report-schedules] Lease release failed for schedule ${schedule.id}:`, releaseErr);
          }
        }
      } catch (claimErr: unknown) {
        failed++;
        logger.error(`[cron:report-schedules] Failed claiming schedule ${schedule.id}:`, claimErr);
        results.push({
          scheduleId: schedule.id,
          clientId: schedule.clientId,
          error: claimErr instanceof Error ? claimErr.message : String(claimErr),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      totalActive: activeSchedules.length,
      due: dueCount,
      skipped,
      skippedClaimed,
      skippedAmbiguous,
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
