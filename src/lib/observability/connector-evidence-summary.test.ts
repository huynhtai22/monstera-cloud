import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeConnectorEvidence, hashWorkspace } from "./connector-evidence-summary";
import { toOpaqueConnectionId, toOpaqueJobId, type ConnectorTelemetryEvent } from "./connector-telemetry";

function freshnessEvent(
  freshnessOutcome: "advanced" | "unchanged" | "degraded",
  contextStatus: "tenant_scoped" | "unbound" = "tenant_scoped",
): ConnectorTelemetryEvent {
  return {
    schemaVersion: "1.0.0",
    eventName: "connector_telemetry",
    eventCategory: "freshness_event",
    provider: "meta_ads",
    operation: "data_through_refresh",
    ...(contextStatus === "tenant_scoped" ? { opaqueWorkspaceId: hashWorkspace("ws_freshness") } : {}),
    contextStatus,
    attempt: 1,
    freshnessOutcome,
    outcome: "success",
    durationMs: 0,
    timestamp: "2026-09-09T12:00:00Z",
  };
}

describe("Connector Evidence Summary Aggregator", () => {
  it("computes comprehensive evidence metrics across providers, queues, leases and workspaces", () => {
    const events: ConnectorTelemetryEvent[] = [
      // Provider requests: Meta (1 initial success, 1 rate limited sequence with 2 retries)
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "insights_fetch",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 1,
        outcome: "success",
        durationMs: 120,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "insights_fetch",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 1,
        outcome: "throttled",
        errorCategory: "rate_limited",
        httpStatus: 429,
        durationMs: 250,
        timestamp: "2026-09-07T12:01:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "insights_fetch",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 2,
        outcome: "throttled",
        errorCategory: "rate_limited",
        httpStatus: 429,
        durationMs: 260,
        timestamp: "2026-09-07T12:01:02Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "insights_fetch",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 3,
        outcome: "success",
        durationMs: 140,
        timestamp: "2026-09-07T12:01:06Z",
      },

      // Google requests (1 auth revoked permanent failure, 1 success)
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "google_ads",
        operation: "search_stream",
        opaqueWorkspaceId: hashWorkspace("ws_beta"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_google_1")!,
        attempt: 1,
        outcome: "permanent_failure",
        errorCategory: "auth_revoked",
        httpStatus: 401,
        durationMs: 80,
        timestamp: "2026-09-07T12:02:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "google_ads",
        operation: "search_stream",
        opaqueWorkspaceId: hashWorkspace("ws_beta"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_google_1")!,
        attempt: 1,
        outcome: "success",
        durationMs: 310,
        timestamp: "2026-09-07T12:02:05Z",
      },

      // Job Lifecycle events
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "job_lifecycle",
        provider: "warehouse_queue",
        operation: "job_claimed",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueJobId: toOpaqueJobId("job_1")!,
        itemCount: 5,
        queueWaitMs: 1200,
        attempt: 1,
        outcome: "success",
        durationMs: 0,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "job_lifecycle",
        provider: "warehouse_queue",
        operation: "job_completed",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueJobId: toOpaqueJobId("job_1")!,
        itemCount: 5,
        completedItemCount: 5,
        attempt: 1,
        outcome: "success",
        durationMs: 3400,
        timestamp: "2026-09-07T12:00:04Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "job_lifecycle",
        provider: "warehouse_queue",
        operation: "job_claimed",
        opaqueWorkspaceId: hashWorkspace("ws_heavy"),
        contextStatus: "tenant_scoped",
        opaqueJobId: toOpaqueJobId("job_heavy")!,
        itemCount: 45,
        queueWaitMs: 4500,
        attempt: 1,
        outcome: "success",
        durationMs: 0,
        timestamp: "2026-09-07T12:05:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "job_lifecycle",
        provider: "warehouse_queue",
        operation: "job_completed",
        opaqueWorkspaceId: hashWorkspace("ws_heavy"),
        contextStatus: "tenant_scoped",
        opaqueJobId: toOpaqueJobId("job_heavy")!,
        itemCount: 45,
        completedItemCount: 40,
        attempt: 1,
        outcome: "partial",
        durationMs: 18500,
        timestamp: "2026-09-07T12:05:22Z",
      },

      // Lease Contention events
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "lease_event",
        provider: "meta_ads",
        operation: "connection_lease_acquire",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 1,
        outcome: "success",
        leaseOutcome: "acquired",
        durationMs: 10,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "lease_event",
        provider: "meta_ads",
        operation: "connection_lease_acquire",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 1,
        outcome: "throttled",
        leaseOutcome: "refused_active",
        durationMs: 5,
        timestamp: "2026-09-07T12:00:01Z",
      },

      // Freshness events
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "freshness_event",
        provider: "meta_ads",
        operation: "data_through_refresh",
        opaqueWorkspaceId: hashWorkspace("ws_alpha"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_meta_1")!,
        attempt: 1,
        freshnessOutcome: "advanced",
        outcome: "success",
        durationMs: 0,
        timestamp: "2026-09-07T12:00:05Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "freshness_event",
        provider: "google_ads",
        operation: "sync_outcome_freshness",
        opaqueWorkspaceId: hashWorkspace("ws_beta"),
        contextStatus: "tenant_scoped",
        opaqueConnectionId: toOpaqueConnectionId("conn_google_1")!,
        attempt: 1,
        freshnessOutcome: "unchanged",
        outcome: "permanent_failure",
        durationMs: 0,
        timestamp: "2026-09-07T12:02:00Z",
      },
    ];

    const summary = summarizeConnectorEvidence(events);

    // Calls by provider
    assert.equal(summary.totalCallsByProvider.meta_ads, 4);
    assert.equal(summary.totalCallsByProvider.google_ads, 2);

    // Throttle rate
    assert.equal(summary.throttleRateByProvider.meta_ads.throttledCalls, 2);
    assert.equal(summary.throttleRateByProvider.meta_ads.throttleRatePct, 50.0);

    // Retry amplification
    assert.equal(summary.retryAmplification.initialRequests, 4);
    assert.equal(summary.retryAmplification.retryAttempts, 2);
    assert.equal(summary.retryAmplification.amplificationRatio, 1.5);

    // Permanent auth failures
    assert.equal(summary.permanentAuthFailures, 1);

    // Queue wait & durations
    assert.equal(summary.queueWaitStats.min, 1200);
    assert.equal(summary.queueWaitStats.max, 4500);
    assert.equal(summary.processingDurationStats.min, 3400);
    assert.equal(summary.processingDurationStats.max, 18500);

    // Item count distribution
    assert.equal(summary.itemCountDistribution.buckets.small, 1);
    assert.equal(summary.itemCountDistribution.buckets.heavy, 1);

    // Lease contention
    assert.equal(summary.leaseContention.acquired, 1);
    assert.equal(summary.leaseContention.refusedActive, 1);

    // Job run outcomes
    assert.equal(summary.jobRunOutcomes.totalJobs, 2);
    assert.equal(summary.jobRunOutcomes.completedSuccess, 1);
    assert.equal(summary.jobRunOutcomes.completedPartial, 1);
    assert.equal(summary.jobRunOutcomes.partialRatePct, 50.0);

    // Freshness advancement
    assert.equal(summary.freshnessAdvancement.advanced, 1);
    assert.equal(summary.freshnessAdvancement.unchanged, 1);
    assert.equal(summary.freshnessAdvancement.advancementRatePct, 50.0);

    // Workspace fairness with opaque IDs
    assert.equal(summary.workspaceFairness.length, 3);
    for (const ws of summary.workspaceFairness) {
      assert.ok(ws.opaqueWorkspaceId.startsWith("ws_opaque_"));
      assert.ok(!ws.opaqueWorkspaceId.includes("ws_alpha"));
      assert.ok(!ws.opaqueWorkspaceId.includes("ws_beta"));
      assert.ok(!ws.opaqueWorkspaceId.includes("ws_heavy"));
      assert.notEqual(ws.opaqueWorkspaceId, "ws_opaque_e3b0c442");
    }
  });

  it("guards against empty workspace hashing and never produces ws_opaque_e3b0c442", () => {
    assert.equal(hashWorkspace(""), "ws_opaque_unspecified");
    assert.equal(hashWorkspace("   \t  "), "ws_opaque_unspecified");
    assert.equal(hashWorkspace(null as any), "ws_opaque_unspecified");
    assert.equal(hashWorkspace(undefined as any), "ws_opaque_unspecified");
    assert.equal(hashWorkspace("ws_unspecified"), "ws_opaque_unspecified");
    assert.equal(hashWorkspace("unknown_workspace"), "ws_opaque_unspecified");

    // Valid workspace produces valid pseudonymous operational identifier
    const hashed = hashWorkspace("ws_real_client_1");
    assert.ok(hashed.startsWith("ws_opaque_"));
    assert.notEqual(hashed, "ws_opaque_e3b0c442");
    assert.notEqual(hashed, "ws_opaque_unspecified");
  });

  it("reports degraded freshness as a distinct result without changing advanced or unchanged", () => {
    const summary = summarizeConnectorEvidence([
      freshnessEvent("advanced"),
      freshnessEvent("unchanged"),
      freshnessEvent("degraded"),
    ]);

    assert.deepEqual(summary.freshnessAdvancement, {
      totalFreshnessEvents: 3,
      advanced: 1,
      unchanged: 1,
      degraded: 1,
      advancementRatePct: 33.3,
    });
  });

  it("keeps unbound degraded events global and preserves an explicit empty summary", () => {
    const unbound = summarizeConnectorEvidence([freshnessEvent("degraded", "unbound")]);
    assert.equal(unbound.freshnessAdvancement.degraded, 1);
    assert.equal(unbound.freshnessAdvancement.unchanged, 0);
    assert.deepEqual(unbound.workspaceFairness, []);

    const empty = summarizeConnectorEvidence([]);
    assert.deepEqual(empty.freshnessAdvancement, {
      totalFreshnessEvents: 0,
      advanced: 0,
      unchanged: 0,
      degraded: 0,
      advancementRatePct: 0,
    });
  });

  it("unbound and missing context events do not contaminate per-workspace fairness calculations", () => {
    const events: ConnectorTelemetryEvent[] = [
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "unbound_fetch",
        opaqueWorkspaceId: hashWorkspace("ws_unspecified"),
        contextStatus: "unbound",
        attempt: 1,
        outcome: "throttled",
        durationMs: 100,
        timestamp: "2026-09-07T12:00:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "job_lifecycle",
        provider: "warehouse_queue",
        operation: "job_completed",
        opaqueWorkspaceId: "",
        contextStatus: "unbound",
        attempt: 1,
        itemCount: 10,
        outcome: "success",
        durationMs: 500,
        timestamp: "2026-09-07T12:00:01Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "scoped_fetch",
        opaqueWorkspaceId: hashWorkspace("ws_real_tenant_alpha"),
        contextStatus: "tenant_scoped",
        attempt: 1,
        outcome: "success",
        durationMs: 200,
        timestamp: "2026-09-07T12:00:02Z",
      },
    ];

    const summary = summarizeConnectorEvidence(events);

    // Global totals include all events
    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.totalCallsByProvider.meta_ads, 2);

    // Workspace fairness includes ONLY the real tenant workspace
    assert.equal(summary.workspaceFairness.length, 1);
    assert.equal(summary.workspaceFairness[0].opaqueWorkspaceId, hashWorkspace("ws_real_tenant_alpha"));
    assert.notEqual(summary.workspaceFairness[0].opaqueWorkspaceId, "ws_opaque_e3b0c442");
    assert.notEqual(summary.workspaceFairness[0].opaqueWorkspaceId, "ws_opaque_unspecified");
  });

  it("counts permanent auth failures truthfully based only on auth_revoked errorCategory", () => {
    const testCases: Array<{
      description: string;
      eventCategory: "provider_request" | "job_lifecycle";
      outcome: "permanent_failure" | "retryable_failure" | "success" | "throttled";
      errorCategory?: "auth_revoked" | "internal_error" | "network_error" | "rate_limited" | "quota_exhausted";
      expectedPermanentAuthFailures: number;
    }> = [
      {
        description: "provider_request permanent_failure + auth_revoked is counted",
        eventCategory: "provider_request",
        outcome: "permanent_failure",
        errorCategory: "auth_revoked",
        expectedPermanentAuthFailures: 1,
      },
      {
        description: "provider_request permanent_failure + internal_error is NOT counted",
        eventCategory: "provider_request",
        outcome: "permanent_failure",
        errorCategory: "internal_error",
        expectedPermanentAuthFailures: 0,
      },
      {
        description: "provider_request permanent_failure + network_error is NOT counted",
        eventCategory: "provider_request",
        outcome: "permanent_failure",
        errorCategory: "network_error",
        expectedPermanentAuthFailures: 0,
      },
      {
        description: "provider_request retryable_failure + auth_revoked is counted",
        eventCategory: "provider_request",
        outcome: "retryable_failure",
        errorCategory: "auth_revoked",
        expectedPermanentAuthFailures: 1,
      },
      {
        description: "provider_request retryable_failure + internal_error is NOT counted",
        eventCategory: "provider_request",
        outcome: "retryable_failure",
        errorCategory: "internal_error",
        expectedPermanentAuthFailures: 0,
      },
      {
        description: "provider_request success is NOT counted",
        eventCategory: "provider_request",
        outcome: "success",
        expectedPermanentAuthFailures: 0,
      },
      {
        description: "provider_request throttled + rate_limited is NOT counted",
        eventCategory: "provider_request",
        outcome: "throttled",
        errorCategory: "rate_limited",
        expectedPermanentAuthFailures: 0,
      },
      {
        description: "job_lifecycle permanent_failure without auth_revoked is NOT counted",
        eventCategory: "job_lifecycle",
        outcome: "permanent_failure",
        errorCategory: "internal_error",
        expectedPermanentAuthFailures: 0,
      },
    ];

    for (const tc of testCases) {
      const event: ConnectorTelemetryEvent = {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: tc.eventCategory,
        provider: "meta_ads",
        operation: tc.eventCategory === "provider_request" ? "insights_fetch" : "job_completed",
        contextStatus: "tenant_scoped",
        opaqueWorkspaceId: hashWorkspace("ws_test"),
        attempt: 1,
        outcome: tc.outcome,
        ...(tc.errorCategory ? { errorCategory: tc.errorCategory } : {}),
        durationMs: 50,
        timestamp: "2026-09-08T12:00:00Z",
      };

      const summary = summarizeConnectorEvidence([event]);
      assert.equal(
        summary.permanentAuthFailures,
        tc.expectedPermanentAuthFailures,
        `Failed for case: ${tc.description}`
      );
    }
  });

  it("truthfully reports supported and unsupported provider request metrics contract", () => {
    // 1. Empty events: instrumented providers report supported: true with 0, uninstrumented report supported: false with nulls
    const emptySummary = summarizeConnectorEvidence([]);

    // Instrumented providers
    for (const p of ["meta_ads", "google_ads", "tiktok_business"] as const) {
      assert.equal(emptySummary.totalCallsByProvider[p], 0);
      assert.deepEqual(emptySummary.throttleRateByProvider[p], {
        supported: true,
        totalCalls: 0,
        throttledCalls: 0,
        throttleRatePct: 0,
      });
    }

    // Uninstrumented providers
    for (const p of ["shopee", "lazada", "warehouse_queue"] as const) {
      assert.equal(emptySummary.totalCallsByProvider[p], null);
      assert.deepEqual(emptySummary.throttleRateByProvider[p], {
        supported: false,
        reason: "provider_request_instrumentation_unavailable",
        totalCalls: null,
        throttledCalls: null,
        throttleRatePct: null,
      });
    }

    // 2. Active events for an instrumented provider
    const activeEvents: ConnectorTelemetryEvent[] = [
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "insights_fetch",
        contextStatus: "tenant_scoped",
        opaqueWorkspaceId: hashWorkspace("ws_test"),
        attempt: 1,
        outcome: "success",
        durationMs: 100,
        timestamp: "2026-09-08T12:00:00Z",
      },
      {
        schemaVersion: "1.0.0",
        eventName: "connector_telemetry",
        eventCategory: "provider_request",
        provider: "meta_ads",
        operation: "insights_fetch",
        contextStatus: "tenant_scoped",
        opaqueWorkspaceId: hashWorkspace("ws_test"),
        attempt: 1,
        outcome: "throttled",
        errorCategory: "rate_limited",
        httpStatus: 429,
        durationMs: 200,
        timestamp: "2026-09-08T12:00:01Z",
      },
    ];

    const activeSummary = summarizeConnectorEvidence(activeEvents);
    assert.equal(activeSummary.totalCallsByProvider.meta_ads, 2);
    assert.deepEqual(activeSummary.throttleRateByProvider.meta_ads, {
      supported: true,
      totalCalls: 2,
      throttledCalls: 1,
      throttleRatePct: 50.0,
    });

    // Uninstrumented providers still report supported: false with nulls
    assert.equal(activeSummary.totalCallsByProvider.shopee, null);
    assert.deepEqual(activeSummary.throttleRateByProvider.shopee, {
      supported: false,
      reason: "provider_request_instrumentation_unavailable",
      totalCalls: null,
      throttledCalls: null,
      throttleRatePct: null,
    });

    // 3. Stable JSON serialization
    const serialized = JSON.stringify(activeSummary);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.totalCallsByProvider.shopee, null);
    assert.equal(parsed.throttleRateByProvider.shopee.supported, false);
    assert.equal(parsed.throttleRateByProvider.shopee.reason, "provider_request_instrumentation_unavailable");
    assert.equal(parsed.throttleRateByProvider.shopee.totalCalls, null);
    assert.equal(parsed.throttleRateByProvider.meta_ads.supported, true);
    assert.equal(parsed.throttleRateByProvider.meta_ads.totalCalls, 2);
  });
});
