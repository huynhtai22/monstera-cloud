import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  sanitizeTelemetryEvent,
  emitConnectorTelemetry,
  runWithConnectorContext,
  getConnectorContext,
  captureTelemetryForTest,
  setTelemetrySink,
  toOpaqueWorkspaceId,
} from "./connector-telemetry";

describe("Adversarial Runtime Telemetry Sanitization & Parsing", () => {
  beforeEach(() => {
    setTelemetrySink(null);
  });

  afterEach(() => {
    setTelemetrySink(null);
  });

  it("1. Rejects nested token-shaped objects in primitive fields (e.g. provider)", () => {
    const badInput = {
      provider: { token: "secret_123", bearer: "eyJhbGciOi..." },
      operation: "sync_campaigns",
    };
    const result = sanitizeTelemetryEvent(badInput);
    assert.equal(result, null, "Object in provider field must be rejected");
  });

  it("2. Rejects object or array in trusted accountId and identifier fields while stripping untrusted opaque-shaped fields", () => {
    const badAccountObj = {
      provider: "meta_ads",
      operation: "sync_metrics",
      accountId: { id: "act_12345" },
    };
    assert.equal(sanitizeTelemetryEvent(badAccountObj), null);

    const badAccountArray = {
      provider: "meta_ads",
      operation: "sync_metrics",
      accountId: ["act_12345"],
    };
    assert.equal(sanitizeTelemetryEvent(badAccountArray), null);

    const untrustedOpaque = sanitizeTelemetryEvent({
      provider: "meta_ads",
      operation: "sync_metrics",
      opaqueAccountId: "acct_deadbeefcafe",
      nested: { opaqueAccountId: "acct_opaque_deadbeefcafe" },
    });
    assert.ok(untrustedOpaque);
    assert.equal(untrustedOpaque.opaqueAccountId, undefined);

    const badConnArray = {
      provider: "meta_ads",
      operation: "sync_metrics",
      connectionId: ["conn_1"],
    };
    assert.equal(sanitizeTelemetryEvent(badConnArray), null);
  });

  it("3. Rejects invalid or email-shaped operations", () => {
    const emailOp = {
      provider: "meta_ads",
      operation: "user@example.com",
    };
    assert.equal(sanitizeTelemetryEvent(emailOp), null);

    const sqlOp = {
      provider: "meta_ads",
      operation: "SELECT * FROM users;",
    };
    assert.equal(sanitizeTelemetryEvent(sqlOp), null);

    const whitespaceOp = {
      provider: "meta_ads",
      operation: "op with spaces",
    };
    assert.equal(sanitizeTelemetryEvent(whitespaceOp), null);
  });

  it("4. Rejects negative, invalid, or out-of-range HTTP status codes", () => {
    const negStatus = { provider: "meta_ads", operation: "test_op", httpStatus: -200 };
    assert.equal(sanitizeTelemetryEvent(negStatus), null);

    const lowStatus = { provider: "meta_ads", operation: "test_op", httpStatus: 99 };
    assert.equal(sanitizeTelemetryEvent(lowStatus), null);

    const highStatus = { provider: "meta_ads", operation: "test_op", httpStatus: 600 };
    assert.equal(sanitizeTelemetryEvent(highStatus), null);

    const nanStatus = { provider: "meta_ads", operation: "test_op", httpStatus: NaN };
    assert.equal(sanitizeTelemetryEvent(nanStatus), null);
  });

  it("5. Rejects NaN, Infinity, negative, and oversized durations/counts", () => {
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", durationMs: NaN }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", durationMs: Infinity }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", durationMs: -50 }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", durationMs: 100_000_000 }), null);

    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", itemCount: -1 }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", itemCount: 10_000_000 }), null);

    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", dataWindowDays: -5 }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", dataWindowDays: 4000 }), null);
  });

  it("6. Rejects unknown enums across all category and outcome fields", () => {
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", eventCategory: "malicious_category" as any }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "unsupported_platform" as any }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", outcome: "fabricated_outcome" as any }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", errorCategory: "raw_exception" as any }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", leaseOutcome: "fabricated_lease_outcome" as any }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", freshnessOutcome: "instant" as any }), null);
  });

  it("7. Strips all secret-shaped caller fields and never leaks them in emitted payload", () => {
    const callerPayloadWithSecrets = {
      provider: "google_ads",
      operation: "sync_job",
      workspaceId: "ws_clean_tenant",
      // Attacker or misbehaving caller injects sensitive fields
      client_secret: "super_secret_client_key",
      access_token: "ya29.sensitive_oauth_token",
      authorization: "Bearer ya29.token",
      apiKey: "AIzaSySecretApiKey",
      password: "database_password",
      reqBody: { credit_card: "4111222233334444" },
      rawSql: "DROP TABLE users;",
    };

    const capture = captureTelemetryForTest();
    try {
      emitConnectorTelemetry(callerPayloadWithSecrets);

      assert.equal(capture.events.length, 1);
      const emitted = capture.events[0] as any;

      // Assert that none of the secret keys exist on the emitted object
      assert.equal(emitted.client_secret, undefined);
      assert.equal(emitted.access_token, undefined);
      assert.equal(emitted.authorization, undefined);
      assert.equal(emitted.apiKey, undefined);
      assert.equal(emitted.password, undefined);
      assert.equal(emitted.reqBody, undefined);
      assert.equal(emitted.rawSql, undefined);

      // Recursive scan of JSON serialization
      const json = JSON.stringify(emitted);
      assert.ok(!json.includes("super_secret_client_key"));
      assert.ok(!json.includes("ya29.sensitive_oauth_token"));
      assert.ok(!json.includes("AIzaSySecretApiKey"));
      assert.ok(!json.includes("database_password"));
      assert.ok(!json.includes("credit_card"));
      assert.ok(!json.includes("DROP TABLE"));
    } finally {
      capture.restore();
    }
  });

  it("8. Safely handles getters that throw without crashing the caller", () => {
    const throwingInput = {
      get provider() {
        throw new Error("Malicious getter triggered during property access");
      },
      operation: "exploit_attempt",
    };

    const result = sanitizeTelemetryEvent(throwingInput);
    assert.equal(result, null);

    // emitConnectorTelemetry must not throw
    assert.doesNotThrow(() => {
      emitConnectorTelemetry(throwingInput);
    });
  });

  it("9. Rejects prototype pollution payloads (__proto__, constructor, prototype)", () => {
    const pollutedObject = Object.create({ isAdmin: true });
    pollutedObject.provider = "meta_ads";
    pollutedObject.operation = "pollute_test";

    const result = sanitizeTelemetryEvent(pollutedObject);
    assert.equal(result, null, "Objects with non-standard prototype must be rejected");
  });

  it("10. Rejects oversized strings in identifiers and operations", () => {
    const giantId = "a".repeat(200);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", operation: giantId }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", workspaceId: giantId }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", connectionId: giantId }), null);
  });

  it("11. Rejects invalid timestamps (non-dates, out-of-range years)", () => {
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", timestamp: "not-a-date" }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", timestamp: "1980-01-01T00:00:00.000Z" }), null);
    assert.equal(sanitizeTelemetryEvent({ provider: "meta_ads", timestamp: "2050-01-01T00:00:00.000Z" }), null);
  });
});

