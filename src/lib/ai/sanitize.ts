const UNTRUSTED_KEYS = new Set([
  "adName",
  "ad_name",
  "ad",
  "campaignName",
  "campaign_name",
  "campaign",
  "adsetName",
  "adset_name",
  "ad_group",
  "accountName",
  "account_name",
  "lastError",
  "errorMsg",
  "title",
]);

export function wrapUntrusted(source: string, value: string): string {
  return `<untrusted source="${source}">${value}</untrusted>`;
}

export function sanitizeToolResult(data: unknown): unknown {
  return walk(data);
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "rawData") continue;
      if (UNTRUSTED_KEYS.has(key) && typeof child === "string") {
        out[key] = wrapUntrusted(key, child);
        continue;
      }
      out[key] = walk(child);
    }
    return out;
  }
  return value;
}
