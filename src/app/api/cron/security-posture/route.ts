import { NextResponse } from "next/server";
import { prismaBase } from "@/lib/prisma";
import { emitMonitor } from "@/lib/observability/monitors";
import { requireCronSecret } from "@/lib/request-auth";
import { evaluateSecurityPosture } from "@/lib/security-posture";

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const denied = requireCronSecret(request, "security_posture");
  if (denied) return denied;

  const now = new Date();
  const ago15m = new Date(now.getTime() - 15 * 60 * 1000);
  const ago30m = new Date(now.getTime() - 30 * 60 * 1000);
  const [authFailures15m, pinRejections15m, cronFailures30m, retention] = await Promise.all([
    prismaBase.securityControlEvent.count({
      where: { eventType: "auth_failure", createdAt: { gte: ago15m } },
    }),
    prismaBase.securityControlEvent.count({
      where: { eventType: "api_key_pin_rejection", createdAt: { gte: ago15m } },
    }),
    prismaBase.securityControlEvent.count({
      where: { eventType: "cron_execution", outcome: "failure", createdAt: { gte: ago30m } },
    }),
    prismaBase.securityControlEvent.findFirst({
      where: { eventType: "retention_cleanup", outcome: "success" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const breaches = evaluateSecurityPosture({
    now,
    authFailures15m,
    pinRejections15m,
    cronFailures30m,
    lastRetentionSuccessAt: retention?.createdAt ?? null,
    thresholds: {
      authFailures15m: positiveInt(process.env.SECURITY_AUTH_FAILURE_THRESHOLD_15M, 20),
      pinRejections15m: positiveInt(process.env.SECURITY_PIN_REJECTION_THRESHOLD_15M, 5),
      maxRetentionAgeHours: positiveInt(process.env.SECURITY_RETENTION_MAX_AGE_HOURS, 26),
    },
  });

  for (const breach of breaches) {
    const fields = { code: breach.code, actual: breach.actual, threshold: breach.threshold };
    if (breach.code === "AUTH_FAILURE_SPIKE") emitMonitor("auth_failure_spike", fields);
    if (breach.code === "API_KEY_PIN_REJECTION_SPIKE") emitMonitor("api_key_pin_rejection_spike", fields);
    if (breach.code === "CRON_FAILURE") emitMonitor("cron_failure", fields);
    if (breach.code === "RETENTION_LAG") emitMonitor("retention_lag", fields);
  }

  return NextResponse.json({
    ok: breaches.length === 0,
    checkedAt: now.toISOString(),
    signals: { authFailures15m, pinRejections15m, cronFailures30m, lastRetentionSuccessAt: retention?.createdAt ?? null },
    breaches,
  }, { status: breaches.length === 0 ? 200 : 503 });
}
