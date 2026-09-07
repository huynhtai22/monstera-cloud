import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeConnectorEvidence } from "./connector-evidence-summary";
import type { ConnectorTelemetryEvent } from "./connector-telemetry";

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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_beta",
        connectionId: "conn_google_1",
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
        workspaceId: "ws_beta",
        connectionId: "conn_google_1",
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
        workspaceId: "ws_alpha",
        jobId: "job_1",
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
        workspaceId: "ws_alpha",
        jobId: "job_1",
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
        workspaceId: "ws_heavy",
        jobId: "job_heavy",
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
        workspaceId: "ws_heavy",
        jobId: "job_heavy",
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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_alpha",
        connectionId: "conn_meta_1",
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
        workspaceId: "ws_beta",
        connectionId: "conn_google_1",
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
    }
  });
});
