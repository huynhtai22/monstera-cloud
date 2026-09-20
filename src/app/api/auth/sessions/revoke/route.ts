import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { logger } from "@/lib/logger";
import { revokeOtherUserSessions, revokeUserSession } from "@/lib/session-limits";

/**
 * POST /api/auth/sessions/revoke — revoke the caller's own sessions.
 * Body: `{ jti: string }` to revoke one session, or `{ allOthers: true }`
 * to sign out every other device. The current JWT can never revoke itself
 * via `allOthers`; revoking the current `jti` explicitly logs this browser
 * out on its next request.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Strict per-account guard: revocation is destructive (signs devices out).
  if (!(await allowAuthAttempt({
    request,
    action: "session-revoke",
    identity: session.user.id,
    limit: 20,
    windowSeconds: 15 * 60,
  }))) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
  }

  let body: { jti?: unknown; allOthers?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.allOthers === true) {
    const currentJti = session.user.sessionId;
    if (!currentJti) return NextResponse.json({ error: "Current session unknown" }, { status: 400 });
    const revoked = await revokeOtherUserSessions(session.user.id, currentJti);
    logger.info(`[SESSION] user revoked other sessions: userId=${session.user.id} count=${revoked}`);
    return NextResponse.json({ revoked });
  }

  if (typeof body.jti !== "string" || body.jti.length === 0 || body.jti.length > 128) {
    return NextResponse.json({ error: "A valid jti is required" }, { status: 400 });
  }
  const revoked = await revokeUserSession(session.user.id, body.jti);
  if (revoked !== 1) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  logger.info(`[SESSION] user revoked session: userId=${session.user.id}`);
  return NextResponse.json({ revoked });
}
