import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import {
  getUserSessionAllowance,
  listUserSessions,
} from "@/lib/session-limits";

/**
 * GET /api/auth/sessions — the caller's own browser sessions.
 * `current: true` marks the session owning this request's JWT.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await allowAuthAttempt({
    request,
    action: "session-list",
    identity: session.user.id,
    limit: 60,
    windowSeconds: 60,
  }))) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
  }
  const [sessions, allowance] = await Promise.all([
    listUserSessions(session.user.id, session.user.sessionId ?? null),
    getUserSessionAllowance(session.user.id),
  ]);
  const now = Date.now();
  const liveGraceEndsAt = sessions
    .filter((row) => !row.revokedAt && (row.graceEndsAt?.getTime() ?? 0) > now)
    .map((row) => row.graceEndsAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return NextResponse.json({
    sessions,
    allowance: allowance ? {
      ...allowance,
      hardLimit: allowance.activeLimit + allowance.graceSlots,
      activeCount: sessions.filter((row) => !row.revokedAt).length,
      graceEndsAt: liveGraceEndsAt,
    } : null,
  });
}
