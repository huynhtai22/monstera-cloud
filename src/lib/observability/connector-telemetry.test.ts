import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  emitConnectorTelemetry,
  setTelemetrySink,
  captureTelemetryForTest,
  sanitizeTelemetryEvent,
  toOpaqueAccountId,
  runWithConnectorContext,
} from "./connector-telemetry";
import { installNetworkDenialGuard, restoreNetworkGuard } from "@/lib/connector-resilience/network-denial-guard";
import { ProviderSimulator } from "@/lib/connector-resilience/provider-simulator";
import { setupSyntheticTestEnv } from "@/lib/connector-resilience/test-env";
import { metaReportClient, MetaOAuthRevokedError } from "@/lib/meta-ads";
import { googleAdsReportClient } from "@/lib/google-ads";
import { tiktokReportClient } from "@/lib/tiktok-business";

describe("Connector Telemetry Contract & Provider Instrumentation", () => {
  let simulator: ProviderSimulator;

  beforeEach(() => {
    setupSyntheticTestEnv();
    simulator = new ProviderSimulator();
    installNetworkDenialGuard((url, init) => simulator.handleRequest(url, init));
  });

  afterEach(() => {
    restoreNetworkGuard();
    setTelemetrySink(null);
  });

  it("1. One successful provider request emits the correct bounded event", async () => {
    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_tenant_1", connectionId: "conn_meta_1" },
        async () => {
          const rows = await metaReportClient.getInsights("valid-token", {
            adAccountId: "act_healthy_123",
            fields: ["impressions", "clicks", "spend"],
            level: "campaign",
          });
          assert.ok(rows.length > 0);
        }
      );

      const requestEvents = capture.events.filter(
        (e) => e.provider === "meta_ads" && e.eventCategory === "provider_request"
      );
      assert.ok(requestEvents.length >= 1, "Expected at least 1 provider request event");
      const ev = requestEvents[0];

      assert.equal(ev.schemaVersion, "1.0.0");
      assert.equal(ev.eventName, "connector_telemetry");
      assert.equal(ev.provider, "meta_ads");
      assert.equal(ev.workspaceId, "ws_tenant_1");
      assert.equal(ev.connectionId, "conn_meta_1");
      assert.equal(ev.outcome, "success");
      assert.equal(ev.attempt, 1);
      assert.equal(typeof ev.durationMs, "number");
      assert.ok(ev.durationMs >= 0);
    } finally {
      capture.restore();
    }
  });

  it("2. A retry sequence emits accurate attempts and one final outcome", async () => {
    simulator.setFaults({
      meta: {
        rateLimitAccountIds: new Set(["act_rate_limit_seq"]),
      },
    });

    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_tenant_retry", connectionId: "conn_retry_1" },
        async () => {
          await assert.rejects(async () => {
            await metaReportClient.getInsights("valid-token", {
              adAccountId: "act_rate_limit_seq",
              fields: ["impressions", "clicks", "spend"],
              level: "campaign",
            });
          });
        }
      );

      const attempts = capture.events.filter(
        (e) => e.provider === "meta_ads" && e.eventCategory === "provider_request"
      );
      assert.equal(attempts.length, 4, "Expected exactly 4 retry attempts recorded");
      assert.equal(attempts[0].attempt, 1);
      assert.equal(attempts[1].attempt, 2);
      assert.equal(attempts[2].attempt, 3);
      assert.equal(attempts[3].attempt, 4);

      for (const ev of attempts) {
        assert.equal(ev.outcome, "throttled");
        assert.equal(ev.errorCategory, "rate_limited");
        assert.equal(ev.workspaceId, "ws_tenant_retry");
      }
    } finally {
      capture.restore();
    }
  });

  it("3. Permanent authorization failure is classified as auth_revoked (not throttled)", async () => {
    simulator.setFaults({
      meta: {
        revokedAccountIds: new Set(["act_test_revoked", "test_revoked"]),
      },
    });

    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_auth_test", connectionId: "conn_auth_1" },
        async () => {
          await assert.rejects(
            async () => {
              await metaReportClient.getInsights("revoked-meta-token", {
                adAccountId: "act_test_revoked",
                fields: ["impressions"],
                level: "campaign",
              });
            },
            (err) => err instanceof MetaOAuthRevokedError
          );
        }
      );

      const authEvents = capture.events.filter((e) => e.errorCategory === "auth_revoked");
      assert.ok(authEvents.length >= 1, "Expected auth_revoked error category");
      assert.equal(authEvents[0].outcome, "permanent_failure");
      assert.equal(authEvents[0].errorCategory, "auth_revoked");
      assert.notEqual(authEvents[0].outcome, "throttled");
    } finally {
      capture.restore();
    }
  });

  it("4. Meta throttle utilization is sanitized and bounded [0, 100]", () => {
    const rawNegative = sanitizeTelemetryEvent({
      workspaceId: "ws_1",
      provider: "meta_ads",
      throttleUtilizationPct: -15,
    });
    assert.equal(rawNegative.throttleUtilizationPct, 0);

    const rawOver100 = sanitizeTelemetryEvent({
      workspaceId: "ws_1",
      provider: "meta_ads",
      throttleUtilizationPct: 185,
    });
    assert.equal(rawOver100.throttleUtilizationPct, 100);

    const rawFraction = sanitizeTelemetryEvent({
      workspaceId: "ws_1",
      provider: "meta_ads",
      throttleUtilizationPct: 84.7,
    });
    assert.equal(rawFraction.throttleUtilizationPct, 85);
  });

  it("5. TikTok Retry-After is recorded without changing retry behavior", async () => {
    simulator.setFaults({
      tiktok: {
        rateLimitAdvertiserIds: new Set(["adv_tt_throttle"]),
        retryAfterSeconds: 1,
      },
    });

    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_tiktok_test", connectionId: "conn_tt_1" },
        async () => {
          await assert.rejects(async () => {
            await tiktokReportClient.createTask("valid-tt-token", {
              advertiser_id: "adv_tt_throttle",
              report_type: "BASIC",
              data_level: "AUCTION_CAMPAIGN",
              dimensions: ["campaign_id"],
              metrics: ["spend"],
              start_date: "2026-09-01",
              end_date: "2026-09-07",
            });
          });
        }
      );

      const ttEvents = capture.events.filter((e) => e.provider === "tiktok_business");
      assert.ok(ttEvents.length >= 1, "Expected tiktok telemetry events");
      assert.equal(ttEvents[0].retryAfterSupplied, true);
      assert.equal(ttEvents[0].retryAfterHonored, true);
      assert.equal(ttEvents[0].outcome, "throttled");
      assert.equal(ttEvents[0].errorCategory, "rate_limited");
    } finally {
      capture.restore();
    }
  });

  it("6. Google quota errors are classified consistently as quota_exhausted", async () => {
    simulator.setFaults({
      google: {
        rateLimitCustomerIds: new Set(["cust_google_quota"]),
      },
    });

    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_google_test", connectionId: "conn_google_1" },
        async () => {
          await assert.rejects(async () => {
            await googleAdsReportClient.getCampaignPerformance("valid-tok", "cust_google_quota", "LAST_7_DAYS");
          });
        }
      );

      const googleEvents = capture.events.filter((e) => e.provider === "google_ads");
      assert.ok(googleEvents.length >= 1);
      assert.equal(googleEvents[0].outcome, "throttled");
      assert.equal(googleEvents[0].errorCategory, "quota_exhausted");
    } finally {
      capture.restore();
    }
  });

  it("7. A failed telemetry sink cannot fail an otherwise successful sync", async () => {
    // Install a broken sink that throws synchronously
    setTelemetrySink(() => {
      throw new Error("Telemetry database / network crashed!");
    });

    await assert.doesNotReject(async () => {
      await runWithConnectorContext(
        { workspaceId: "ws_safe_sink", connectionId: "conn_safe_1" },
        async () => {
          const rows = await metaReportClient.getInsights("valid-token", {
            adAccountId: "act_healthy_safe",
            fields: ["impressions"],
            level: "campaign",
          });
          assert.ok(rows.length > 0);
        }
      );
    });
  });

  it("8. Heavy jobs expose item count and duration without raw payloads or PII", () => {
    const rawEvent = {
      eventCategory: "job_lifecycle" as const,
      provider: "warehouse_queue" as const,
      operation: "job_completed",
      workspaceId: "ws_heavy_tenant",
      jobId: "wjob_123456",
      itemCount: 50,
      completedItemCount: 48,
      durationMs: 4520,
      // Forbidden fields that should be stripped
      token: "secret_access_token_12345",
      authorization: "Bearer secret",
      requestBody: { query: "SELECT * FROM secrets" },
      customerEmail: "client@example.com",
      campaignName: "Black Friday Super Sale",
    };

    const sanitized = sanitizeTelemetryEvent(rawEvent as any);

    assert.equal(sanitized.itemCount, 50);
    assert.equal(sanitized.completedItemCount, 48);
    assert.equal(sanitized.durationMs, 4520);
    assert.equal(sanitized.workspaceId, "ws_heavy_tenant");

    // Ensure forbidden fields are strictly absent
    assert.equal((sanitized as any).token, undefined);
    assert.equal((sanitized as any).authorization, undefined);
    assert.equal((sanitized as any).requestBody, undefined);
    assert.equal((sanitized as any).customerEmail, undefined);
    assert.equal((sanitized as any).campaignName, undefined);
  });

  it("9. Opaque account identifiers prevent raw PII/account leaks", () => {
    const opaque1 = toOpaqueAccountId("act_9988776655");
    const opaque2 = toOpaqueAccountId("act_9988776655");
    const opaqueOther = toOpaqueAccountId("act_1122334455");

    assert.ok(opaque1?.startsWith("acct_"));
    assert.equal(opaque1, opaque2, "Hashing must be deterministic");
    assert.notEqual(opaque1, opaqueOther, "Different accounts must have distinct hashes");
    assert.ok(!opaque1?.includes("9988776655"), "Must not leak raw account number");
  });

  it("10. Rival-workspace activity cannot be attached to another workspace's event", async () => {
    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_tenant_A", connectionId: "conn_A" },
        async () => {
          emitConnectorTelemetry({
            eventCategory: "provider_request",
            provider: "meta_ads",
            operation: "test_op_A",
          });
        }
      );

      await runWithConnectorContext(
        { workspaceId: "ws_tenant_B", connectionId: "conn_B" },
        async () => {
          emitConnectorTelemetry({
            eventCategory: "provider_request",
            provider: "google_ads",
            operation: "test_op_B",
          });
        }
      );

      const eventA = capture.events.find((e) => e.operation === "test_op_A");
      const eventB = capture.events.find((e) => e.operation === "test_op_B");

      assert.equal(eventA?.workspaceId, "ws_tenant_A");
      assert.equal(eventA?.connectionId, "conn_A");

      assert.equal(eventB?.workspaceId, "ws_tenant_B");
      assert.equal(eventB?.connectionId, "conn_B");
    } finally {
      capture.restore();
    }
  });

  it("11. Empty, whitespace, or missing workspace ID defaults to unbound without crashing or inventing tenants", () => {
    const emptyEvent = sanitizeTelemetryEvent({
      workspaceId: "",
      provider: "meta_ads",
      operation: "empty_test",
    });
    assert.equal(emptyEvent.workspaceId, "ws_unspecified");
    assert.equal(emptyEvent.contextStatus, "unbound");

    const whitespaceEvent = sanitizeTelemetryEvent({
      workspaceId: "   \t\n  ",
      provider: "meta_ads",
      operation: "whitespace_test",
    });
    assert.equal(whitespaceEvent.workspaceId, "ws_unspecified");
    assert.equal(whitespaceEvent.contextStatus, "unbound");

    const undefinedEvent = sanitizeTelemetryEvent({
      workspaceId: undefined as any,
      provider: "google_ads",
      operation: "undefined_test",
    });
    assert.equal(undefinedEvent.workspaceId, "ws_unspecified");
    assert.equal(undefinedEvent.contextStatus, "unbound");

    const validEvent = sanitizeTelemetryEvent({
      workspaceId: "  ws_real_tenant  ",
      provider: "tiktok_business",
      operation: "valid_test",
    });
    assert.equal(validEvent.workspaceId, "ws_real_tenant");
    assert.equal(validEvent.contextStatus, "tenant_scoped");
  });

  it("12. Work emitted outside any AsyncLocalStorage context is cleanly marked unbound", () => {
    const capture = captureTelemetryForTest();
    try {
      emitConnectorTelemetry({
        provider: "warehouse_queue",
        operation: "background_cleanup",
        outcome: "success",
      });

      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0].workspaceId, "ws_unspecified");
      assert.equal(capture.events[0].contextStatus, "unbound");
    } finally {
      capture.restore();
    }
  });

  it("13. Concurrent AsyncLocalStorage executions maintain strict tenant isolation without race conditions", async () => {
    const capture = captureTelemetryForTest();
    try {
      const taskA = runWithConnectorContext(
        { workspaceId: "ws_concurrent_A", connectionId: "conn_A" },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          emitConnectorTelemetry({
            provider: "meta_ads",
            operation: "async_op_A",
          });
        }
      );

      const taskB = runWithConnectorContext(
        { workspaceId: "ws_concurrent_B", connectionId: "conn_B" },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          emitConnectorTelemetry({
            provider: "google_ads",
            operation: "async_op_B",
          });
        }
      );

      await Promise.all([taskA, taskB]);

      const eventA = capture.events.find((e) => e.operation === "async_op_A");
      const eventB = capture.events.find((e) => e.operation === "async_op_B");

      assert.equal(eventA?.workspaceId, "ws_concurrent_A");
      assert.equal(eventA?.contextStatus, "tenant_scoped");
      assert.equal(eventB?.workspaceId, "ws_concurrent_B");
      assert.equal(eventB?.contextStatus, "tenant_scoped");
    } finally {
      capture.restore();
    }
  });

  it("14. Provider retry callbacks retain the active workspace context across delays", async () => {
    simulator.setFaults({
      meta: {
        rateLimitAccountIds: new Set(["act_retry_ctx"]),
      },
    });

    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_retry_ctx_tenant", connectionId: "conn_retry_ctx" },
        async () => {
          await assert.rejects(async () => {
            await metaReportClient.getInsights("valid-token", {
              adAccountId: "act_retry_ctx",
              fields: ["impressions"],
              level: "campaign",
            });
          });
        }
      );

      const retryEvents = capture.events.filter((e) => e.provider === "meta_ads");
      assert.ok(retryEvents.length > 1, "Expected multiple attempts");
      for (const ev of retryEvents) {
        assert.equal(ev.workspaceId, "ws_retry_ctx_tenant");
        assert.equal(ev.contextStatus, "tenant_scoped");
      }
    } finally {
      capture.restore();
    }
  });
});
