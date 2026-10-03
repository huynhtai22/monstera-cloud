import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { reminderCampaigns } from "./console-feature-campaigns";
import { reminderHistory, reminderSetupReady, selectReminder } from "./console-reminder-frequency";

/** Identity-level history intentionally spans workspaces; every workspace read is membership-scoped. */
export async function claimConsoleReminder(db: PrismaClient, userId: string, sessionId: string, workspaceId: string, now = new Date()) {
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  return db.$transaction(async tx => {
    // Serialize competing tabs/devices on the authenticated identity, before eligibility/history reads.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const membership = await tx.workspaceMember.findFirst({ where: { userId, workspaceId }, select: { role: true, workspace: { select: { plan: true } } } });
    if (!membership) return null;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { consoleReminderHistory: true, workProfileAnsweredAt: true } });
    const latestRun = await tx.agentRun.findFirst({ where: { workspaceId, initiatorUserId: userId, kind: "onboarding" }, orderBy: { createdAt: "desc" }, select: { status: true, reviewedAt: true } });
    const stored = latestRun || user.workProfileAnsweredAt || membership.role === "viewer" ? null : await tx.campaignMetric.findFirst({ where: { workspaceId }, select: { id: true } });
    const history = reminderHistory(user.consoleReminderHistory);
    const campaign = selectReminder({ campaigns: reminderCampaigns, history, sessionHash, now, role: membership.role, plan: membership.workspace.plan, setupReady: reminderSetupReady(Boolean(user.workProfileAnsweredAt), membership.role, latestRun, Boolean(stored)) });
    if (!campaign) return null;
    // Reserve before returning. A lost response may suppress a message, but can never spam a retry.
    await tx.user.update({ where: { id: userId }, data: { consoleReminderHistory: [...history, { campaignId: campaign.id, sessionHash, shownAt: now.toISOString() }] } });
    return { id: campaign.id, highlights: campaign.highlights };
  });
}
