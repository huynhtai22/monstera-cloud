import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { decrypt } from "@/lib/encryption";
import { googleAdsPortalAccessInputSchema } from "@/lib/ad-certification/portal-access-facts";

const requestSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  connectionId: z.string().trim().min(1).max(128),
  accountId: z.string().trim().min(1).max(32),
  facts: googleAdsPortalAccessInputSchema,
}).strict();

const normalizeCustomerId = (value: string) => value.replace(/\D/g, "");

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid Google Ads portal confirmation", issues: parsed.error.issues }, { status: 400 });

  const { workspaceId, connectionId, accountId, facts } = parsed.data;
  const canonicalAccountId = normalizeCustomerId(accountId);
  if (canonicalAccountId.length !== 10) {
    return NextResponse.json({ error: "accountId must be a 10-digit Google Ads customer ID" }, { status: 400 });
  }

  const [user, workspace, membership, connection] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, ownerId: true } }),
    prisma.workspaceMember.findFirst({ where: { workspaceId, userId: session.user.id }, select: { role: true } }),
    prisma.connection.findFirst({
      where: { id: connectionId, workspaceId, provider: "google_ads", status: "connected" },
      select: { id: true, remoteAccountId: true, credentials: true },
    }),
  ]);

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  if (workspace.ownerId !== user.id && membership?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden: only a workspace owner can confirm provider portal facts" }, { status: 403 });
  }
  let accountBelongsToConnection = Boolean(connection && normalizeCustomerId(connection.remoteAccountId) === canonicalAccountId);
  if (connection && !accountBelongsToConnection) {
    try {
      const credentials = JSON.parse(decrypt(connection.credentials)) as Record<string, unknown>;
      const discoveredIds = Array.isArray(credentials.discoveredCustomerIds) ? credentials.discoveredCustomerIds : [];
      accountBelongsToConnection = discoveredIds.some((id) => normalizeCustomerId(String(id)) === canonicalAccountId);
    } catch {
      accountBelongsToConnection = false;
    }
  }
  if (!connection || !accountBelongsToConnection) {
    return NextResponse.json({ error: "Connected Google Ads account does not match the selected customer ID" }, { status: 400 });
  }

  const verifiedAt = new Date().toISOString();
  await prisma.auditEvent.create({
    data: {
      workspaceId,
      actorUserId: user.id,
      action: "PORTAL_ACCESS_CONFIRMED",
      resource: "provider_access_facts",
      resourceId: canonicalAccountId,
      metadata: {
        provider: "google_ads",
        connectionId: connection.id,
        verificationSource: "portal_owner_confirmed",
        verifiedAt,
        facts,
      },
    },
  });

  return NextResponse.json({ ok: true, verifiedAt });
}
