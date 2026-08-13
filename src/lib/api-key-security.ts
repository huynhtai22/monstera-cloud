import crypto from "crypto";
import prisma from "@/lib/prisma";

const KEY_PREFIX = "mc_live_";

export function hashApiKey(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function generateApiKey(): {
  secret: string;
  keyHash: string;
  keyPrefix: string;
  keyLastFour: string;
} {
  const secret = `${KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return {
    secret,
    keyHash: hashApiKey(secret),
    keyPrefix: KEY_PREFIX,
    keyLastFour: secret.slice(-4),
  };
}

export async function resolveApiKey(secret: string) {
  const keyHash = hashApiKey(secret);
  const current = await prisma.apiKey.findFirst({
    where: { keyHash, revokedAt: null },
    include: { workspace: true },
  });
  return current;
}

export function publicApiKeyRow(key: {
  id: string;
  name: string;
  keyPrefix: string | null;
  keyLastFour: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: key.id,
    name: key.name,
    keyMasked: key.keyPrefix && key.keyLastFour
      ? `${key.keyPrefix}••••••••${key.keyLastFour}`
      : "legacy key — rotate required",
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
  };
}
