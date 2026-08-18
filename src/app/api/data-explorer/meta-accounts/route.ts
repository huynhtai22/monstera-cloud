import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { safeDecrypt } from "@/lib/encryption";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";

/**
 * GET /api/data-explorer/meta-accounts?connectionId=
 * Returns ad accounts stored on the Meta connection (from OAuth), no token exposure.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const connectionId = searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const conn = await prisma.connection.findFirst({
    where: { id: connectionId, provider: "meta_ads" },
    select: { id: true, name: true, credentials: true, workspaceId: true },
  });

  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId: conn.workspaceId,
      minimumRole: "viewer",
      operation: "list_meta_connection_accounts",
    });
  } catch (error) {
    return toRbacResponse(error) ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const creds = JSON.parse(safeDecrypt(conn.credentials)) as {
    adAccounts?: Array<{ id: string; name?: string; currency?: string }>;
    adAccountIds?: string[];
  };

  const accounts =
    creds.adAccounts?.map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      currency: a.currency ?? "USD",
    })) ??
    (creds.adAccountIds ?? []).map((id) => ({ id, name: id, currency: "USD" }));

  return NextResponse.json({ connectionId: conn.id, connectionName: conn.name, accounts });
}
