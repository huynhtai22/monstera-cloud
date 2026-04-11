export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Conservative campaign naming normalization:
 * - trims
 * - collapses whitespace
 * - preserves casing (do not destructively lowercase)
 */
export function normalizeCampaignName(name: string): string {
  return normalizeWhitespace(name);
}

/**
 * Normalize common UTM values.
 * Keeps the original if not recognized.
 */
export function normalizeUtmValue(v?: string): string | undefined {
  if (!v) return undefined;
  const s = normalizeWhitespace(v).toLowerCase();

  if (s === 'fb' || s === 'facebook' || s === 'meta') return 'meta';
  if (s === 'ig' || s === 'instagram') return 'instagram';
  if (s === 'gg' || s === 'google') return 'google';
  if (s === 'tt' || s === 'tiktok') return 'tiktok';

  return s;
}

