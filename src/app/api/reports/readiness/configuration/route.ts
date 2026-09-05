import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { requireWorkspaceAccess, RbacError, toRbacResponse } from "@/lib/rbac";
import { contextOverrideSchema, requirementsSchema } from "@/lib/reporting-context";

export const dynamic = "force-dynamic";
const scopeSchema = z.object({ workspaceId: z.string().min(1).max(160), clientId: z.string().min(1).max(160) });
const updateSchema = scopeSchema.extend({ requirements: requirementsSchema.optional(), override: contextOverrideSchema.optional() }).strict().refine(v => Boolean(v.requirements) !== Boolean(v.override));

async function handle(req: Request, write: boolean) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const raw = write ? await req.json().catch(() => null) : Object.fromEntries(new URL(req.url).searchParams);
    const parsed = (write ? updateSchema : scopeSchema.strict()).safeParse(raw);
    if (!parsed.success) return Response.json({ error: "Invalid reporting configuration. Use valid timezone/currency, a reason of at least 10 characters, and nonempty requirements." }, { status: 400 });
    const { workspaceId, clientId } = parsed.data;
    const access = await requireWorkspaceAccess({ userId: session.user.id, workspaceId, minimumRole: write ? "admin" : "viewer", operation: "reporting_configuration" });
    const canEdit = ["owner", "admin"].includes(access.membership.role);
    const result = await prisma.$transaction(async tx => {
      const client = await tx.client.findFirst({ where: { workspaceId, id: clientId }, select: { requiredProviders: true, requiredDestinations: true, requirementsConfiguredAt: true } });
      if (!client) throw new RbacError("Client not found", "NOT_FOUND", 404);
      if (write) {
        const input = updateSchema.parse(raw);
        if (input.requirements) {
          const after = { requiredProviders: [...new Set(input.requirements.providers)].sort(), requiredDestinations: [...new Set(input.requirements.destinations)].sort(), requirementsConfiguredAt: new Date() };
          await tx.client.update({ where: { workspaceId_id: { workspaceId, id: clientId } }, data: after });
          await tx.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "reporting_requirements.updated", resource: "client", resourceId: clientId, metadata: JSON.parse(JSON.stringify({ before: client, after })) } });
        }
        if (input.override) {
          const { connectionId, accountId, timezone, currency, reason } = input.override;
          const source = await tx.connection.findFirst({ where: { workspaceId, id: connectionId, clientId, type: "source" }, select: { id: true } });
          if (!source) throw new RbacError("Account not found", "NOT_FOUND", 404);
          const key = { workspaceId, connectionId, accountId };
          const before = await tx.accountReportingContext.findFirst({ where: key });
          const known = before || await tx.campaignMetric.findFirst({ where: key, select: { id: true } }) || await tx.providerAccountHealth.findFirst({ where: key, select: { id: true } });
          if (!known) throw new RbacError("Account not found", "NOT_FOUND", 404);
          const after = { overrideTimezone: timezone, overrideCurrency: currency, overrideReason: reason, overrideBy: session.user.id, overrideAt: new Date() };
          const context = await tx.accountReportingContext.upsert({ where: { workspaceId_connectionId_accountId: key }, create: { ...key, ...after }, update: after });
          await tx.auditEvent.create({ data: { workspaceId, actorUserId: session.user.id, action: "reporting_context.overridden", resource: "account", resourceId: context.id, metadata: JSON.parse(JSON.stringify({ before, after, clientId, connectionId, accountId })) } });
        }
        return { ok: true };
      }
      const connection = { workspaceId, clientId, type: "source" };
      const [contexts, metrics, health] = await Promise.all([
        tx.accountReportingContext.findMany({ where: { workspaceId, connection }, take: 500, orderBy: { id: "asc" } }),
        tx.campaignMetric.groupBy({ by: ["connectionId", "accountId"], where: { workspaceId, connection }, take: 500, orderBy: [{ connectionId: "asc" }, { accountId: "asc" }] }),
        tx.providerAccountHealth.findMany({ where: { workspaceId, connection }, select: { connectionId: true, accountId: true }, take: 500, orderBy: { id: "asc" } }),
      ]);
      const accounts = [...new Map([...metrics, ...health, ...contexts].map(a => [JSON.stringify([a.connectionId, a.accountId]), a])).values()].map(a => ({ connectionId: a.connectionId, accountId: a.accountId, context: contexts.find(c => c.connectionId === a.connectionId && c.accountId === a.accountId) ?? null }));
      return { ...client, canEdit, accounts };
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return toRbacResponse(error) ?? Response.json({ error: "Reporting configuration unavailable" }, { status: 500 }); }
}
export async function GET(req: Request) { return handle(req, false); }
export async function PATCH(req: Request) { return handle(req, true); }
