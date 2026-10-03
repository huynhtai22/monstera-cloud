import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSOLE_TOOL_REGISTRY,
  validateToolInvocation,
  ToolExecutionError,
  CalendarDateSchema,
  IsoCurrencySchema,
  IanaTimezoneSchema,
} from "./tools";
import {
  canPerformAction,
  validateRecoveryAuthorization,
  consumeInteractiveRecoveryApproval,
  type AuthorityContext,
} from "./authority";
import {
  evaluateProviderCapability,
  isProviderLiveCertified,
} from "./capabilities";
import {
  validateScopeAgainstRoster,
  buildCanonicalAccountId,
  type ExpectedAccountRoster,
} from "./roster";
import {
  evaluateCheckTiming,
  isEvidenceExpired,
} from "./retention-slo";
import {
  GOLDEN_TIKTOK_DATASET,
  GOLDEN_TIKTOK_WINDOW_TOTALS,
  ZERO_CONVERSION_SCENARIO,
  ZERO_CONVERSION_WINDOW_TOTALS,
  POLICY_FIXTURES,
} from "./fixtures/ledger";

test("C0 exit gate: all registered tools have complete contract definitions", () => {
  const expectedTools = [
    "inspect_source",
    "query_coverage",
    "query_metric_window",
    "submit_recovery_import",
    "read_import_outcome",
    "verify_coverage",
    "draft_internal_report",
  ];

  for (const name of expectedTools) {
    const tool = CONSOLE_TOOL_REGISTRY[name];
    assert.ok(tool, `Tool ${name} must be registered`);
    assert.equal(tool.name, name);
    assert.ok(tool.description.length > 0, "Tool must have description");
    assert.ok(["read", "mutate_warehouse_job", "draft"].includes(tool.category), "Tool category must be valid");
    assert.ok(tool.requiredPermission, "Tool must require specific permission");
    assert.equal(tool.outcomeEvidenceRequired, true, "Every tool must require outcome evidence");
    assert.ok(tool.rollbackOwner.length > 0, "Tool must specify rollback owner");
    assert.ok(tool.failureBehavior.length > 0, "Tool must specify failure behavior");
    assert.ok(tool.timeoutMs > 0, "Tool must have positive timeout");
    assert.ok(tool.maxRetries >= 1, "Tool must have max retries configured");
    assert.ok(tool.inputSchema, "Tool must have input schema");
    assert.ok(tool.outputSchema, "Tool must have output schema");
  }

  const toolNames = Object.keys(CONSOLE_TOOL_REGISTRY);
  assert.equal(toolNames.length, 7, "Registry must contain exactly the 7 certified tools");
  assert.ok(!toolNames.includes("mutate_campaign"));
  assert.ok(!toolNames.includes("mutate_budget"));
  assert.ok(!toolNames.includes("execute_sql"));
  assert.ok(!toolNames.includes("execute_shell"));
});

test("C0 capability modes: unverified providers cannot produce certified live claims in live_production mode", () => {
  // In live_production mode, unverified provider is blocked
  const liveResult = evaluateProviderCapability("tiktok_business", "query_metric_window", {
    executionMode: "live_production",
    metricNames: ["spend", "conversions"],
  });
  assert.equal(liveResult.allowed, false);
  assert.ok(liveResult.blockers.includes("CHECK_UNAVAILABLE"));
  assert.match(liveResult.reason || "", /not certified for live production claims/);

  // In local_test mode, synthetic evaluation is permitted for unit fixtures
  const testResult = evaluateProviderCapability("tiktok_business", "query_metric_window", {
    executionMode: "local_test",
    metricNames: ["spend", "conversions"],
  });
  assert.equal(testResult.allowed, true);
  assert.equal(testResult.isSyntheticTest, true);
  assert.equal(testResult.blockers.length, 0);

  // Checking live certification status
  assert.equal(isProviderLiveCertified("tiktok_business"), false);
});

