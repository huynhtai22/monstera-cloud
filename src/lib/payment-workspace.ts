import prisma from "@/lib/prisma";
import { canPurchaseAgencyPro } from "./public-plan-catalog";

/** A payment must apply to exactly one tenant, never every workspace a user owns. */
export class PaymentWorkspaceError extends Error {
  constructor(
    message: string,
    readonly statusCode: 403 | 409 = 403,
  ) {
    super(message);
    this.name = "PaymentWorkspaceError";
  }
}

/** Never silently replace a different paid tier with an unquoted Pro order. */
export async function requireSelfServeAgencyPro(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true, status: true, subscriptionProvider: true, subscriptionEndsAt: true },
  });
  if (!workspace || !canPurchaseAgencyPro(workspace.plan, workspace.status, { provider: workspace.subscriptionProvider, endsAt: workspace.subscriptionEndsAt })) {
    throw new PaymentWorkspaceError("This workspace needs a billing review before changing plans. Contact support.", 409);
  }
}

export async function resolveBillableWorkspaceId(input: {
  userId: string;
  requestedWorkspaceId?: string;
}): Promise<string> {
  const requestedWorkspaceId = input.requestedWorkspaceId?.trim();

  if (requestedWorkspaceId) {
    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: requestedWorkspaceId, userId: input.userId, role: "owner" },
      select: { workspaceId: true },
    });
    if (!membership) {
      throw new PaymentWorkspaceError("Only the workspace owner can start payment for this workspace.");
    }
    return membership.workspaceId;
  }

  const owned = await prisma.workspaceMember.findMany({
    where: { userId: input.userId, role: "owner" },
    orderBy: { workspace: { updatedAt: "desc" } },
    take: 2,
    select: { workspaceId: true },
  });
  if (owned.length === 1) return owned[0].workspaceId;
  if (owned.length === 0) {
    throw new PaymentWorkspaceError("Create or become the owner of a workspace before starting payment.");
  }
  throw new PaymentWorkspaceError(
    "Select the workspace to upgrade from its billing settings.",
    409,
  );
}
