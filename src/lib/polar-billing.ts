import { createHash } from "node:crypto";
import { withDatabaseTenantContext } from "@/lib/database-tenant-context";
import { Polar } from "@polar-sh/sdk";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";
import prisma from "@/lib/prisma";

export type PolarBillingCycle = "monthly" | "annual";

export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER?.trim().toLowerCase() === "production" ? "production" : "sandbox";
}

export function isPolarCheckoutConfigured(): boolean {
  return Boolean(
    process.env.POLAR_ACCESS_TOKEN?.trim() &&
      process.env.POLAR_WEBHOOK_SECRET?.trim() &&
      process.env.POLAR_PRODUCT_ID_PRO_MONTHLY?.trim() &&
      process.env.POLAR_PRODUCT_ID_PRO_ANNUAL?.trim() &&
      process.env.POLAR_PRODUCT_ID_PRO_MONTHLY?.trim() !== process.env.POLAR_PRODUCT_ID_PRO_ANNUAL?.trim(),
  );
}

export function getPolarClient(): Polar {
  const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken) throw new Error("POLAR_ACCESS_TOKEN is not set.");
  return new Polar({ accessToken, server: polarServer() });
}

export function polarProductIdForCycle(cycle: PolarBillingCycle): string {
  return (cycle === "annual"
    ? process.env.POLAR_PRODUCT_ID_PRO_ANNUAL
    : process.env.POLAR_PRODUCT_ID_PRO_MONTHLY) ?? "";
}

function workspaceIdFromSubscription(subscription: Subscription): string | null {
  const workspaceId = subscription.metadata.workspace_id;
  if (typeof workspaceId === "string" && workspaceId.trim()) return workspaceId.trim();
  const externalId = subscription.customer.externalId;
  return typeof externalId === "string" && externalId.trim() ? externalId.trim() : null;
}

function isConfiguredProProduct(productId: string): boolean {
  return [
    process.env.POLAR_PRODUCT_ID_PRO_MONTHLY?.trim(),
    process.env.POLAR_PRODUCT_ID_PRO_ANNUAL?.trim(),
  ].some((configuredId) => Boolean(configuredId) && configuredId === productId);
}

export type PolarSubscriptionEvent = { type: string; data: Subscription };

const subscriptionEvents = new Set([
  "subscription.active", "subscription.updated", "subscription.canceled",
  "subscription.uncanceled", "subscription.revoked", "subscription.past_due",
]);

/** Signed events trigger reconciliation; their snapshots are never entitlement authority. */
export async function reconcilePolarSubscriptionEvent(
  event: PolarSubscriptionEvent,
  options: {
    client?: Pick<typeof prisma, "$transaction">;
    getSubscription?: (id: string) => Promise<Subscription>;
    now?: Date;
  } = {},
): Promise<void> {
  if (!subscriptionEvents.has(event.type)) return;
  const subscriptionId = event.data.id;
  const requestedWorkspace = workspaceIdFromSubscription(event.data);
  if (!requestedWorkspace) throw new Error("Polar subscription is missing workspace metadata.");
  const db = options.client ?? prisma;
  const getSubscription = options.getSubscription ?? ((id: string) =>
    getPolarClient().subscriptions.get({ id }, { timeoutMs: 5000 }));

  await withDatabaseTenantContext(db, requestedWorkspace, async (tx) => {
    // All deliveries for a subscription and all subscriptions for a workspace serialize.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`polar:subscription:${subscriptionId}`}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`polar:workspace:${requestedWorkspace}`}, 0))`;
    const current = await getSubscription(subscriptionId);
    const workspaceId = workspaceIdFromSubscription(current);
    if (current.id !== subscriptionId || workspaceId !== requestedWorkspace ||
        (current.customer.externalId && current.customer.externalId !== workspaceId)) {
      throw new Error("Polar subscription workspace identity does not match.");
    }
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: {
      id: true, status: true, subscriptionProvider: true, subscriptionId: true,
    } });
    if (!workspace) throw new Error("Polar workspace was not found.");

    const stateId = "polar-lifecycle-" + createHash("sha256")
      .update(`${polarServer()}:${subscriptionId}`).digest("hex");
    const existing = await tx.auditEvent.findFirst({ where: { id: stateId, workspaceId }, select: { metadata: true } });
    const wasRevoked = existing?.metadata && typeof existing.metadata === "object" &&
      !Array.isArray(existing.metadata) && existing.metadata.revoked === true;
    // A globally unique binding also prevents a subscription from moving tenants.
    if (!existing) await tx.auditEvent.create({ data: {
      id: stateId, workspaceId, action: "billing.polar.lifecycle", resource: "polar_subscription",
      resourceId: subscriptionId, metadata: { revoked: false },
    } });
    const now = options.now ?? new Date();
    const paidThrough = current.endsAt && current.endsAt < current.currentPeriodEnd
      ? current.endsAt : current.currentPeriodEnd;
    const terminal = event.type === "subscription.revoked" || Boolean(current.endedAt) ||
      current.status === "unpaid" || current.status === "incomplete_expired" ||
      (current.status === "canceled" && !current.cancelAtPeriodEnd);
    const expired = !paidThrough || paidThrough.getTime() <= now.getTime();
    const revoked = Boolean(wasRevoked || terminal);
    const matching = workspace.subscriptionProvider === "polar" && workspace.subscriptionId === subscriptionId;

    if (revoked || expired) {
      if (matching) await tx.workspace.updateMany({
        where: { id: workspaceId, subscriptionProvider: "polar", subscriptionId },
        data: { plan: "free", subscriptionProvider: null, subscriptionId: null, subscriptionEndsAt: null },
      });
    } else if (current.status === "active" || current.status === "trialing") {
      if (workspace.status === "SUSPENDED" ||
          (workspace.subscriptionProvider && !matching)) {
        throw new Error("Polar subscription conflicts with workspace billing or access status.");
      }
      if (!isConfiguredProProduct(current.productId) || current.currency !== "usd") {
        throw new Error("Unrecognized Polar product or currency.");
      }
      const result = await tx.workspace.updateMany({
        where: { id: workspaceId, status: { not: "SUSPENDED" }, OR: [{ subscriptionProvider: null }, { subscriptionProvider: "polar", subscriptionId }] },
        data: { plan: "professional", status: "ACTIVE", subscriptionProvider: "polar", subscriptionId, subscriptionEndsAt: paidThrough },
      });
      if (result.count !== 1) throw new Error("Workspace billing changed during reconciliation.");
    } else if (matching && (current.status === "past_due" || current.status === "canceled")) {
      // Existing access only; a recovery/cancellation event cannot provision a new workspace.
      await tx.workspace.updateMany({
        where: { id: workspaceId, subscriptionProvider: "polar", subscriptionId },
        data: { subscriptionEndsAt: paidThrough },
      });
    }
    await tx.auditEvent.updateMany({ where: { id: stateId, workspaceId }, data: {
      metadata: { revoked, status: current.status, checkedAt: now.toISOString(), productId: current.productId },
    } });
  }, { timeout: 15000 });
}
