import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { allowAuthAttempt } from "@/lib/auth-rate-limit";
import { prismaBase } from "@/lib/prisma";

/**
 * GET /api/auth/login-events?days=7 — the caller's own recent logins.
 * Counts only; salted hashes are never returned raw.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await allowAuthAttempt({
    request,
    action: "login-events",
    identity: session.user.id,
    limit: 60,
    windowSeconds: 60,
  }))) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const rawDays = Number(searchParams.get("days") ?? "7");
  const windowDays = Number.isFinite(rawDays) ? Math.min(30, Math.max(1, Math.floor(rawDays))) : 7;

  let events: Array<{ method: string; createdAt: Date; seenIp: boolean }> = [];
  try {
    const rows = await prismaBase.loginEvent.findMany({
      where: {
        userId: session.user.id,
        createdAt: { gte: new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000) },
      },
      select: { method: true, createdAt: true, ipHash: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    events = rows.map((row) => ({ method: row.method, createdAt: row.createdAt, seenIp: row.ipHash != null }));
  } catch {
    // Fail-open with an empty list; the endpoint is informational.
  }
  return NextResponse.json({ events, windowDays });
}
