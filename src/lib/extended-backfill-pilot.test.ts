import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideExtendedBackfill,
  estimatePilotCapacity,
  getProviderPilotEligibility,
  isPilotJobKey,
  createPilotJobKey,
  loadExtendedBackfillPilotConfig,
  normalizePilotAccountId,
  normalizePilotProvider,
  opaqueAccountId,
  pilotJobStageFromKey,
  summarizePilotTelemetry,
  PilotConfigError,
  type ExtendedBackfillPilotConfig,
  type PilotAdmissionFacts,
} from "./extended-backfill-pilot";

const CONFIG: ExtendedBackfillPilotConfig = {
  stage: "staging",
  allowedWorkspaceIds: ["ws-allowed"],
  maxActiveJobsPerWorkspace: 2,
  maxChunksPerJob: 25,
  maxProviderCallsPerDay: 100,
  maxConcurrentChunksPerWorkspace: 4,
  maxConcurrentChunksPerAccount: 2,
};

function facts(overrides: Partial<PilotAdmissionFacts> = {}): PilotAdmissionFacts {
  return {
    workspaceExists: true,
    connectionExists: true,
    workspaceAllowlisted: true,
    activeJobsInWorkspace: 0,
    overlappingActiveJobs: 0,
    plannedChunks: 3,
    providerCallsToday: 0,
    runningChunksWorkspace: 0,
    runningChunksAccount: 0,
    capacity: {
      status: "accept", estimatedRows: 900, estimatedStorageBytes: 9000,
      plannedChunks: 3, assumptions: ["test"], reasonCodes: [],
    },
    ...overrides,
  };
}

describe("pilot configuration (production code)", () => {
  it("defaults to disabled with empty environment", () => {
    const config = loadExtendedBackfillPilotConfig({} as unknown as NodeJS.ProcessEnv);
    assert.equal(config.stage, "disabled");
    assert.deepEqual(config.allowedWorkspaceIds, []);
  });

  it("rejects unknown stages, whitespace, and typos", () => {
    for (const stage of ["STAGING", " staging", "staging ", "prod", "enabled", "true"]) {
      assert.throws(
        () => loadExtendedBackfillPilotConfig({ EXTENDED_BACKFILL_STAGE: stage } as unknown as NodeJS.ProcessEnv),
        PilotConfigError,
      );
    }
    assert.equal(
      loadExtendedBackfillPilotConfig({ EXTENDED_BACKFILL_STAGE: "staging" } as unknown as NodeJS.ProcessEnv).stage,
      "staging",
    );
  });

  it("rejects malformed allowlists without exposing entries", () => {
    for (const list of ["ws-a,,ws-b", "ws-a, ", ",ws-a", "ws-a,  ", "has space"]) {
      assert.throws(
        () => loadExtendedBackfillPilotConfig({ EXTENDED_BACKFILL_ALLOWED_WORKSPACE_IDS: list } as unknown as unknown as NodeJS.ProcessEnv),
        PilotConfigError,
      );
    }
    assert.deepEqual(
      loadExtendedBackfillPilotConfig({ EXTENDED_BACKFILL_ALLOWED_WORKSPACE_IDS: "ws-a,ws-b" } as unknown as unknown as NodeJS.ProcessEnv).allowedWorkspaceIds,
      ["ws-a", "ws-b"],
    );
  });

  it("rejects malformed numeric quotas", () => {
    for (const value of ["0", "-1", "1.5", "many"]) {
      assert.throws(
        () => loadExtendedBackfillPilotConfig({ EXTENDED_BACKFILL_MAX_ACTIVE_JOBS_PER_WORKSPACE: value } as unknown as unknown as NodeJS.ProcessEnv),
        PilotConfigError,
      );
    }
  });

  it("treats blank numeric quotas as unset defaults", () => {
    const config = loadExtendedBackfillPilotConfig({ EXTENDED_BACKFILL_MAX_ACTIVE_JOBS_PER_WORKSPACE: "  " } as unknown as unknown as NodeJS.ProcessEnv);
    assert.equal(config.maxActiveJobsPerWorkspace, 2);
  });
});

