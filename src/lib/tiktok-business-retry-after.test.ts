import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  TikTokReportClient,
  TikTokProviderError,
  setTikTokRetrySleeperForTest,
  retryAfterMs,
} from "./tiktok-business";
import { captureTelemetryForTest } from "./observability/connector-telemetry";

describe("TikTok Retry-After Evidence & Deterministic Sleeper", () => {
  const originalFetch = globalThis.fetch;
  let delays: number[] = [];

  beforeEach(() => {
    delays = [];
    setTikTokRetrySleeperForTest(async (ms) => {
      delays.push(ms);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setTikTokRetrySleeperForTest(null);
  });

  describe("retryAfterMs parser", () => {
    it("parses valid integer and floating seconds", () => {
      assert.equal(retryAfterMs("5"), 5000);
      assert.equal(retryAfterMs("0"), 0);
      assert.equal(retryAfterMs("2.5"), 2500);
    });

    it("parses valid future HTTP-date strings", () => {
      const future = new Date(Date.now() + 10_000).toUTCString();
      const ms = retryAfterMs(future);
      assert.ok(ms !== null && ms >= 7000 && ms <= 12000);
    });

    it("clamps past HTTP-date strings to 0ms", () => {
      const past = new Date(Date.now() - 5000).toUTCString();
      assert.equal(retryAfterMs(past), 0);
    });

    it("returns null for invalid, empty, or negative values", () => {
      assert.equal(retryAfterMs(null), null);
      assert.equal(retryAfterMs(""), null);
      assert.equal(retryAfterMs("   "), null);
      assert.equal(retryAfterMs("not-a-number"), null);
      assert.equal(retryAfterMs("-5"), null);
    });
  });

  describe("Retry-After compliance telemetry in fetchTikTokJson", () => {
    it("1. Valid seconds header: reports retryAfterSupplied=true and retryAfterHonored=true", async () => {
      const capture = captureTelemetryForTest();
      try {
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          if (callCount === 1) {
            return new Response(JSON.stringify({ code: 40001, message: "Rate limit exceeded" }), {
              status: 429,
              headers: { "retry-after": "4" },
            });
          }
          return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        const res = await client.checkTask("token", "adv-1", "task-1");
        assert.equal(res.status, "SUCCESS");
        assert.equal(callCount, 2);
        assert.equal(delays.length, 1);
        assert.equal(delays[0], 4000);

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 2); // attempt 1 (throttled) and attempt 2 (success)
        assert.equal(events[0].attempt, 1);
        assert.equal(events[0].retryAfterSupplied, true);
        assert.equal(events[0].retryAfterHonored, true);
        assert.equal(events[0].outcome, "throttled");
        assert.equal(events[1].attempt, 2);
        assert.equal(events[1].outcome, "success");
      } finally {
        capture.restore();
      }
    });

    it("2. Valid HTTP-date header: reports retryAfterSupplied=true and retryAfterHonored=true", async () => {
      const capture = captureTelemetryForTest();
      try {
        const futureDate = new Date(Date.now() + 6000).toUTCString();
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          if (callCount === 1) {
            return new Response(JSON.stringify({ code: 40001, message: "Too many requests" }), {
              status: 429,
              headers: { "retry-after": futureDate },
            });
          }
          return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        const res = await client.checkTask("token", "adv-1", "task-1");
        assert.equal(res.status, "SUCCESS");
        assert.equal(callCount, 2);
        assert.equal(delays.length, 1);
        assert.ok(delays[0] >= 3000 && delays[0] <= 8000);

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 2);
        assert.equal(events[0].attempt, 1);
        assert.equal(events[0].retryAfterSupplied, true);
        assert.equal(events[0].retryAfterHonored, true);
        assert.equal(events[1].attempt, 2);
        assert.equal(events[1].outcome, "success");
      } finally {
        capture.restore();
      }
    });

    it("3. Invalid header using fallback delay: reports retryAfterSupplied=true, retryAfterHonored=false", async () => {
      const capture = captureTelemetryForTest();
      try {
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          if (callCount === 1) {
            return new Response(JSON.stringify({ code: 40001, message: "Rate limit" }), {
              status: 429,
              headers: { "retry-after": "gibberish" },
            });
          }
          return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        const res = await client.checkTask("token", "adv-1", "task-1");
        assert.equal(res.status, "SUCCESS");
        assert.equal(callCount, 2);
        assert.equal(delays.length, 1);
        // Fallback delay for attempt 0: 500 * 2^0 + [0..200]
        assert.ok(delays[0] >= 500 && delays[0] <= 750);

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 2);
        assert.equal(events[0].attempt, 1);
        assert.equal(events[0].retryAfterSupplied, true);
        assert.equal(events[0].retryAfterHonored, false);
        assert.equal(events[1].attempt, 2);
        assert.equal(events[1].outcome, "success");
      } finally {
        capture.restore();
      }
    });

    it("4. Missing header: reports retryAfterSupplied=false and retryAfterHonored=false", async () => {
      const capture = captureTelemetryForTest();
      try {
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          if (callCount === 1) {
            return new Response(JSON.stringify({ code: 40001, message: "Rate limit" }), {
              status: 429,
            });
          }
          return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        const res = await client.checkTask("token", "adv-1", "task-1");
        assert.equal(res.status, "SUCCESS");
        assert.equal(callCount, 2);
        assert.equal(delays.length, 1);

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 2);
        assert.equal(events[0].attempt, 1);
        assert.equal(events[0].retryAfterSupplied, false);
        assert.equal(events[0].retryAfterHonored, false);
        assert.equal(events[1].attempt, 2);
        assert.equal(events[1].outcome, "success");
      } finally {
        capture.restore();
      }
    });

    it("5. Valid header on final attempt: reports retryAfterHonored=false because no retry occurs", async () => {
      const capture = captureTelemetryForTest();
      try {
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          return new Response(JSON.stringify({ code: 40001, message: "Persistent rate limit" }), {
            status: 429,
            headers: { "retry-after": "10" },
          });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        await assert.rejects(
          async () => {
            await client.checkTask("token", "adv-1", "task-1");
          },
          (err: any) => err instanceof TikTokProviderError && err.retryable === true
        );

        // Max attempts is 3, so delays has 2 sleeps
        assert.equal(callCount, 3);
        assert.equal(delays.length, 2);
        assert.equal(delays[0], 10000);
        assert.equal(delays[1], 10000);

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 3);
        // Attempt 1: will retry, honored
        assert.equal(events[0].attempt, 1);
        assert.equal(events[0].retryAfterHonored, true);
        // Attempt 2: will retry, honored
        assert.equal(events[1].attempt, 2);
        assert.equal(events[1].retryAfterHonored, true);
        // Attempt 3 (final): will NOT retry, therefore NOT honored
        assert.equal(events[2].attempt, 3);
        assert.equal(events[2].retryAfterSupplied, true);
        assert.equal(events[2].retryAfterHonored, false);
      } finally {
        capture.restore();
      }
    });

    it("6. Non-retryable response (400): reports retryAfterHonored=false and aborts immediately", async () => {
      const capture = captureTelemetryForTest();
      try {
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          return new Response(JSON.stringify({ code: 40000, message: "Invalid parameter" }), {
            status: 400,
            headers: { "retry-after": "5" },
          });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        await assert.rejects(
          async () => {
            await client.checkTask("token", "adv-1", "task-1");
          },
          (err: any) => err instanceof TikTokProviderError && err.retryable === false
        );

        assert.equal(callCount, 1);
        assert.equal(delays.length, 0); // No sleep

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 1);
        assert.equal(events[0].retryAfterSupplied, true);
        assert.equal(events[0].retryAfterHonored, false);
      } finally {
        capture.restore();
      }
    });
  });

  describe("Retry-After compliance telemetry in fetchTikTokResponse (downloadRows)", () => {
    it("7. Valid seconds header on asset download: honored before successful retry", async () => {
      const capture = captureTelemetryForTest();
      try {
        let callCount = 0;
        globalThis.fetch = (async () => {
          callCount++;
          if (callCount === 1) {
            return new Response(JSON.stringify({ code: 429, message: "asset throttled" }), {
              status: 429,
              headers: { "retry-after": "2" },
            });
          }
          return new Response("campaign_id,spend\n12345,10.50\n", { status: 200 });
        }) as typeof fetch;

        const client = new TikTokReportClient();
        const rows = await client.downloadRows("https://download.tiktok.com/asset-1");
        assert.equal(rows.length, 1);
        assert.equal(callCount, 2);
        assert.equal(delays.length, 1);
        assert.equal(delays[0], 2000);

        const events = capture.events.filter((e) => e.provider === "tiktok_business");
        assert.equal(events.length, 2); // attempt 1 and attempt 2
        assert.equal(events[0].attempt, 1);
        assert.equal(events[0].retryAfterSupplied, true);
        assert.equal(events[0].retryAfterHonored, true);
        assert.equal(events[1].attempt, 2);
        assert.equal(events[1].outcome, "success");
      } finally {
        capture.restore();
      }
    });
  });
});
