import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { toClientContextResponse } from "@/lib/client-context-server";
import { loadOperationsSummary, operationsSummaryQuerySchema } from "@/lib/operations-summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/operations/summary
 *
 * Read-only, tenant-scoped operations summary for the Operations Hub.
 *
 * - GET only. No mutation method is exported.
 * - Requires an authenticated session and `viewer` workspace membership.
 * - Client context is delegated to the shared authoritative resolver, so an
 *   invalid client can never widen scope to workspace-wide evidence.
 * - Contacts no provider or destination and writes no database record.
 */
export async function GET(req: Request) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = operationsSummaryQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    if (!parsed.success) {
      return Response.json({ error: "Provide a valid workspace and client context." }, { status: 400 });
    }
    const { workspaceId, clientId } = parsed.data;

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "read_operations_summary",
    });

    const summary = await loadOperationsSummary({
      workspaceId,
      requestedClientId: clientId ?? null,
    });

    return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return (
      toClientContextResponse(error) ??
      toRbacResponse(error) ??
      Response.json({ error: "Unable to load the operations summary. Please retry." }, { status: 500 })
    );
  }
}
