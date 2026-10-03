import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import {
  getWorkspaceDiscoveredAccounts,
  assignClientProviderAccount,
  bulkAssignClientProviderAccounts,
} from "@/lib/client-account-assignment";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "viewer",
      operation: "list_client_accounts",
    });

    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    const unassignedOnly = searchParams.get("unassigned") === "true";
    const provider = searchParams.get("provider");
    const search = searchParams.get("search")?.toLowerCase().trim();

    const allDiscovered = await getWorkspaceDiscoveredAccounts(workspaceId);

    let filtered = allDiscovered;

    if (clientId) {
      filtered = filtered.filter((a) => a.assignedClient?.id === clientId);
    } else if (unassignedOnly) {
      filtered = filtered.filter((a) => !a.isAssigned);
    }

    if (provider) {
      filtered = filtered.filter((a) => a.provider === provider);
    }

    if (search) {
      filtered = filtered.filter(
        (a) =>
          a.accountId.toLowerCase().includes(search) ||
          a.accountName.toLowerCase().includes(search) ||
          (a.assignedClient?.name.toLowerCase().includes(search) ?? false) ||
          a.availableConnections.some((c) => c.name.toLowerCase().includes(search)),
      );
    }

    return NextResponse.json({
      accounts: filtered,
      total: filtered.length,
      unassignedCount: allDiscovered.filter((a) => !a.isAssigned).length,
    });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load discovered accounts" },
      { status: 500 },
    );
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: workspaceId } = await context.params;
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    await requireWorkspaceAccess({
      userId: session.user.id,
      workspaceId,
      minimumRole: "member",
      operation: "assign_client_account",
    });

    const body = await req.json().catch(() => ({}));
    const { clientId, provider, accountId, connectionId, items } = body;

    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (Array.isArray(items) && items.length > 0) {
      // Bulk assignment
      const results = await bulkAssignClientProviderAccounts({
        workspaceId,
        clientId,
        items,
        actorUserId: session.user.id,
      });
      return NextResponse.json({ results, count: results.length });
    }

    if (!provider || !accountId || !connectionId) {
      return NextResponse.json(
        { error: "provider, accountId, and connectionId are required" },
        { status: 400 },
      );
    }

    const result = await assignClientProviderAccount({
      workspaceId,
      clientId,
      provider,
      accountId,
      connectionId,
      actorUserId: session.user.id,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to assign account" },
      { status: 500 },
    );
  }
}
