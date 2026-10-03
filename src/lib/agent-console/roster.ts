import { z } from "zod";
import type { QualityGateCode } from "./capabilities";
import { IsoCurrencySchema, IanaTimezoneSchema } from "./tools";

export function buildCanonicalAccountId(provider: string, connectionId: string, providerAccountId: string): string {
  return `${provider.trim()}:${connectionId.trim()}:${providerAccountId.trim()}`;
}

export const ExpectedAccountSchema = z.object({
  canonicalId: z.string().trim().min(1),
  connectionId: z.string().trim().min(1),
  providerAccountId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  accountName: z.string().trim().min(1),
  currency: IsoCurrencySchema,
  timezone: IanaTimezoneSchema,
  status: z.enum(["active", "revoked", "suspended", "unconfirmed"]),
}).strict();
export type ExpectedAccount = z.infer<typeof ExpectedAccountSchema>;

export const ExpectedAccountRosterSchema = z.object({
  workspaceId: z.string().trim().min(1),
  responsibilityId: z.string().trim().min(1),
  revision: z.number().int().nonnegative(),
  accounts: z.array(ExpectedAccountSchema).min(1),
  authorizedPartitions: z.record(z.string(), z.array(z.string().trim().min(1))).optional(),
  confirmedAt: z.string().datetime(),
  confirmedByUserId: z.string().trim().min(1),
  primaryCurrency: IsoCurrencySchema,
  primaryTimezone: IanaTimezoneSchema,
}).strict();
export type ExpectedAccountRoster = z.infer<typeof ExpectedAccountRosterSchema>;

export interface RosterValidationResult {
  valid: boolean;
  blockers: QualityGateCode[];
  reasons: string[];
  resolvedCanonicalIds?: string[];
}

export interface ValidateScopeOptions {
  authorizedPartitionKey?: string;
}

/**
 * Validates that an evaluation scope strictly matches the frozen expected account roster or an authorized partition.
 * Blocks execution if:
 * - Scope is empty or omitted (ACCOUNT_MISSING)
 * - Roster is missing or empty (ROSTER_UNCONFIRMED)
 * - Any account in the query scope is missing from the roster or authorized partition (ACCOUNT_MISSING)
 * - Roster contains mixed currencies across accounts (CURRENCY_CONFLICT)
 * - Roster contains mixed timezones without an explicit split (TIMEZONE_CONFLICT)
 * - Multiple connections provide the same provider account ID (DUPLICATE_ACCOUNT)
 */