describe("provider normalization attacks (production code)", () => {
  it("normalizes case and padding without granting extra access", () => {
    assert.equal(normalizePilotProvider("  Google_Ads "), "google_ads");
    assert.equal(normalizePilotProvider("META_ADS"), "meta_ads");
    assert.equal(getProviderPilotEligibility(normalizePilotProvider("  Google_Ads ")!), getProviderPilotEligibility("google_ads"));
  });

  it("fails closed on aliases, unknown providers, and non-strings", () => {
    for (const input of ["tiktok_ads", "meta", "google", "shopee_ads", "", "   ", 123, null, undefined, {}, ["meta_ads"]]) {
      const normalized = normalizePilotProvider(input);
      assert.ok(!normalized || !getProviderPilotEligibility(normalized), `must not resolve: ${JSON.stringify(input)}`);
    }
  });

  it("rejects numeric account-ID coercion", () => {
    assert.equal(normalizePilotAccountId("12345"), "12345");
    assert.equal(normalizePilotAccountId(""), "");
    for (const input of [12345, 0, true, {}, []]) {
      assert.equal(normalizePilotAccountId(input), null);
    }
  });

  it("keeps Meta/Google eligibility independent", () => {
    const google = getProviderPilotEligibility("google_ads")!;
    const meta = getProviderPilotEligibility("meta_ads")!;
    assert.equal(google.pilotMaxDays, 731);
    assert.equal(meta.pilotMaxDays, 731);
    assert.equal(google.liveEligible, true);
    assert.equal(meta.liveEligible, false);
    assert.equal(meta.stagingEligible, false);
    assert.equal(getProviderPilotEligibility("tiktok_business"), undefined);
    assert.equal(getProviderPilotEligibility("amazon"), undefined);
  });
});