test("C0 tool invocation validator: derives provider and metrics from input and rejects mismatches/unsupported metrics", () => {
  const baseAuth: AuthorityContext = {
    role: "admin",
    userId: "user_1",
    workspaceId: "ws_1",
    isWorkspaceMember: true,
  };

  // 1. Valid invocation with local_test mode
  const validCall = validateToolInvocation(
    "query_metric_window",
    {
      workspaceId: "ws_1",
      provider: "tiktok_business",
      accountIds: ["tt_adv_101"],
      since: "2026-09-20",
      until: "2026-09-26",
      metrics: ["spend", "conversions"],
      expectedCurrency: "USD",
      expectedTimezone: "America/New_York",
    },
    baseAuth,
    { executionMode: "local_test" },
  );
  assert.equal(validCall.tool.name, "query_metric_window");
  assert.equal(validCall.validatedInput.provider, "tiktok_business");

  // 2. Missing required timezone throws ToolExecutionError with TIMEZONE_UNKNOWN
  assert.throws(() => {
    validateToolInvocation(
      "query_metric_window",
      {
        workspaceId: "ws_1",
        provider: "tiktok_business",
        accountIds: ["tt_adv_101"],
        since: "2026-09-20",
        until: "2026-09-26",
        metrics: ["spend"],
        expectedCurrency: "USD",
        // expectedTimezone omitted!
      },
      baseAuth,
      { executionMode: "local_test" },
    );
  }, (err: Error) => {
    return err instanceof ToolExecutionError && err.qualityCodes.includes("TIMEZONE_UNKNOWN");
  });

  // 3. Provider mismatch between call context and input payload throws ToolExecutionError
  assert.throws(() => {
    validateToolInvocation(
      "query_metric_window",
      {
        workspaceId: "ws_1",
        provider: "tiktok_business",
        accountIds: ["tt_adv_101"],
        since: "2026-09-20",
        until: "2026-09-26",
        metrics: ["spend"],
        expectedCurrency: "USD",
      },
      baseAuth,
      { executionMode: "local_test", explicitProvider: "meta_ads" }, // mismatch!
    );
  }, (err: Error) => {
    return err instanceof ToolExecutionError && err.message.includes("Provider mismatch");
  });

  // 3. Unsupported metric (e.g. roas on shopee) throws ToolExecutionError
  assert.throws(() => {
    validateToolInvocation(
      "query_metric_window",
      {
        workspaceId: "ws_1",
        provider: "shopee",
        accountIds: ["shop_101"],
        since: "2026-09-20",
        until: "2026-09-26",
        metrics: ["roas"], // unsupported on Shopee
        expectedCurrency: "VND",
      },
      baseAuth,
      { executionMode: "local_test" },
    );
  }, (err: Error) => {
    return err instanceof ToolExecutionError && err.qualityCodes.includes("METRIC_UNSUPPORTED");
  });
});

test("C0 calendar date and range validation: rejects impossible dates, non-leap year Feb 29, and reversed ranges", () => {
  // Valid calendar dates
  assert.ok(CalendarDateSchema.safeParse("2026-09-30").success);
  assert.ok(CalendarDateSchema.safeParse("2024-02-29").success); // 2024 is a leap year

  // Invalid calendar dates
  assert.equal(CalendarDateSchema.safeParse("2026-02-29").success, false); // 2026 is NOT a leap year
  assert.equal(CalendarDateSchema.safeParse("2026-02-30").success, false);
  assert.equal(CalendarDateSchema.safeParse("2026-04-31").success, false); // April has 30 days
  assert.equal(CalendarDateSchema.safeParse("2026-13-01").success, false); // Month 13

  // Currency validation
  assert.ok(IsoCurrencySchema.safeParse("USD").success);
  assert.ok(IsoCurrencySchema.safeParse("EUR").success);
  assert.equal(IsoCurrencySchema.safeParse("XYZ").success, false); // Unknown/nonexistent currency code rejected
  assert.equal(IsoCurrencySchema.safeParse("usd").success, false); // lowercase rejected
  assert.equal(IsoCurrencySchema.safeParse("USDT").success, false); // 4 letters rejected
  assert.equal(IsoCurrencySchema.safeParse("123").success, false);

  // Timezone validation
  assert.ok(IanaTimezoneSchema.safeParse("America/New_York").success);
  assert.ok(IanaTimezoneSchema.safeParse("Asia/Ho_Chi_Minh").success);
  assert.ok(IanaTimezoneSchema.safeParse("UTC").success);
  assert.equal(IanaTimezoneSchema.safeParse("Mars/Olympus").success, false);
  assert.equal(IanaTimezoneSchema.safeParse("Invalid/Zone").success, false);

  // Reversed date ranges (since > until)
  const baseAuth: AuthorityContext = {
    role: "admin",
    userId: "user_1",
    workspaceId: "ws_1",
    isWorkspaceMember: true,
  };

  assert.throws(() => {
    validateToolInvocation(
      "query_metric_window",
      {
        workspaceId: "ws_1",
        provider: "tiktok_business",
        accountIds: ["tt_adv_101"],
        since: "2026-09-26", // later than until
        until: "2026-09-20",
        metrics: ["spend"],
        expectedCurrency: "USD",
      },
      baseAuth,
      { executionMode: "local_test" },
    );
  });
});

