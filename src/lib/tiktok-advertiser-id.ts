/**
 * TikTok Marketing API advertiser IDs are decimal identifiers. Keep this
 * validation at the connector boundary so legacy connection labels and other
 * opaque values can never be sent as `advertiser_id`.
 */
export function normalizeTikTokAdvertiserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  for (const candidate of value) {
    const id = typeof candidate === "string" || typeof candidate === "number"
      ? String(candidate).trim()
      : "";
    if (/^\d+$/.test(id)) ids.add(id);
  }

  return [...ids];
}

export const TIKTOK_ADVERTISER_RECONNECT_MESSAGE =
  "TikTok Ads reconnect required: no valid numeric advertiser IDs were found on this connection.";
