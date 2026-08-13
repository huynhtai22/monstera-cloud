import crypto from "crypto";
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
}): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.oAuthAttempt.create({
    data: {
      tokenHash: hashToken(token),
      userId: input.userId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      reconnectConnectionId: input.reconnectConnectionId,
      expiresAt: new Date(Date.now() + TEN_MINUTES_MS),
    },
  });
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