test("C0 roster semantics: validates namespaced canonical IDs, partitions, and rejects empty/omitted scopes", () => {
  const canonId1 = buildCanonicalAccountId("tiktok_business", "conn_1", "acc_101");
  const canonId2 = buildCanonicalAccountId("tiktok_business", "conn_1", "acc_102");

  const validRoster: ExpectedAccountRoster = {
    workspaceId: "ws_1",
    responsibilityId: "resp_1",
    revision: 1,
    accounts: [
      {
        canonicalId: canonId1,
        connectionId: "conn_1",
        providerAccountId: "acc_101",
        provider: "tiktok_business",
        accountName: "Main TikTok Account",
        currency: "USD",
        timezone: "America/New_York",
        status: "active",
      },
      {
        canonicalId: canonId2,
        connectionId: "conn_1",
        providerAccountId: "acc_102",
        provider: "tiktok_business",
        accountName: "Secondary TikTok Account",
        currency: "USD",
        timezone: "America/New_York",
        status: "active",
      },
    ],
    authorizedPartitions: {
      primary_only: [canonId1],
    },
    confirmedAt: "2026-09-30T12:00:00Z",
    confirmedByUserId: "user_1",
    primaryCurrency: "USD",
    primaryTimezone: "America/New_York",
  };

  // 1. Empty scope rejected
  const emptyResult = validateScopeAgainstRoster(validRoster, []);
  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.blockers.includes("ACCOUNT_MISSING"));
  assert.match(emptyResult.reasons[0], /cannot be empty or omitted/);

  // 2. Whitespace-only scope rejected
  const whitespaceResult = validateScopeAgainstRoster(validRoster, ["   "]);
  assert.equal(whitespaceResult.valid, false);
  assert.ok(whitespaceResult.blockers.includes("ACCOUNT_MISSING"));

  // 3. Complete roster equality: querying all roster accounts passes
  const canonicalResult = validateScopeAgainstRoster(validRoster, [canonId1, canonId2]);
  assert.equal(canonicalResult.valid, true);
  assert.deepEqual(canonicalResult.resolvedCanonicalIds, [canonId1, canonId2]);

  // Partial query omitting canonId2 without authorized partition fails full roster equality
  const partialResult = validateScopeAgainstRoster(validRoster, [canonId1]);
  assert.equal(partialResult.valid, false);
  assert.ok(partialResult.blockers.includes("ACCOUNT_MISSING"));
  assert.match(partialResult.reasons[0], /complete roster equality/);

  // 4. Authorized partition check: query inside partition passes
  const partitionPass = validateScopeAgainstRoster(validRoster, [canonId1], {
    authorizedPartitionKey: "primary_only",
  });
  assert.equal(partitionPass.valid, true);

  // 5. Authorized partition check: query outside partition fails
  const partitionFail = validateScopeAgainstRoster(validRoster, [canonId2], {
    authorizedPartitionKey: "primary_only",
  });
  assert.equal(partitionFail.valid, false);
  assert.ok(partitionFail.blockers.includes("ACCOUNT_MISSING"));
  assert.match(partitionFail.reasons[0], /outside authorized partition/);

  // 6. Ambiguous unqualified account ID across distinct connections rejected
  const ambiguousRoster: ExpectedAccountRoster = {
    ...validRoster,
    accounts: [
      validRoster.accounts[0],
      {
        ...validRoster.accounts[1],
        connectionId: "conn_2",
        providerAccountId: "acc_101", // Duplicate ID on different connection!
        canonicalId: buildCanonicalAccountId("tiktok_business", "conn_2", "acc_101"),
      },
    ],
  };
  const ambiguousResult = validateScopeAgainstRoster(ambiguousRoster, [validRoster.accounts[0].canonicalId]);
  assert.equal(ambiguousResult.valid, false);
  assert.ok(ambiguousResult.blockers.includes("DUPLICATE_ACCOUNT"));

  // 7. Namespaced duplicate account detection: same account ID across different providers does NOT collide
  const multiProviderRoster: ExpectedAccountRoster = {
    ...validRoster,
    accounts: [
      validRoster.accounts[0],
      {
        canonicalId: buildCanonicalAccountId("meta_ads", "conn_meta_1", "acc_101"),
        connectionId: "conn_meta_1",
        providerAccountId: "acc_101", // Same account ID as tiktok_business, but different provider!
        provider: "meta_ads",
        accountName: "Meta Account with same ID",
        currency: "USD",
        timezone: "America/New_York",
        status: "active",
      },
    ],
  };
  const multiProviderResult = validateScopeAgainstRoster(multiProviderRoster, [
    validRoster.accounts[0].canonicalId,
    buildCanonicalAccountId("meta_ads", "conn_meta_1", "acc_101"),
  ]);
  assert.equal(multiProviderResult.valid, true);
  assert.equal(multiProviderResult.blockers.includes("DUPLICATE_ACCOUNT"), false);
});

