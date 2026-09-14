import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
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
    const { snapshotId } = body ?? {};
    let { workspaceId, clientId } = body ?? {};

    if (!snapshotId) {
      return NextResponse.json(
        { error: "snapshotId is required" },
        { status: 400 },
      );
    }

    // 1. Load the snapshot to resolve authoritative tenant and client identity server-side
    const snapshot = await prisma.reportSnapshot.findUnique({
      where: { id: snapshotId },
      select: { id: true, workspaceId: true, clientId: true },
    });

    if (!snapshot) {
      return NextResponse.json({ error: "Report snapshot not found" }, { status: 404 });
    }

    // Resolve workspaceId: verify against provided workspaceId or session active workspace
    const targetWorkspaceId = workspaceId ?? snapshot.workspaceId;
    if (targetWorkspaceId !== snapshot.workspaceId) {
      return NextResponse.json({ error: "Snapshot does not belong to this workspace" }, { status: 403 });
    }

    // 2. Authorize operator with at least "member" role
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId: targetWorkspaceId,
      minimumRole: "member",
      operation: "approve_report_snapshot",
    });

    // Verify client belongs to workspace
    if (clientId && clientId !== snapshot.clientId) {
      return NextResponse.json({ error: "Snapshot does not belong to this client" }, { status: 400 });
    }

    const resolution = await resolveClientContext({
      workspaceId: targetWorkspaceId,
      requestedClientId: snapshot.clientId,
      surface: "reports",
    });
    assertQueryableClientContext(resolution, { requireExplicitClient: true });
    if (resolution.status !== "resolved") {
      return NextResponse.json({ error: "Client not found in this workspace." }, { status: 404 });
    }

    const result = await approveReportSnapshot({
      workspaceId: targetWorkspaceId,
      clientId: snapshot.clientId,
      snapshotId,
      userId: session.user.id,
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
