import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { GET as masterCron } from "./route";

// The nightly master orchestrator must attempt every independent child task
// and propagate child failure in its overall HTTP status, while keeping the
// per-task summary sanitized (status codes only — never bodies or secrets).
describe("CRON /api/cron/master failure propagation", () => {
  const SECRET = "local-master-cron-secret-0123456789abcdef";
  const BASE = "http://localhost:3000";
  const originalCronSecret = process.env.CRON_SECRET;
  const originalFetch = globalThis.fetch;
  let calls: Array<{ url: string; authorization: string | null }> = [];
  let overrides: Map<string, number | Error>;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    calls = [];
    overrides = new Map();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization ?? null,
      });
      // Fail immediately if anything other than the loopback self-calls is attempted.
      if (!/^https?:\/\/(localhost|127\.0\.0\.1):/.test(url)) {
        throw new Error(`live network attempted by master cron: ${url}`);
      }
      const override = overrides.get(new URL(url).pathname);
      if (override instanceof Error) throw override;
      return new Response("{}", { status: override ?? 200 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  const authed = () =>
    new Request(`${BASE}/api/cron/master`, { headers: { Authorization: `Bearer ${SECRET}` } });

  it("returns 200 with sanitized per-task results when every child task succeeds", async () => {
    const res = await masterCron(authed());
    assert.equal(res.status, 200);
    const body = await res.json();
    const expected = [
      "tokenPrefetch",
      "warehouseRefresh",
      "shopeeRefresh",
      "warehouseJobs",
      "healthTick",
      "alerts",
      "reportSchedules",
      "billingExpiry",
    ];
    assert.deepEqual(Object.keys(body.executed).sort(), [...expected].sort());
    for (const name of expected) {
      assert.equal(body.executed[name], 200, name);
    }
    assert.equal(calls.length, expected.length);
    for (const call of calls) {
      assert.equal(call.authorization, `Bearer ${SECRET}`);
    }
  });

  it("returns 500 when reportSchedules fails and still attempts the remaining tasks", async () => {
    overrides.set("/api/cron/report-schedules", 500);
    const res = await masterCron(authed());
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.executed.reportSchedules, 500);
    assert.equal(body.executed.billingExpiry, 200);
    assert.equal(body.executed.healthTick, 200);
    assert.equal(calls.length, 8);
  });

  it("returns 500 when any other required task fails and still attempts the rest", async () => {
    overrides.set("/api/cron/shopee/refresh", 503);
    const res = await masterCron(authed());
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.executed.shopeeRefresh, 503);
    assert.equal(body.executed.reportSchedules, 200);
    assert.equal(calls.length, 8);
  });

  it("returns 500 when a child task throws and marks it failed without leaking details", async () => {
    overrides.set("/api/cron/health-tick", new Error("connect ECONNREFUSED 10.0.0.1:5432"));
    const res = await masterCron(authed());
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.executed.healthTick, "failed");
    const raw = JSON.stringify(body);
    assert.equal(raw.includes("ECONNREFUSED"), false);
    for (const value of Object.values(body.executed)) {
      assert.ok(value === "failed" || (typeof value === "number" && value >= 100 && value < 600));
    }
  });

  it("executes no child task without valid cron authorization", async () => {
    const missing = await masterCron(new Request(`${BASE}/api/cron/master`));
    assert.equal(missing.status, 401);
    const wrong = await masterCron(
      new Request(`${BASE}/api/cron/master`, { headers: { Authorization: `Bearer ${"y".repeat(SECRET.length)}` } }),
    );
    assert.equal(wrong.status, 401);
    assert.equal(calls.length, 0);
  });
});
