import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { deriveReportingReadiness } from "@/lib/reporting-readiness";

/**
 * GET /api/workspaces/[id]/readiness?since=&until=&clientId=
 * Derived DTO — no ReportingReadiness table.
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> | { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const workspaceId = params.id;
  const { searchParams } = new URL(req.url);
  const since = searchParams.get("since") ?? undefined;
  const until = searchParams.get("until") ?? undefined;
  const clientId = searchParams.get("clientId") ?? undefined;

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

  const readiness = await deriveReportingReadiness(workspaceId, { since, until, clientId });
  return NextResponse.json(readiness);
}
