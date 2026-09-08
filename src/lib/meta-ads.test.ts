import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  metaReportClient,
  MetaOAuthRevokedError,
  setMetaRetrySleeperForTest,
} from "./meta-ads";
import {
  captureTelemetryForTest,
  runWithConnectorContext,
} from "./observability/connector-telemetry";

describe("Meta Ads client telemetry & error handling", () => {
  let originalFetch: typeof fetch;
  let sleptMs: number[];

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    sleptMs = [];
    setMetaRetrySleeperForTest(async (ms) => {
      sleptMs.push(ms);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setMetaRetrySleeperForTest(null);
  });

  it("1. Code 190 produces exactly one event, preserves status 400, nonzero duration, and throws MetaOAuthRevokedError", async () => {
    const capture = captureTelemetryForTest();

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "Error validating access token: Session has expired or token is revoked.",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await runWithConnectorContext(
        { workspaceId: "ws_meta_test", connectionId: "conn_meta_1" },
        async () => {
          await assert.rejects(
            async () => {
              await metaReportClient.getInsights("revoked-token", {
                adAccountId: "act_12345",
                fields: ["spend"],
                level: "campaign",
              });
            },
            (err) => {
              assert.ok(err instanceof MetaOAuthRevokedError);
              assert.equal(err.code, 190);
              assert.ok(err.message.includes("Session has expired"));
              return true;
            }
          );
        }
      );

      // Exactly ONE telemetry event emitted
      assert.equal(capture.events.length, 1, "Expected exactly 1 telemetry event for code 190");
      const ev = capture.events[0];
      assert.equal(ev.eventCategory, "provider_request");
      assert.equal(ev.provider, "meta_ads");
      assert.equal(ev.attempt, 1);
      assert.equal(ev.outcome, "permanent_failure");
      assert.equal(ev.errorCategory, "auth_revoked");
      assert.equal(ev.httpStatus, 400, "HTTP status must be the actual 400, not fabricated 401");
      assert.ok(ev.durationMs >= 0, "Duration must be measured");
      assert.equal(sleptMs.length, 0, "Must not retry on permanent revocation");
    } finally {
      capture.restore();
    }
  });

  it("2. Retryable rate limit (error code 17) backs off and emits once per attempt", async () => {
    const capture = captureTelemetryForTest();
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: "User request limit reached",
              code: 17,
            },
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "x-business-use-case-usage": JSON.stringify({
                "12345": [{ call_count: 95, total_cputime: 20, total_time: 30 }],
              }),
            },
          }
        );
      }
      return new Response(
        JSON.stringify({
          data: [{ spend: "150.00" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await runWithConnectorContext(
        { workspaceId: "ws_meta_test", connectionId: "conn_meta_1" },
        async () => {
          const rows = await metaReportClient.getInsights("valid-token", {
            adAccountId: "act_12345",
            fields: ["spend"],
            level: "campaign",
          });
          assert.equal(rows.length, 1);
          assert.equal(rows[0].spend, "150.00");
        }
      );

      // Exactly 2 events: attempt 1 throttled, attempt 2 success
      assert.equal(capture.events.length, 2);
      assert.equal(capture.events[0].attempt, 1);
      assert.equal(capture.events[0].outcome, "throttled");
      assert.equal(capture.events[0].errorCategory, "rate_limited");
      assert.equal(capture.events[1].attempt, 2);
      assert.equal(capture.events[1].outcome, "success");
      assert.equal(sleptMs.length, 2, "Expected proactive pause sleep and backoff sleep");
      assert.equal(sleptMs[0], 15000, "First sleep was proactive pause");
    } finally {
      capture.restore();
    }
  });

  it("3. Normal successful request emits exactly one event", async () => {
    const capture = captureTelemetryForTest();

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          data: [{ spend: "250.00" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await runWithConnectorContext(
        { workspaceId: "ws_meta_test", connectionId: "conn_meta_1" },
        async () => {
          const rows = await metaReportClient.getInsights("valid-token", {
            adAccountId: "act_12345",
            fields: ["spend"],
            level: "campaign",
          });
          assert.equal(rows.length, 1);
        }
      );

      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0].attempt, 1);
      assert.equal(capture.events[0].outcome, "success");
      assert.equal(capture.events[0].httpStatus, 200);
      assert.equal(sleptMs.length, 0);
    } finally {
      capture.restore();
    }
  });

  it("4. Non-auth permanent Graph error (e.g. invalid parameter code 100) emits exactly once and throws Error", async () => {
    const capture = captureTelemetryForTest();

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "Invalid parameter: unsupported field",
            code: 100,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await runWithConnectorContext(
        { workspaceId: "ws_meta_test", connectionId: "conn_meta_1" },
        async () => {
          await assert.rejects(
            async () => {
              await metaReportClient.getInsights("valid-token", {
                adAccountId: "act_12345",
                fields: ["spend"],
                level: "campaign",
              });
            },
            (err: any) => {
              assert.ok(!(err instanceof MetaOAuthRevokedError));
              assert.ok(err.message.includes("Meta Insights error 100"));
              return true;
            }
          );
        }
      );

      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0].attempt, 1);
      assert.equal(capture.events[0].httpStatus, 400);
      assert.notEqual(capture.events[0].errorCategory, "auth_revoked");
      assert.equal(sleptMs.length, 0);
    } finally {
      capture.restore();
    }
  });

  it("5. Async report methods uniformly throw MetaOAuthRevokedError on code 190 without duplicate telemetry", async () => {
    const capture = captureTelemetryForTest();

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: "Session has expired",
            code: 190,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await runWithConnectorContext(
        { workspaceId: "ws_meta_test", connectionId: "conn_meta_1" },
        async () => {
          await assert.rejects(
            async () => {
              await metaReportClient.createAsyncReport("token", {
                adAccountId: "act_12345",
                fields: ["spend"],
                level: "campaign",
              });
            },
            (err) => err instanceof MetaOAuthRevokedError
          );

          await assert.rejects(
            async () => {
              await metaReportClient.checkAsyncReport("token", "run_123");
            },
            (err) => err instanceof MetaOAuthRevokedError
          );

          await assert.rejects(
            async () => {
              await metaReportClient.fetchAsyncResults("token", "run_123");
            },
            (err) => err instanceof MetaOAuthRevokedError
          );
        }
      );

      // Exactly 3 calls were made, exactly 3 telemetry events emitted
      assert.equal(capture.events.length, 3);
      for (const ev of capture.events) {
        assert.equal(ev.outcome, "permanent_failure");
        assert.equal(ev.errorCategory, "auth_revoked");
        assert.equal(ev.httpStatus, 400);
      }
    } finally {
      capture.restore();
    }
  });
});
