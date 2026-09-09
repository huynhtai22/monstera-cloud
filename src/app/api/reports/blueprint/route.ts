import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  BlueprintInputError,
  generateWeeklyBlueprint,
  reopenWeeklyBlueprint,
  STALE_REASON_LABELS,
} from "@/lib/report-blueprint";
import {
  assertQueryableClientContext,
  resolveClientContext,
  toClientContextResponse,
} from "@/lib/client-context-server";

function blueprintErrorResponse(error: unknown) {
  const clientCtx = toClientContextResponse(error);
  if (clientCtx) return clientCtx;
  const rbac = toRbacResponse(error);
  if (rbac) return rbac;
  if (error instanceof BlueprintInputError) {
    const status = error.code === "client_not_found" ? 404
      : error.code === "requirements_not_configured" ? 409
        : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  // Never leak internal error details (driver messages, paths) to clients.
  console.error("[blueprint] operation failed:", error);
  return NextResponse.json(
    { error: "Blueprint operation failed. Please retry." },
    { status: 500 },
  );
}

/**
 * POST /api/reports/blueprint
 * Generate (idempotently) the Verified Weekly Performance snapshot for a
 * client + exact seven-day window. Requirements come from the client's
 * explicit `requiredProviders`/`requiredDestinations` (PR #152); delivery
 * evidence comes from `DestinationDeliveryReceipt` currentness. Generation
 * reads only warehouse data via the shared readiness server.
 */
export async function POST(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { workspaceId, clientId, windowStart, windowEnd } = body ?? {};
    if (!workspaceId || !clientId) {
      return NextResponse.json({ error: "workspaceId and clientId are required" }, { status: 400 });
    }
    // Reject half-specified windows instead of silently substituting the default.
    if (Boolean(windowStart) !== Boolean(windowEnd)) {
      return NextResponse.json(
        { error: "Provide both windowStart and windowEnd, or neither." },
        { status: 400 },
      );
    }
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member" });
    const resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId,
      surface: "reports",
    });
    assertQueryableClientContext(resolution, { requireExplicitClient: true });
    if (resolution.status !== "resolved") {
      return NextResponse.json({ error: "workspaceId and clientId are required" }, { status: 400 });
    }

    const result = await generateWeeklyBlueprint({
      workspaceId,
      clientId: resolution.client.id,
      windowStart: typeof windowStart === "string" ? windowStart : undefined,
      windowEnd: typeof windowEnd === "string" ? windowEnd : undefined,
    });

    return NextResponse.json({
      snapshot: result.snapshot,
      report: result.report,
      created: result.created,
      readiness: result.readiness,
    });
  } catch (error: unknown) {
    return blueprintErrorResponse(error);
  }
}

/**
 * GET /api/reports/blueprint?workspaceId=&clientId=&windowStart=&windowEnd=
 * Reopens the latest saved snapshot for the canonical input (default: the
 * shared default window), recomputes its staleness and verification, and
 * returns the client's explicit requirements for context. Requirements
 * mutation happens exclusively through /api/reports/readiness/configuration.
 */
export async function GET(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");
    const clientId = searchParams.get("clientId");
    const windowStart = searchParams.get("windowStart");
    const windowEnd = searchParams.get("windowEnd");
    if (!workspaceId || !clientId) {
      return NextResponse.json({ error: "workspaceId and clientId are required" }, { status: 400 });
    }
    // Reject half-specified windows instead of silently substituting the default.
    if (Boolean(windowStart) !== Boolean(windowEnd)) {
      return NextResponse.json(
        { error: "Provide both windowStart and windowEnd, or neither." },
        { status: 400 },
      );
    }
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });
    const resolution = await resolveClientContext({
      workspaceId,
      requestedClientId: clientId,
      surface: "reports",
    });
    assertQueryableClientContext(resolution, { requireExplicitClient: true });
    if (resolution.status !== "resolved") {
      return NextResponse.json({ error: "workspaceId and clientId are required" }, { status: 400 });
    }

    const result = await reopenWeeklyBlueprint({
      workspaceId,
      clientId: resolution.client.id,
      windowStart: windowStart ?? undefined,
      windowEnd: windowEnd ?? undefined,
    });

    return NextResponse.json({
      client: result.client,
      snapshot: result.snapshot
        ? {
          ...result.snapshot,
          freshness: {
            ...result.snapshot.freshness,
            staleReasons: result.snapshot.freshness.staleReasons
              .map((reason) => ({
                code: reason,
                label: STALE_REASON_LABELS[reason] ?? "Report dependencies changed after generation",
              })),
          },
        }
        : null,
      report: result.report,
      defaultWindow: result.defaultWindow,
    });
  } catch (error: unknown) {
    return blueprintErrorResponse(error);
  }
}