describe("canonical pilot decision (production code)", () => {
  const base = {
    entryPoint: "operator" as const,
    operation: "create" as const,
    provider: "google_ads",
    since: "2024-03-02",
    until: "2024-02-29",
    operatorAuthorized: true,
  };

  function decide(overrides: Record<string, unknown> = {}, factOverrides: Partial<PilotAdmissionFacts> = {}, config = CONFIG) {
    // Note: base range above is intentionally reversed to prove INVALID_DATE_RANGE only in its test;
    // valid-range tests override since/until.
    return decideExtendedBackfill({ ...base, since: "2024-01-01", until: "2024-01-30", ...overrides } as any, config, facts(factOverrides));
  }

  it("allows a fully gated Google request", () => {
    const decision = decide();
    assert.equal(decision.allowed, true);
    assert.equal(decision.reasonCode, "OK");
    assert.equal(decision.requestedDays, 30);
    assert.equal(decision.maximumDays, 731);
    assert.equal(decision.capacityAccepted, true);
  });

  it("rejects customer entry points", () => {
    assert.equal(decide({ entryPoint: "customer" }).reasonCode, "CUSTOMER_ROUTE");
  });

  it("rejects when disabled, plan-only for create, and missing operator", () => {
    assert.equal(decide({}, {}, { ...CONFIG, stage: "disabled" }).reasonCode, "DISABLED");
    assert.equal(decide({}, {}, { ...CONFIG, stage: "plan_only" }).reasonCode, "STAGE_ALLOWS_PLAN_ONLY");
    assert.equal(decide({ operatorAuthorized: false }).reasonCode, "OPERATOR_REQUIRED");
  });

  it("allows planning under plan_only but nothing else", () => {
    const decision = decideExtendedBackfill(
      { entryPoint: "operator", operation: "plan", provider: "google_ads", since: "2024-01-01", until: "2025-12-31", operatorAuthorized: true },
      { ...CONFIG, stage: "plan_only" },
      facts({ plannedChunks: 25 }),
    );
    assert.equal(decision.allowed, true);
    assert.equal(decision.requestedDays, 731);
  });

  it("rejects ineligible providers, bad dates, and over-maximum ranges", () => {
    assert.equal(decide({ provider: "tiktok_business" }).reasonCode, "PROVIDER_INELIGIBLE");
    assert.equal(decide({ provider: "amazon" }).reasonCode, "PROVIDER_INELIGIBLE");
    assert.equal(decide({ provider: "unknown_xyz" }).reasonCode, "PROVIDER_INELIGIBLE");
    assert.equal(decide({ since: "2024-03-02", until: "2024-03-01" }).reasonCode, "INVALID_DATE_RANGE");
    assert.equal(decide({ since: "2024-02-30", until: "2024-03-01" }).reasonCode, "INVALID_DATE_RANGE");
    assert.equal(decide({ since: "2022-02-28", until: "2024-02-29" }).reasonCode, "RANGE_EXCEEDS_PILOT_MAXIMUM");
  });

  it("rejects Meta live execution while allowing synthetic planning", () => {
    const live = decideExtendedBackfill(
      { entryPoint: "operator", operation: "execute", provider: "meta_ads", since: "2024-01-01", until: "2024-02-01", operatorAuthorized: true, executorKind: "live" },
      { ...CONFIG, stage: "production_pilot" },
      facts({ plannedChunks: 2 }),
    );
    assert.equal(live.reasonCode, "PROVIDER_NOT_LIVE_ELIGIBLE");
    const plan = decideExtendedBackfill(
      { entryPoint: "operator", operation: "plan", provider: "meta_ads", since: "2024-01-01", until: "2025-12-31", operatorAuthorized: true },
      { ...CONFIG, stage: "plan_only" },
      facts({ plannedChunks: 25 }),
    );
    assert.equal(plan.allowed, true);
  });

  it("enforces allowlist, overlap, quotas, budgets, and concurrency", () => {
    assert.equal(decide({}, { workspaceAllowlisted: false }).reasonCode, "WORKSPACE_NOT_ALLOWLISTED");
    assert.equal(decide({}, { workspaceExists: false }).reasonCode, "WORKSPACE_NOT_FOUND");
    assert.equal(decide({}, { overlappingActiveJobs: 1 }).reasonCode, "OVERLAPPING_JOB");
    assert.equal(decide({}, { activeJobsInWorkspace: 2 }).reasonCode, "WORKSPACE_QUOTA_EXCEEDED");
    assert.equal(decide({}, { plannedChunks: 26 }).reasonCode, "CHUNK_LIMIT_EXCEEDED");
    assert.equal(decide({}, { providerCallsToday: 99, plannedChunks: 3 }).reasonCode, "PROVIDER_BUDGET_EXCEEDED");
    assert.equal(decide({}, { runningChunksWorkspace: 4 }).reasonCode, "WORKSPACE_CONCURRENCY_EXCEEDED");
    assert.equal(decide({}, { runningChunksAccount: 2 }).reasonCode, "ACCOUNT_CONCURRENCY_EXCEEDED");
  });

  it("fails closed on unknown capacity but surfaces warn as accepted", () => {
    const unknown = { status: "unknown" as const, estimatedRows: null, estimatedStorageBytes: null, plannedChunks: 3, assumptions: ["x"], reasonCodes: ["NO_RATE_BASIS"] };
    assert.equal(decide({}, { capacity: unknown }).reasonCode, "CAPACITY_UNKNOWN");
    const rejected = { status: "reject" as const, estimatedRows: 1, estimatedStorageBytes: 1, plannedChunks: 3, assumptions: [] as string[], reasonCodes: ["ROW_BUDGET"] };
    assert.equal(decide({}, { capacity: rejected }).reasonCode, "CAPACITY_REJECTED");
    const warn = { status: "warn" as const, estimatedRows: 1, estimatedStorageBytes: 1, plannedChunks: 3, assumptions: [] as string[], reasonCodes: ["ROW_BUDGET_WARN"] };
    const accepted = decide({}, { capacity: warn });
    assert.equal(accepted.allowed, true);
    assert.equal(accepted.capacityAccepted, true);
  });
});

