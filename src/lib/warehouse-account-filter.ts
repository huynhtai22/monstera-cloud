/**
 * Provider-aware account filtering for Warehouse queries and aggregates.
 *
 * Rules:
 *   1. For explicitly Meta-only queries, 12345 and act_12345 are equivalent.
 *   2. For explicitly non-Meta queries (Google, TikTok, Shopee, etc.), account IDs
 *      are used exactly as supplied; act_ is never added.
 *   3. For mixed-platform queries or queries without an explicit platform, raw IDs
 *      apply to any requested provider, while act_ variants are restricted strictly
 *      to platform = "meta_ads" via a qualified predicate.
 *   4. Existing client assignment OR clauses must never be overwritten; compound
 *      predicates are safely composed with AND.
 */

export interface AccountFilterOptions {
  accountIds?: string[] | null;
  accountId?: string | null;
  platforms?: string[] | null;
  platform?: string | null;
}

export type AccountFilterPredicate =
  | { accountId: string | { in: string[] } }
  | {
      OR: [
        { accountId: string | { in: string[] } },
        { platform: "meta_ads"; accountId: string | { in: string[] } }
      ];
    };

export function buildAccountFilterPredicate(
  opts: AccountFilterOptions
): AccountFilterPredicate | null {
  const rawList = opts.accountIds?.length
    ? opts.accountIds
    : opts.accountId
      ? [opts.accountId]
      : [];

  const rawIds = Array.from(
    new Set(rawList.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean))
  );

  if (rawIds.length === 0) return null;

  const platforms = opts.platforms?.length
    ? opts.platforms
    : opts.platform
      ? [opts.platform]
      : null;

  // Case 1: Explicitly Meta-only query
  if (platforms !== null && platforms.length === 1 && platforms[0] === "meta_ads") {
    const metaIds = new Set<string>();
    for (const id of rawIds) {
      metaIds.add(id);
      if (id.startsWith("act_")) {
        metaIds.add(id.replace(/^act_/, ""));
      } else {
        metaIds.add(`act_${id}`);
      }
    }
    const list = Array.from(metaIds);
    return {
      accountId: list.length === 1 ? list[0] : { in: list },
    };
  }

  // Case 2: Explicitly non-Meta query (Meta is not among platforms)
  if (platforms !== null && !platforms.includes("meta_ads")) {
    return {
      accountId: rawIds.length === 1 ? rawIds[0] : { in: rawIds },
    };
  }

  // Case 3: Mixed platform (contains Meta + other providers) OR no platform specified
  const metaVariants = new Set<string>();
  for (const id of rawIds) {
    if (id.startsWith("act_")) {
      metaVariants.add(id.replace(/^act_/, ""));
    } else {
      metaVariants.add(`act_${id}`);
    }
  }

  const extraMetaVariants = Array.from(metaVariants).filter((id) => !rawIds.includes(id));
  if (extraMetaVariants.length === 0) {
    return {
      accountId: rawIds.length === 1 ? rawIds[0] : { in: rawIds },
    };
  }

  return {
    OR: [
      { accountId: rawIds.length === 1 ? rawIds[0] : { in: rawIds } },
      {
        platform: "meta_ads",
        accountId: extraMetaVariants.length === 1 ? extraMetaVariants[0] : { in: extraMetaVariants },
      },
    ],
  };
}

/**
 * Safely appends an account filter predicate to an existing Prisma where clause.
 * Preserves existing where.OR (e.g. client assignments) by composing into where.AND.
 */
export function appendWherePredicate(
  where: Record<string, any>,
  predicate: AccountFilterPredicate | null
): void {
  if (!predicate) return;

  if ("OR" in predicate || "OR" in where) {
    if (Array.isArray(where.AND)) {
      where.AND.push(predicate);
    } else if (where.AND) {
      where.AND = [where.AND, predicate];
    } else {
      where.AND = [predicate];
    }
    return;
  }

  if (where.accountId) {
    if (Array.isArray(where.AND)) {
      where.AND.push(predicate);
    } else if (where.AND) {
      where.AND = [where.AND, predicate];
    } else {
      where.AND = [predicate];
    }
    return;
  }

  where.accountId = predicate.accountId;
}
