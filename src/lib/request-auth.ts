import crypto from "crypto";

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function hasBearerSecret(request: Request, secret: string | undefined): boolean {
  if (!secret?.trim()) return false;
  const authorization = request.headers.get("authorization") ?? "";
  return constantTimeEqual(authorization, `Bearer ${secret}`);
}

export const CRON_SCOPES = [
  "master",
  "agent_jobs",
  "billing_expiry",
  "token_prefetch",
  "connector_artifacts_cleanup",
  "health_tick",
  "performance_alerts",
  "report_schedules",
  "security_posture",
  "seat_sharing_retention",
  "shopee_refresh",
  "sync_jobs",
  "warehouse_jobs",
  "warehouse_refresh",
] as const;

export type CronScope = typeof CRON_SCOPES[number];

export function cronSecretEnvName(scope: CronScope): string {
  return scope === "master" ? "CRON_SECRET" : `CRON_SECRET_${scope.toUpperCase()}`;
}

export function resolveCronSecret(
  scope: CronScope,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const scoped = env[cronSecretEnvName(scope)]?.trim();
  if (scoped) return scoped;
  // Local tests and preview development retain the old single-secret path.
  // Production must opt into the temporary fallback explicitly; otherwise a
  // missing scoped secret fails closed and cannot widen another job token.
  if (scope !== "master" && (env.NODE_ENV !== "production" || env.CRON_ALLOW_LEGACY_SHARED_SECRET === "1")) {
    return env.CRON_SECRET?.trim();
  }
  return undefined;
}

export function requireCronSecret(request: Request, scope: CronScope = "master"): Response | null {
  const secret = resolveCronSecret(scope);
  if ((secret?.length ?? 0) < 32) {
    return Response.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (!hasBearerSecret(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function productionRouteDisabled(featureFlag?: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return featureFlag ? process.env[featureFlag] !== "1" : true;
}
