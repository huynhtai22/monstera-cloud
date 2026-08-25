export type AccountSelectionProvider = "meta_ads" | "google_ads" | "tiktok_business";

type CredentialsRecord = Record<string, unknown>;

function record(value: unknown): CredentialsRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as CredentialsRecord
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function accountIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const itemRecord = record(item);
    return typeof itemRecord.id === "string" ? [itemRecord.id] : [];
  });
}

/** Return exactly the accounts originally disclosed by this connection's OAuth flow. */
export function authorizedConnectionAccountIds(
  provider: AccountSelectionProvider,
  credentialsValue: unknown,
): string[] {
  const credentials = record(credentialsValue);
  const extraFields = record(credentials.extraFields);
  if (provider === "meta_ads") {
    return [
      ...accountIds(extraFields.adAccounts),
      ...accountIds(credentials.adAccounts),
      ...stringArray(extraFields.adAccountIds),
      ...stringArray(credentials.adAccountIds),
    ];
  }
  if (provider === "google_ads") {
    return [
      ...stringArray(extraFields.customerIds),
      ...stringArray(credentials.customerIds),
    ];
  }
  return [
    ...stringArray(extraFields.advertiserIds),
    ...stringArray(credentials.advertiserIds),
  ];
}

/** Normalize only display representation; this never invents an account ID. */
export function normalizeConnectionAccountId(
  provider: AccountSelectionProvider,
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return provider === "google_ads" ? trimmed.replace(/-/g, "") : trimmed;
}

export type AccountSelectionValidation =
  | { ok: true; selectedIds: string[] }
  | { ok: false; error: "invalid_selection" | "unavailable_account" };

/**
 * Validate a user selection against encrypted credential metadata before it is
 * persisted. We return the stored canonical ID so Google display dashes cannot
 * create a second identity.
 */
export function validateConnectionAccountSelection(input: {
  provider: AccountSelectionProvider;
  selectedIds: unknown;
  authorizedIds: unknown;
}): AccountSelectionValidation {
  if (!Array.isArray(input.selectedIds)) return { ok: false, error: "invalid_selection" };

  const authorizedByNormalizedId = new Map<string, string>();
  for (const id of stringArray(input.authorizedIds)) {
    const normalized = normalizeConnectionAccountId(input.provider, id);
    if (normalized && !authorizedByNormalizedId.has(normalized)) {
      authorizedByNormalizedId.set(normalized, id);
    }
  }

  const selectedIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of input.selectedIds) {
    const normalized = normalizeConnectionAccountId(input.provider, rawId);
    if (!normalized) return { ok: false, error: "invalid_selection" };
    const canonicalId = authorizedByNormalizedId.get(normalized);
    if (!canonicalId) return { ok: false, error: "unavailable_account" };
    if (!seen.has(canonicalId)) {
      seen.add(canonicalId);
      selectedIds.push(canonicalId);
    }
  }

  return { ok: true, selectedIds };
}
