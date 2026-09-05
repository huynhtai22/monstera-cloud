import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { parseReadinessRequest } from "@/lib/report-readiness-request";
import { loadReportReadiness } from "@/lib/report-readiness-server";

export const dynamic = "force-dynamic";
async function handle(req: Request, evaluate: boolean) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const raw: unknown = evaluate ? await req.json().catch(() => null) : Object.fromEntries(new URL(req.url).searchParams);
    const input = parseReadinessRequest(raw);
    if (!input || (evaluate && !input.clientId)) return Response.json({ error: "Provide a workspace, valid client and inclusive 1–90 day window." }, { status: 400 });
    await requireWorkspaceAccess({ userId: session.user.id, workspaceId: input.workspaceId, minimumRole: evaluate ? "member" : "viewer", operation: evaluate ? "evaluate_report_readiness" : "read_report_readiness" });
    const result = await loadReportReadiness(input.workspaceId, input.window, { clientId: input.clientId, after: input.after, limit: input.limit });
    return Response.json(input.clientId ? { evaluation: result.evaluations[0] } : result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return toRbacResponse(error) ?? Response.json({ error: "Unable to evaluate report readiness. Please retry." }, { status: 500 });
  }
}
/** Latest saved evidence, freshly evaluated. No stored evaluation or remote provider request. */
export async function GET(req: Request) { return handle(req, false); }
/** Explicit re-evaluation follows member action policy, but writes no data. */
export async function POST(req: Request) { return handle(req, true); }
