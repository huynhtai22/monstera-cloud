import crypto from "crypto";

/**
 * Deterministic SHA-256 hash for API key storage.
 * API keys are high-entropy (256-bit random), so a fast hash is sufficient.
 */
export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** First 8 characters for UI display. */
export function getKeyPrefix(raw: string): string {
  return raw.slice(0, 8);
}

/**
 * Verify an incoming raw API key against the database.
 * Tries hash lookup first, falls back to plaintext for backward compat during transition.
 */
export async function verifyApiKey(
  prisma: any,
  rawKey: string
): Promise<{
  id: string;
  key: string;
  name: string;
  workspaceId: string;
  lastUsedAt: Date | null;
  workspace: { id: string; ownerId: string };
} | null> {
  const hash = hashApiKey(rawKey);

  let record = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    include: { workspace: { select: { id: true, ownerId: true } } },
  });

  if (!record) {
    // Fallback: old plaintext keys during transition period
    record = await prisma.apiKey.findUnique({
      where: { key: rawKey },
      include: { workspace: { select: { id: true, ownerId: true } } },
    });
  }

  return record;
}
