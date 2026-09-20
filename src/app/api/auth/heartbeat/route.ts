import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { touchSession } from "@/lib/session-limits";

/**
 * POST /api/auth/heartbeat — P3 presence ping (called every ~5 minutes by
 * the app shell). Refreshes `lastSeenAt` and enriches the session's
 * IP/UA hashes from request headers so sharing signals stay accurate.
 * Throttled server-side to one write per 10 minutes per session.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({
      error: "Unauthorized",
      code: session?.user?.sessionId ? "SESSION_REVOKED" : "UNAUTHORIZED",
    }, { status: 401 });
  }
  // Generous per-account ceiling: ~12/hour is normal (one tab every 5 min),
  // so this only stops tight loops. Writes stay throttled server-side anyway.
  if (!(await allowAuthAttempt({
    request,
    action: "session-heartbeat",
    identity: session.user.id,
    limit: 60,
    windowSeconds: 10 * 60,
  }))) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
  }
  await touchSession(session.user.sessionId ?? null, request);
  return NextResponse.json({ ok: true });
}
