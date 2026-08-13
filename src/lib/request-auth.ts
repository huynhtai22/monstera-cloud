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

export function requireCronSecret(request: Request): Response | null {
  if ((process.env.CRON_SECRET?.trim().length ?? 0) < 32) {
    return Response.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (!hasBearerSecret(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function productionRouteDisabled(featureFlag?: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return featureFlag ? process.env[featureFlag] !== "1" : true;
}