describe("capacity estimator (production code)", () => {
  const limits = { maxChunksPerJob: 25, maxEstimatedRows: 100000 as number | null };

  it("accepts measured inputs with explicit assumptions", () => {
    const decision = estimatePilotCapacity({
      provider: "google_ads", requestedDays: 731, plannedChunks: 25,
      observedRowsPerDay: 50, existingScopeRows: 5000, activeJobs: 0, activeChunks: 0,
      bytesPerRow: 512, limits,
    });
    assert.equal(decision.status, "accept");
    assert.equal(decision.estimatedRows, 36550);
    assert.equal(decision.estimatedStorageBytes, 36550 * 512);
    assert.ok(decision.assumptions.length >= 2);
  });

  it("rejects chunk over-budget and unknown rate basis", () => {
    const over = estimatePilotCapacity({
      provider: "google_ads", requestedDays: 731, plannedChunks: 26,
      observedRowsPerDay: 100, existingScopeRows: 0, activeJobs: 0, activeChunks: 0,
      bytesPerRow: 512, limits,
    });
    assert.equal(over.status, "reject");
    const unknown = estimatePilotCapacity({
      provider: "google_ads", requestedDays: 30, plannedChunks: 1,
      observedRowsPerDay: null, existingScopeRows: 5000, activeJobs: 0, activeChunks: 0,
      bytesPerRow: 512, limits,
    });
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.estimatedRows, null);
  });

  it("warns near budget and withholds storage without calibration", () => {
    const warn = estimatePilotCapacity({
      provider: "google_ads", requestedDays: 800, plannedChunks: 25,
      observedRowsPerDay: 100, existingScopeRows: 0, activeJobs: 0, activeChunks: 0,
      bytesPerRow: null, limits,
    });
    assert.equal(warn.status, "warn");
    assert.equal(warn.estimatedStorageBytes, null);
  });
});

describe("pilot keys and telemetry (production code)", () => {
  it("creates deterministic stage-bound keys", () => {
    const opts = { workspaceId: "ws", provider: "google_ads", connectionId: "c", accountId: "", since: "2024-01-01", until: "2026-01-01", stage: "staging" as const };
    assert.equal(createPilotJobKey(opts), createPilotJobKey(opts));
    assert.ok(createPilotJobKey(opts).startsWith("xbpilot:staging:"));
    assert.notEqual(createPilotJobKey(opts), createPilotJobKey({ ...opts, stage: "synthetic" }));
    assert.equal(isPilotJobKey(createPilotJobKey(opts)), true);
    assert.equal(isPilotJobKey("oauth-initial:c"), false);
    assert.equal(isPilotJobKey(null), false);
    assert.equal(pilotJobStageFromKey(createPilotJobKey(opts)), "staging");
    assert.equal(pilotJobStageFromKey("xbpilot:bogus:abc"), null);
  });

  it("keeps telemetry bounded with opaque accounts and no secrets", () => {
    const summary = summarizePilotTelemetry({
      workspaceId: "ws", jobId: "job", provider: "google_ads", accountId: "12345",
      requestedRange: { since: "2024-01-01", until: "2026-01-01" },
      effectiveRange: { since: "2024-01-01", until: "2026-01-01" },
      plannedChunks: 25, claimedChunks: 25, completedChunks: 25, failedChunks: 0,
      partialChunks: 0, cancelledChunks: 0, rowsWritten: 100, durationMs: 1000,
      retryCount: 2, providerCalls: 27, rateLimitedResponses: 1,
      estimatedRows: 90, terminalStatus: "completed", reasonCode: "OK",
    });
    assert.ok(!JSON.stringify(summary).includes("12345"));
    assert.ok(summary.opaqueAccount.startsWith("acct_"));
    assert.equal(summary.rowsWritten, 100);
    assert.deepEqual(summary.capacityEstimateVsActual, { estimated: 90, actual: 100 });
    assert.equal(Object.keys(summary).length, 20);
  });

  it("hashes empty accounts to the connection marker", () => {
    assert.equal(opaqueAccountId(""), "connection");
  });
});
