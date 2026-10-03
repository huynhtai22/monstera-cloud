import { getAuthSession } from "@/lib/auth-session";
import { prismaBase } from "@/lib/prisma";
import { claimConsoleReminder } from "@/lib/console-reminder-server";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  // Prevent an external page from consuming someone's once-only reminder.
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Forbidden" }, { status: 403, headers });
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    if (process.env.ENABLE_CONSOLE_FEATURE_REMINDERS !== "1" || !session.user.sessionId) return Response.json({ campaign: null }, { headers });
    const body = await request.json();
    if (typeof body?.workspaceId !== "string" || !body.workspaceId || body.workspaceId.length > 200) return Response.json({ error: "Select a workspace" }, { status: 400, headers });
    const campaign = await claimConsoleReminder(prismaBase, session.user.id, session.user.sessionId, body.workspaceId);
    return Response.json({ campaign }, { headers });
  } catch {
    // Frequency/database failure never blocks the console or falls back to showing repeatedly.
    return Response.json({ campaign: null }, { headers });
  }
}