describe("Deterministic AsyncLocalStorage Tenant Context Derivation & Isolation", () => {
  beforeEach(() => {
    setTelemetrySink(null);
  });

  afterEach(() => {
    setTelemetrySink(null);
  });

  it("1. Nested contexts: inner overrides outer, outer is restored upon inner exit", async () => {
    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_outer_tenant", connectionId: "conn_outer" },
        async () => {
          emitConnectorTelemetry({ provider: "meta_ads", operation: "outer_op_1" });

          await runWithConnectorContext(
            { workspaceId: "ws_inner_tenant", connectionId: "conn_inner" },
            async () => {
              emitConnectorTelemetry({ provider: "google_ads", operation: "inner_op" });
            }
          );

          emitConnectorTelemetry({ provider: "meta_ads", operation: "outer_op_2" });
        }
      );

      assert.equal(capture.events.length, 3);
      assert.equal(capture.events[0].operation, "outer_op_1");
      assert.equal(capture.events[0].opaqueWorkspaceId, toOpaqueWorkspaceId("ws_outer_tenant"));
      assert.equal(capture.events[0].contextStatus, "tenant_scoped");

      assert.equal(capture.events[1].operation, "inner_op");
      assert.equal(capture.events[1].opaqueWorkspaceId, toOpaqueWorkspaceId("ws_inner_tenant"));
      assert.equal(capture.events[1].contextStatus, "tenant_scoped");

      assert.equal(capture.events[2].operation, "outer_op_2");
      assert.equal(capture.events[2].opaqueWorkspaceId, toOpaqueWorkspaceId("ws_outer_tenant"));
      assert.equal(capture.events[2].contextStatus, "tenant_scoped");
    } finally {
      capture.restore();
    }
  });

  it("2. Explicit blank workspace inside valid context is rejected; does not fall back to context", async () => {
    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_enclosing_tenant", connectionId: "conn_enc" },
        async () => {
          // Explicitly empty workspace supplied inside enclosing context
          emitConnectorTelemetry({
            workspaceId: "",
            provider: "meta_ads",
            operation: "explicit_blank",
          });

          // Explicitly whitespace workspace supplied inside enclosing context
          emitConnectorTelemetry({
            workspaceId: "   ",
            provider: "meta_ads",
            operation: "explicit_whitespace",
          });

          // Valid omitted workspace inside enclosing context inherits cleanly
          emitConnectorTelemetry({
            provider: "meta_ads",
            operation: "omitted_workspace",
          });
        }
      );

      // Only the valid event should be emitted; the 2 invalid ones must be dropped
      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0].operation, "omitted_workspace");
      assert.equal(capture.events[0].opaqueWorkspaceId, toOpaqueWorkspaceId("ws_enclosing_tenant"));
      assert.equal(capture.events[0].contextStatus, "tenant_scoped");
    } finally {
      capture.restore();
    }
  });

  it("3. Explicit conflicting workspace inside enclosing context fails closed", async () => {
    const capture = captureTelemetryForTest();
    try {
      await runWithConnectorContext(
        { workspaceId: "ws_authorized_tenant", connectionId: "conn_auth" },
        async () => {
          // Caller attempts to emit telemetry with a conflicting rival workspace ID
          emitConnectorTelemetry({
            workspaceId: "ws_rival_tenant",
            provider: "meta_ads",
            operation: "rival_attack_op",
          });

          // Valid event with matching workspace ID succeeds
          emitConnectorTelemetry({
            workspaceId: "ws_authorized_tenant",
            provider: "meta_ads",
            operation: "authorized_op",
          });
        }
      );

      // Rival conflicting event is dropped
      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0].operation, "authorized_op");
      assert.equal(capture.events[0].opaqueWorkspaceId, toOpaqueWorkspaceId("ws_authorized_tenant"));
    } finally {
      capture.restore();
    }
  });

  it("4. Thrown or rejected async work cleans up ALS context reliably", async () => {
    assert.equal(getConnectorContext(), undefined);

    await assert.rejects(async () => {
      await runWithConnectorContext(
        { workspaceId: "ws_failing_tenant", connectionId: "conn_fail" },
        async () => {
          assert.equal(getConnectorContext()?.workspaceId, "ws_failing_tenant");
          throw new Error("Deliberate business failure inside context");
        }
      );
    });

    // Context must be cleanly restored to undefined after exception
    assert.equal(getConnectorContext(), undefined);

    // Telemetry emitted after failure is cleanly unbound
    const capture = captureTelemetryForTest();
    try {
      emitConnectorTelemetry({
        provider: "warehouse_queue",
        operation: "post_failure_cleanup",
      });

      assert.equal(capture.events.length, 1);
      assert.equal(capture.events[0].opaqueWorkspaceId, undefined);
      assert.equal(capture.events[0].contextStatus, "unbound");
    } finally {
      capture.restore();
    }
  });

  it("5. Caller-supplied contextStatus without valid identity is never trusted", () => {
    // Caller claims "tenant_scoped" but omits workspaceId
    const forgedTenantScoped = sanitizeTelemetryEvent({
      contextStatus: "tenant_scoped" as any,
      provider: "meta_ads",
      operation: "forgery_test",
    });

    assert.ok(forgedTenantScoped !== null);
    assert.equal(forgedTenantScoped.opaqueWorkspaceId, undefined);
    assert.equal(forgedTenantScoped.contextStatus, "unbound", "Must be derived as unbound");
  });
});