export function validateScopeAgainstRoster(
  roster: ExpectedAccountRoster | null | undefined,
  queriedIdentifiers: readonly string[],
  options: ValidateScopeOptions = {},
): RosterValidationResult {
  const blockers: QualityGateCode[] = [];
  const reasons: string[] = [];

  // 1. Reject empty or omitted scope
  const cleanQueried = queriedIdentifiers.map(s => s?.trim()).filter(Boolean);
  if (!cleanQueried.length) {
    return {
      valid: false,
      blockers: ["ACCOUNT_MISSING"],
      reasons: ["Queried account scope cannot be empty or omitted"],
    };
  }

  // 2. Reject missing or unconfirmed roster
  if (!roster || !roster.accounts || !roster.accounts.length) {
    return {
      valid: false,
      blockers: ["ROSTER_UNCONFIRMED"],
      reasons: ["No confirmed expected account roster exists for this responsibility"],
    };
  }

  // 3. Detect duplicate provider account IDs across distinct connections (namespaced by provider)
  const seenAccounts = new Map<string, string>();
  for (const acc of roster.accounts) {
    const namespacedKey = `${acc.provider}:${acc.providerAccountId}`;
    if (seenAccounts.has(namespacedKey) && seenAccounts.get(namespacedKey) !== acc.connectionId) {
      blockers.push("DUPLICATE_ACCOUNT");
      reasons.push(`Duplicate connection mapping for ${acc.provider} account ID ${acc.providerAccountId}`);
      break;
    }
    seenAccounts.set(namespacedKey, acc.connectionId);
  }

  // 4. Resolve queried identifiers (either canonical 'provider:connectionId:providerAccountId' or unqualified 'providerAccountId')
  const resolvedCanonicalIds: string[] = [];
  const rosterById = new Map<string, ExpectedAccount>();
  const rosterByProviderAccountId = new Map<string, ExpectedAccount[]>();

  for (const acc of roster.accounts) {
    rosterById.set(acc.canonicalId, acc);
    const list = rosterByProviderAccountId.get(acc.providerAccountId) || [];
    list.push(acc);
    rosterByProviderAccountId.set(acc.providerAccountId, list);
  }

  // Check partition if specified
  let partitionAllowedIds: Set<string> | null = null;
  if (options.authorizedPartitionKey) {
    const partition = roster.authorizedPartitions?.[options.authorizedPartitionKey];
    if (!partition || partition.length === 0) {
      blockers.push("ACCOUNT_MISSING");
      reasons.push(`Authorized partition '${options.authorizedPartitionKey}' not found or empty in roster`);
    } else {
      partitionAllowedIds = new Set(partition);
    }
  }

  for (const queryId of cleanQueried) {
    let matchedAcc: ExpectedAccount | undefined;

    if (queryId.includes(":")) {
      // Namespaced canonical ID
      matchedAcc = rosterById.get(queryId);
    } else {
      // Unqualified ID
      const matches = rosterByProviderAccountId.get(queryId) || [];
      if (matches.length > 1) {
        blockers.push("DUPLICATE_ACCOUNT");
        reasons.push(`Ambiguous unqualified account ID '${queryId}' matches multiple connections`);
        continue;
      }
      matchedAcc = matches[0];
    }

    if (!matchedAcc) {
      blockers.push("ACCOUNT_MISSING");
      reasons.push(`Account '${queryId}' is not present in the confirmed roster`);
      continue;
    }

    if (partitionAllowedIds && !partitionAllowedIds.has(matchedAcc.canonicalId)) {
      blockers.push("ACCOUNT_MISSING");
      reasons.push(`Account '${matchedAcc.canonicalId}' is outside authorized partition '${options.authorizedPartitionKey}'`);
      continue;
    }

    resolvedCanonicalIds.push(matchedAcc.canonicalId);
  }

  // 5. Enforce full equality: verify no account in expected roster/partition was omitted
  if (partitionAllowedIds) {
    const omittedFromPartition = Array.from(partitionAllowedIds).filter(id => !resolvedCanonicalIds.includes(id));
    if (omittedFromPartition.length > 0) {
      blockers.push("ACCOUNT_MISSING");
      reasons.push(`Scope does not satisfy complete partition equality (missing accounts: ${omittedFromPartition.join(", ")})`);
    }
  } else {
    // Complete roster equality is strictly enforced unless an explicitly persisted authorized partition applies
    const allRosterIds = roster.accounts.map(a => a.canonicalId);
    const omittedFromRoster = allRosterIds.filter(id => !resolvedCanonicalIds.includes(id));
    if (omittedFromRoster.length > 0) {
      blockers.push("ACCOUNT_MISSING");
      reasons.push(`Scope does not satisfy complete roster equality (missing accounts: ${omittedFromRoster.join(", ")})`);
    }
  }

  // 6. Detect currency conflicts across evaluated accounts
  const evaluatedAccounts = roster.accounts.filter(a => resolvedCanonicalIds.includes(a.canonicalId));
  const currencies = new Set(evaluatedAccounts.map(a => a.currency));
  if (currencies.size > 1) {
    blockers.push("CURRENCY_CONFLICT");
    reasons.push(`Conflicting currencies detected across accounts: ${Array.from(currencies).join(", ")}`);
  }

  // 6. Detect timezone conflicts across evaluated accounts
  const timezones = new Set(evaluatedAccounts.map(a => a.timezone));
  if (timezones.size > 1) {
    blockers.push("TIMEZONE_CONFLICT");
    reasons.push(`Conflicting timezones detected across accounts: ${Array.from(timezones).join(", ")}`);
  }

  // 7. Check if any evaluated account is marked revoked or suspended
  const inactiveAccounts = evaluatedAccounts.filter(a => a.status !== "active");
  if (inactiveAccounts.length > 0) {
    blockers.push("DATA_STALE");
    reasons.push(`Roster accounts have inactive/revoked status: ${inactiveAccounts.map(a => a.canonicalId).join(", ")}`);
  }

  return {
    valid: blockers.length === 0,
    blockers: [...new Set(blockers)],
    reasons,
    resolvedCanonicalIds,
  };
}
