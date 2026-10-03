/**
 * Authoritative Fixture Ledger for Agent Console C0 baselines.
 * Serves as the reproducible test ledger across C0 through C7 packages.
 */

import { buildCanonicalAccountId } from "../roster";
import type { RecoveryAuthorizationPolicy, InteractiveRecoveryApproval } from "../authority";

export interface GoldenDatasetRecord {
  date: string;
  provider: string;
  accountId: string;
  canonicalId: string;
  currency: string;
  timezone: string;
  spend: number;
  conversions: number;
  expectedCpa: number | null;
  revenue: number | null;
  expectedRoas: number | null;
}

export const GOLDEN_TIKTOK_DATASET: readonly GoldenDatasetRecord[] = [
  { date: "2026-09-20", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 150.00, conversions: 10, expectedCpa: 15.00, revenue: null, expectedRoas: null },
  { date: "2026-09-21", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 200.00, conversions: 8, expectedCpa: 25.00, revenue: null, expectedRoas: null },
  { date: "2026-09-22", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 180.00, conversions: 12, expectedCpa: 15.00, revenue: null, expectedRoas: null },
  { date: "2026-09-23", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 220.00, conversions: 11, expectedCpa: 20.00, revenue: null, expectedRoas: null },
  { date: "2026-09-24", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 190.00, conversions: 10, expectedCpa: 19.00, revenue: null, expectedRoas: null },
  { date: "2026-09-25", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 210.00, conversions: 14, expectedCpa: 15.00, revenue: null, expectedRoas: null },
  { date: "2026-09-26", provider: "tiktok_business", accountId: "tt_adv_101", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_101"), currency: "USD", timezone: "America/New_York", spend: 250.00, conversions: 10, expectedCpa: 25.00, revenue: null, expectedRoas: null },
];

export const GOLDEN_TIKTOK_WINDOW_TOTALS = {
  window: { since: "2026-09-20", until: "2026-09-26", daysCount: 7 },
  totalSpend: 1400.00,
  totalConversions: 75,
  exactCpa: 1400 / 75,
  displayCpa: 18.67,
};

export const ZERO_CONVERSION_SCENARIO: readonly GoldenDatasetRecord[] = [
  { date: "2026-09-20", provider: "tiktok_business", accountId: "tt_adv_102", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_102"), currency: "USD", timezone: "America/New_York", spend: 150.00, conversions: 0, expectedCpa: null, revenue: null, expectedRoas: null },
  { date: "2026-09-21", provider: "tiktok_business", accountId: "tt_adv_102", canonicalId: buildCanonicalAccountId("tiktok_business", "conn_tt_1", "tt_adv_102"), currency: "USD", timezone: "America/New_York", spend: 200.00, conversions: 0, expectedCpa: null, revenue: null, expectedRoas: null },
];

export const ZERO_CONVERSION_WINDOW_TOTALS = {
  totalSpend: 350.00,
  totalConversions: 0,
  cpa: null,
  cpaReason: "ZERO_DENOMINATOR_SPEND_WITHOUT_CONVERSIONS",
};

export const POLICY_FIXTURES: {
  validPolicy: RecoveryAuthorizationPolicy;
  expiredPolicy: RecoveryAuthorizationPolicy;
  revokedPolicy: RecoveryAuthorizationPolicy;
  validInteractiveApproval: InteractiveRecoveryApproval;
  consumedInteractiveApproval: InteractiveRecoveryApproval;
  expiredInteractiveApproval: InteractiveRecoveryApproval;
} = {
  validPolicy: {
    id: "pol_valid_1",
    workspaceId: "ws_test_1",
    responsibilityId: "resp_test_1",
    authorizingUserId: "user_admin_1",
    authorizingUserRole: "admin",
    scopeRevision: 1,
    scopeHash: "hash_rev_1",
    allowedConnectionIds: ["conn_tt_1"],
    allowedProviderAccountIds: ["tt_adv_101"],
    allowedPairs: [
      {
        provider: "tiktok_business",
        connectionId: "conn_tt_1",
        providerAccountId: "tt_adv_101",
      },
    ],
    maxWindowDays: 14,
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    revokedAt: null,
    createdAt: new Date("2026-09-30T00:00:00Z"),
  },
  expiredPolicy: {
    id: "pol_expired_1",
    workspaceId: "ws_test_1",
    responsibilityId: "resp_test_1",
    authorizingUserId: "user_admin_1",
    authorizingUserRole: "admin",
    scopeRevision: 1,
    scopeHash: "hash_rev_1",
    allowedConnectionIds: ["conn_tt_1"],
    allowedProviderAccountIds: ["tt_adv_101"],
    allowedPairs: [
      {
        provider: "tiktok_business",
        connectionId: "conn_tt_1",
        providerAccountId: "tt_adv_101",
      },
    ],
    maxWindowDays: 14,
    expiresAt: new Date("2026-09-29T00:00:00Z"), // Expired yesterday
    revokedAt: null,
    createdAt: new Date("2026-09-15T00:00:00Z"),
  },
  revokedPolicy: {
    id: "pol_revoked_1",
    workspaceId: "ws_test_1",
    responsibilityId: "resp_test_1",
    authorizingUserId: "user_admin_1",
    authorizingUserRole: "admin",
    scopeRevision: 1,
    scopeHash: "hash_rev_1",
    allowedConnectionIds: ["conn_tt_1"],
    allowedProviderAccountIds: ["tt_adv_101"],
    allowedPairs: [
      {
        provider: "tiktok_business",
        connectionId: "conn_tt_1",
        providerAccountId: "tt_adv_101",
      },
    ],
    maxWindowDays: 14,
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    revokedAt: new Date("2026-09-30T10:00:00Z"), // Explicitly revoked
    createdAt: new Date("2026-09-30T00:00:00Z"),
  },
  validInteractiveApproval: {
    approvalId: "appr_valid_1",
    workspaceId: "ws_test_1",
    proposalHash: "prop_hash_1",
    approverUserId: "user_admin_1",
    approverRole: "admin",
    operationId: "op_rec_1",
    evidenceFingerprint: "ev_fp_1",
    policyRevision: 1,
    approvedAt: new Date("2026-09-30T12:00:00Z"),
    expiresAt: new Date("2026-10-15T00:00:00Z"),
    isSingleUseConsumed: false,
  },
  consumedInteractiveApproval: {
    approvalId: "appr_consumed_1",
    workspaceId: "ws_test_1",
    proposalHash: "prop_hash_1",
    approverUserId: "user_admin_1",
    approverRole: "admin",
    operationId: "op_rec_1",
    evidenceFingerprint: "ev_fp_1",
    policyRevision: 1,
    approvedAt: new Date("2026-09-30T12:00:00Z"),
    expiresAt: new Date("2026-10-01T12:00:00Z"),
    isSingleUseConsumed: true,
  },
  expiredInteractiveApproval: {
    approvalId: "appr_expired_1",
    workspaceId: "ws_test_1",
    proposalHash: "prop_hash_1",
    approverUserId: "user_admin_1",
    approverRole: "admin",
    operationId: "op_rec_1",
    evidenceFingerprint: "ev_fp_1",
    policyRevision: 1,
    approvedAt: new Date("2026-09-28T12:00:00Z"),
    expiresAt: new Date("2026-09-29T12:00:00Z"),
    isSingleUseConsumed: false,
  },
};
