import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { parseReadinessRequest } from "@/lib/report-readiness-request";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { deriveReportingReadiness } from "@/lib/reporting-readiness";

/**
 * GET /api/workspaces/[id]/readiness?since=&until=&clientId=
 * Derived DTO — no ReportingReadiness table.
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const workspaceId = params.id;
  const { searchParams } = new URL(req.url);
  const since = searchParams.get("since") ?? undefined;
  const until = searchParams.get("until") ?? undefined;
  const clientId = searchParams.get("clientId") ?? undefined;
  const parsed = parseReadinessRequest({ workspaceId, clientId, start: since, end: until });
  if (!parsed) return NextResponse.json({ error: "Invalid readiness window" }, { status: 400 });

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "read_reporting_readiness",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const readiness = await deriveReportingReadiness(workspaceId, { since: parsed.window.start, until: parsed.window.end, clientId });
    return NextResponse.json(readiness, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Unable to evaluate readiness" }, { status: 500 });
  }
}
