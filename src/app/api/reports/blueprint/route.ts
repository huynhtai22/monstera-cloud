import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  BlueprintInputError,
  generateWeeklyBlueprint,
  reopenWeeklyBlueprint,
  STALE_REASON_LABELS,
} from "@/lib/report-blueprint";

function blueprintErrorResponse(error: unknown) {
  const rbac = toRbacResponse(error);
  if (rbac) return rbac;
  if (error instanceof BlueprintInputError) {
    const status = error.code === "client_not_found" ? 404
      : error.code === "requirements_not_configured" ? 409
        : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Blueprint operation failed" },
    { status: 500 },
  );
}

/**
 * POST /api/reports/blueprint
 * Generate (idempotently) the Verified Weekly Performance snapshot for a
 * client + exact seven-day window. Generation reads only warehouse data.
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
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "member" });

    const result = await generateWeeklyBlueprint({
      workspaceId,
      clientId,
      windowStart: typeof windowStart === "string" ? windowStart : undefined,
      windowEnd: typeof windowEnd === "string" ? windowEnd : undefined,
    });

    return NextResponse.json({
      snapshot: result.snapshot,
      report: result.report,
      created: result.created,
      readiness: {
        status: result.readiness.status,
        blockers: result.readiness.blockers,
        currencies: result.readiness.currencies,
        freshness: result.readiness.freshness,
        lastDataThrough: result.readiness.lastDataThrough,
      },
    });
  } catch (error: unknown) {
    return blueprintErrorResponse(error);
  }
}

/**
 * GET /api/reports/blueprint?workspaceId=&clientId=&windowStart=&windowEnd=
 * Reopens the latest saved snapshot for the canonical input (default: the
 * last complete week in the client's reporting timezone), recomputes its
 * staleness and verification, and returns requirements for context.
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
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: "viewer" });

    const result = await reopenWeeklyBlueprint({
      workspaceId,
      clientId,
      windowStart: windowStart ?? undefined,
      windowEnd: windowEnd ?? undefined,
    });

    return NextResponse.json({
      requirement: result.requirement,
      client: { id: clientId },
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