test("C0 recovery authorization: separates interactive approval from unattended policy and enforces contextual rechecks", () => {
  const now = new Date("2026-09-30T12:00:00Z");

  // 1. Non-workspace member is rejected unconditionally
  const nonMemberResult = canPerformAction("submit_data_recovery", {
    role: "admin",
    userId: "user_ext",
    workspaceId: "ws_test_1",
    isWorkspaceMember: false, // NOT a member
  });
  assert.equal(nonMemberResult.allowed, false);
  assert.match(nonMemberResult.reason || "", /not an active member/);

  // 2. Valid unattended recovery policy passes
  const validPolicyContext: AuthorityContext = {
    role: "system_worker",
    userId: "worker_1",
    workspaceId: "ws_test_1",
    isWorkspaceMember: true,
    unattendedPolicy: POLICY_FIXTURES.validPolicy,
    authorizingUserCurrentRole: "admin", // Admin authorizer still active
    targetResponsibilityId: "resp_test_1",
    currentScopeRevision: 1,
    currentScopeHash: "hash_rev_1",
    targetProvider: "tiktok_business",
    targetConnectionId: "conn_tt_1",
    targetProviderAccountId: "tt_adv_101",
    targetWindowDays: 7,
    currentTime: now,
  };
  assert.equal(validateRecoveryAuthorization(validPolicyContext).allowed, true);

  // 3. Expired unattended policy is rejected
  const expiredPolicyContext: AuthorityContext = {
    ...validPolicyContext,
    unattendedPolicy: POLICY_FIXTURES.expiredPolicy,
  };
  const expiredResult = validateRecoveryAuthorization(expiredPolicyContext);
  assert.equal(expiredResult.allowed, false);
  assert.match(expiredResult.reason || "", /expired/);

  // 4. Revoked unattended policy is rejected
  const revokedPolicyContext: AuthorityContext = {
    ...validPolicyContext,
    unattendedPolicy: POLICY_FIXTURES.revokedPolicy,
  };
  const revokedResult = validateRecoveryAuthorization(revokedPolicyContext);
  assert.equal(revokedResult.allowed, false);
  assert.match(revokedResult.reason || "", /revoked/);

  // 5. Authorizing user role demoted (lost admin/owner status) rejects policy
  const demotedAuthorizerContext: AuthorityContext = {
    ...validPolicyContext,
    authorizingUserCurrentRole: "viewer", // Demoted to viewer!
  };
  const demotedResult = validateRecoveryAuthorization(demotedAuthorizerContext);
  assert.equal(demotedResult.allowed, false);
  assert.match(demotedResult.reason || "", /lost admin\/owner role/);

  // 6. Responsibility ID mismatch rejects policy
  const responsibilityMismatchContext: AuthorityContext = {
    ...validPolicyContext,
    targetResponsibilityId: "resp_forged",
  };
  const respMismatchResult = validateRecoveryAuthorization(responsibilityMismatchContext);
  assert.equal(respMismatchResult.allowed, false);
  assert.match(respMismatchResult.reason || "", /does not match authorized policy responsibility/);

  // 7. Scope revision mismatch (responsibility scope was updated) rejects policy
  const revisionMismatchContext: AuthorityContext = {
    ...validPolicyContext,
    currentScopeRevision: 2, // Policy was approved for revision 1!
  };
  const revisionResult = validateRecoveryAuthorization(revisionMismatchContext);
  assert.equal(revisionResult.allowed, false);
  assert.match(revisionResult.reason || "", /Scope revision mismatch/);

  // 8. Scope hash mismatch rejects policy
  const hashMismatchContext: AuthorityContext = {
    ...validPolicyContext,
    currentScopeHash: "hash_rev_modified",
  };
  const hashResult = validateRecoveryAuthorization(hashMismatchContext);
  assert.equal(hashResult.allowed, false);
  assert.match(hashResult.reason || "", /Scope hash mismatch/);

  // 9. Target window exceeds authorized max window days
  const wideWindowContext: AuthorityContext = {
    ...validPolicyContext,
    targetWindowDays: 30, // Policy allows max 14 days
  };
  const wideResult = validateRecoveryAuthorization(wideWindowContext);
  assert.equal(wideResult.allowed, false);
  assert.match(wideResult.reason || "", /not exceed authorized maximum/);

  // 10. Non-positive window days (0 or negative) is rejected
  const zeroWindowContext: AuthorityContext = {
    ...validPolicyContext,
    targetWindowDays: 0,
  };
  const zeroWindowResult = validateRecoveryAuthorization(zeroWindowContext);
  assert.equal(zeroWindowResult.allowed, false);
  assert.match(zeroWindowResult.reason || "", /must be positive/);

  // 11. Unauthorized provider/connection/account pair is rejected
  const unauthorizedPairContext: AuthorityContext = {
    ...validPolicyContext,
    targetProviderAccountId: "tt_adv_999", // Not authorized
  };
  const unauthPairResult = validateRecoveryAuthorization(unauthorizedPairContext);
  assert.equal(unauthPairResult.allowed, false);
  assert.match(unauthPairResult.reason || "", /pair.*is not authorized in recovery policy/);

  // 12. Unattended policy: missing mandatory target context is rejected
  const missingTargetContext: AuthorityContext = {
    ...validPolicyContext,
    targetConnectionId: undefined, // Omitted mandatory target connection
  };
  const missingTargetResult = validateRecoveryAuthorization(missingTargetContext);
  assert.equal(missingTargetResult.allowed, false);
  assert.match(missingTargetResult.reason || "", /mandatory for unattended recovery/);

  // 13. Interactive approval: valid passes when exact proposal hash, operation ID, evidence fingerprint, and policy revision match
  const validApprovalContext: AuthorityContext = {
    role: "admin",
    userId: "user_admin_1",
    workspaceId: "ws_test_1",
    isWorkspaceMember: true,
    isInteractiveUser: true,
    interactiveApproval: POLICY_FIXTURES.validInteractiveApproval,
    targetProposalHash: "prop_hash_1",
    targetOperationId: "op_rec_1",
    targetEvidenceFingerprint: "ev_fp_1",
    targetPolicyRevision: 1,
    currentTime: now,
  };
  assert.equal(validateRecoveryAuthorization(validApprovalContext).allowed, true);

  // 14. Interactive approval: workspace mismatch is rejected
  const workspaceMismatchContext: AuthorityContext = {
    ...validApprovalContext,
    workspaceId: "ws_other_tenant",
  };
  const wsMismatchResult = validateRecoveryAuthorization(workspaceMismatchContext);
  assert.equal(wsMismatchResult.allowed, false);
  assert.match(wsMismatchResult.reason || "", /workspace mismatch/);

  // 15. Interactive approval: missing target context is rejected
  const missingApprovalContext: AuthorityContext = {
    ...validApprovalContext,
    targetEvidenceFingerprint: undefined,
  };
  const missingApprResult = validateRecoveryAuthorization(missingApprovalContext);
  assert.equal(missingApprResult.allowed, false);
  assert.match(missingApprResult.reason || "", /mandatory for interactive recovery approval/);

  // 16. Interactive approval: mismatching proposal hash is rejected
  const mismatchedHashContext: AuthorityContext = {
    ...validApprovalContext,
    targetProposalHash: "forged_proposal_hash",
  };
  const mismatchResult = validateRecoveryAuthorization(mismatchedHashContext);
  assert.equal(mismatchResult.allowed, false);
  assert.match(mismatchResult.reason || "", /proposal hash does not match/);

  // 17. Interactive approval: mismatching evidence fingerprint is rejected
  const mismatchedEvidenceContext: AuthorityContext = {
    ...validApprovalContext,
    targetEvidenceFingerprint: "ev_fp_tampered",
  };
  const mismatchEvResult = validateRecoveryAuthorization(mismatchedEvidenceContext);
  assert.equal(mismatchEvResult.allowed, false);
  assert.match(mismatchEvResult.reason || "", /evidence fingerprint does not match/);

  // 18. Interactive approval: mismatching policy revision is rejected
  const mismatchedRevContext: AuthorityContext = {
    ...validApprovalContext,
    targetPolicyRevision: 99,
  };
  const mismatchRevResult = validateRecoveryAuthorization(mismatchedRevContext);
  assert.equal(mismatchRevResult.allowed, false);
  assert.match(mismatchRevResult.reason || "", /policy revision does not match/);

  // 19. Interactive approval: already consumed is rejected
  const consumedApprovalContext: AuthorityContext = {
    ...validApprovalContext,
    interactiveApproval: POLICY_FIXTURES.consumedInteractiveApproval,
  };
  const consumedResult = validateRecoveryAuthorization(consumedApprovalContext);
  assert.equal(consumedResult.allowed, false);
  assert.match(consumedResult.reason || "", /already been consumed/);

  // 20. Interactive approval: expired is rejected
  const expiredApprovalContext: AuthorityContext = {
    ...validApprovalContext,
    interactiveApproval: POLICY_FIXTURES.expiredInteractiveApproval,
  };
  const expiredApprResult = validateRecoveryAuthorization(expiredApprovalContext);
  assert.equal(expiredApprResult.allowed, false);
  assert.match(expiredApprResult.reason || "", /expired/);

  // 21. Atomic single-use consumption: consumeInteractiveRecoveryApproval
  const freshApproval = { ...POLICY_FIXTURES.validInteractiveApproval };
  const consumed = consumeInteractiveRecoveryApproval(freshApproval);
  assert.equal(consumed.isSingleUseConsumed, true);
  assert.throws(() => consumeInteractiveRecoveryApproval(consumed), /already been consumed/);
  assert.throws(() => consumeInteractiveRecoveryApproval(POLICY_FIXTURES.expiredInteractiveApproval), /expired/);
});

