import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireWorkspaceAccess, toRbacResponse } from "@/lib/rbac";
import { unassignClientProviderAccount } from "@/lib/client-account-assignment";

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
      operation: "unassign_client_account",
    });

    const body = await req.json().catch(() => ({}));
    const { provider, accountId } = body;

    if (!provider || !accountId) {
      return NextResponse.json(
        { error: "provider and accountId are required" },
        { status: 400 },
      );
    }

    const result = await unassignClientProviderAccount({
      workspaceId,
      provider,
      accountId,
      actorUserId: session.user.id,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const rbac = toRbacResponse(error);
    if (rbac) return rbac;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to unassign account" },
      { status: 500 },
    );
  }
}
