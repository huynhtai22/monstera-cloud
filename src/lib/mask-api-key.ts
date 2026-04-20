/**
 * Non-reversible display form for API keys in list/workspace payloads.
 * Full secrets are only returned once on POST /api/settings/api-keys (create).
 */
export function maskApiKey(secret: string): string {
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
};

export function toPublicApiKeyRow(k: {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  key: string;
}): PublicApiKeyRow {
  return {
    id: k.id,
    name: k.name,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    keyMasked: maskApiKey(k.key),
  };
}
