/**
 * Non-reversible display form for API keys in list/workspace payloads.
 * Full secrets are only returned once on POST /api/settings/api-keys (create).
 */
export function maskApiKey(secret: string, prefix?: string | null): string {
  if (prefix) return `${prefix}••••••`;
  const s = secret.trim();
  if (s.length <= 8) return "••••••••";
  return `${s.slice(0, 3)}••••••••${s.slice(-4)}`;
}

export type PublicApiKeyRow = {
  id: string;
  name: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  keyMasked: string;
  keyPrefix?: string | null;
};

export function toPublicApiKeyRow(k: {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  key: string;
  keyPrefix?: string | null;
}): PublicApiKeyRow {
  return {
    id: k.id,
    name: k.name,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    keyMasked: maskApiKey(k.key, k.keyPrefix ?? null),
    keyPrefix: k.keyPrefix ?? null,
  };
}
