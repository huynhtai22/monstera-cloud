import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { OAuthError } from "@/lib/oauth-framework/types";

const TEN_MINUTES_MS = 10 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function isOAuthAttemptValid<T extends { provider: string; userId: string; consumedAt: Date | null; expiresAt: Date }>(
  attempt: T | null,
  input: { provider: string; sessionUserId?: string | null },
  now = new Date(),
): attempt is T {
  return Boolean(
    attempt &&
    attempt.provider === input.provider &&
    !attempt.consumedAt &&
    attempt.expiresAt > now &&
    (!input.sessionUserId || attempt.userId === input.sessionUserId),
  );
}

export function oauthAttemptCookieName(provider: string): string {
  return `monstera_oauth_${provider.replace(/[^a-z0-9_-]/gi, "_")}`;
}

export async function createOAuthAttempt(input: {
  userId: string;
  workspaceId: string;
  provider: string;
  reconnectConnectionId?: string;
  agentTaskId?: string;
}): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const data = { tokenHash: hashToken(token), userId: input.userId, workspaceId: input.workspaceId, provider: input.provider, reconnectConnectionId: input.reconnectConnectionId, agentTaskId: input.agentTaskId, expiresAt: new Date(Date.now() + TEN_MINUTES_MS) };
  if (input.agentTaskId) {
    const { validateAgentOAuthTask } = await import("@/lib/agent/execution");
    await validateAgentOAuthTask({ userId: input.userId, workspaceId: input.workspaceId }, input.agentTaskId, input.provider);
    await prisma.$transaction(async tx => {
      // The fallback cookie is provider-specific: invalidate prior pending
      // onboarding consent for this actor/provider before replacing it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.userId}), hashtext(${input.provider}))`;
      await tx.oAuthAttempt.updateMany({ where: { userId: input.userId, workspaceId: input.workspaceId, provider: input.provider, consumedAt: null, agentTaskId: { not: null } }, data: { expiresAt: new Date() } });
      const { requireAgentRun, assertRunWritable } = await import("@/lib/agent/scope");
      const { appendAgentEvent } = await import("@/lib/agent/events");
      const task = await tx.agentTask.findFirstOrThrow({ where: { id: input.agentTaskId, workspaceId: input.workspaceId } });
      const run = await requireAgentRun(tx, { userId: input.userId, workspaceId: input.workspaceId }, task.runId, true);
      assertRunWritable(run.status);
      if (task.confirmedScope || !["waiting_authorization", "needs_attention"].includes(task.state)) throw new OAuthError("invalid_state", "Task cannot start authorization", input.provider);
      // Connect another account is an explicit reset of unconfirmed discovery.
      await tx.agentTaskConnection.deleteMany({ where: { workspaceId: input.workspaceId, taskId: task.id } });
      await tx.agentTask.update({ where: { workspaceId_id: { workspaceId: input.workspaceId, id: task.id } }, data: { state: "waiting_authorization", reasonCode: null, requestedScope: Prisma.DbNull, version: { increment: 1 } } });
      await appendAgentEvent(tx, { workspaceId: input.workspaceId, runId: run.id, taskId: task.id, type: "authorization_started", payload: { provider: input.provider } });
      await tx.oAuthAttempt.create({ data });
    });
  } else await prisma.oAuthAttempt.create({ data });
  return token;
}

export async function consumeOAuthAttempt(input: {
  token: string;
  provider: string;
  sessionUserId?: string | null;
}) {
  const tokenHash = hashToken(input.token);

  return prisma.$transaction(async (tx) => {
    const attempt = await tx.oAuthAttempt.findUnique({ where: { tokenHash } });
    if (!isOAuthAttemptValid(attempt, input)) {
      throw new OAuthError("invalid_state", "OAuth attempt is invalid, expired, or already used", input.provider);
    }

    const consumed = await tx.oAuthAttempt.updateMany({
      where: { id: attempt.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new OAuthError("invalid_state", "OAuth attempt has already been used", input.provider);
    }
    return attempt;
  });
}
