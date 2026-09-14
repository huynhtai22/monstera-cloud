import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { approveReportSnapshot, ReportApprovalError } from "@/lib/report-approval";
import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
} from "@/lib/client-context-server";

/**
 * POST /api/reports/approval
 * Authenticated workspace operator approval for an exact, immutable ReportSnapshot.
 * Enforces:
 * - Minimum workspace role: "member"
 * - Exact workspace and client match
 * - Snapshot exists, is current, and data is ready to review
 * - Idempotent for repeated identical requests
 * - Zero external network calls and zero DestinationDeliveryReceipt writes
 */
export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { workspaceId, clientId, snapshotId, notes } = body ?? {};

    if (!workspaceId || !clientId || !snapshotId) {
      return NextResponse.json(
        { error: "workspaceId, clientId, and snapshotId are required" },
        { status: 400 },
      );
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
    });

    const resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId,
      surface: "reports",
    });
    assertQueryableClientContext(resolution, { requireExplicitClient: true });
    if (resolution.status !== "resolved") {
      return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });
    }

    const result = await approveReportSnapshot({
      workspaceId,
      clientId: resolution.client.id,
      snapshotId,
      userId: session.user.id,
      notes: typeof notes === "string" ? notes : null,
    });

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error: unknown) {
    const clientCtx = toClientContextResponse(error);
    if (clientCtx) return clientCtx;
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    if (error instanceof ReportApprovalError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[report-approval] operation failed:", error);
    return NextResponse.json({ error: "Failed to approve report snapshot" }, { status: 500 });
  }
}