test("C0 timing boundary evaluation: tests exact 60m threshold vs 61m delay", () => {
  const slot = new Date("2026-09-30T10:00:00Z");

  // Exactly 60 minutes: NOT delayed (within threshold)
  const exact60 = new Date("2026-09-30T11:00:00Z");
  const eval60 = evaluateCheckTiming(slot, exact60);
  assert.equal(eval60.delayMinutes, 60);
  assert.equal(eval60.isDelayed, false);

  // 61 minutes: DELAYED
  const delayed61 = new Date("2026-09-30T11:01:00Z");
  const eval61 = evaluateCheckTiming(slot, delayed61);
  assert.equal(eval61.delayMinutes, 61);
  assert.equal(eval61.isDelayed, true);

  // Retention boundary: 180 days
  const checkNow = new Date("2026-09-30T12:00:00Z");
  const day179 = new Date(checkNow.getTime() - 179 * 24 * 60 * 60 * 1000);
  const day181 = new Date(checkNow.getTime() - 181 * 24 * 60 * 60 * 1000);

  assert.equal(isEvidenceExpired(day179, checkNow), false);
  assert.equal(isEvidenceExpired(day181, checkNow), true);
});

test("C0 fixture calculations: golden dataset reproduction and zero denominator safety", () => {
  const spendTotal = GOLDEN_TIKTOK_DATASET.reduce((sum, r) => sum + r.spend, 0);
  const convTotal = GOLDEN_TIKTOK_DATASET.reduce((sum, r) => sum + r.conversions, 0);

  assert.equal(spendTotal, GOLDEN_TIKTOK_WINDOW_TOTALS.totalSpend);
  assert.equal(convTotal, GOLDEN_TIKTOK_WINDOW_TOTALS.totalConversions);

  const calculatedCpa = spendTotal / convTotal;
  assert.equal(calculatedCpa, GOLDEN_TIKTOK_WINDOW_TOTALS.exactCpa);
  assert.equal(Math.round(calculatedCpa * 100) / 100, GOLDEN_TIKTOK_WINDOW_TOTALS.displayCpa);

  const zeroConvSpend = ZERO_CONVERSION_SCENARIO.reduce((sum, r) => sum + r.spend, 0);
  const zeroConvCount = ZERO_CONVERSION_SCENARIO.reduce((sum, r) => sum + r.conversions, 0);
  assert.equal(zeroConvSpend, ZERO_CONVERSION_WINDOW_TOTALS.totalSpend);
  assert.equal(zeroConvCount, 0);
  assert.equal(ZERO_CONVERSION_WINDOW_TOTALS.cpa, null);
  assert.equal(ZERO_CONVERSION_WINDOW_TOTALS.cpaReason, "ZERO_DENOMINATOR_SPEND_WITHOUT_CONVERSIONS");
});
