import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import {
  pickDataThroughDate,
  shouldRefreshLastDataThrough,
  refreshConnectionLastDataThrough,
} from "./connection-data-through";
import { captureTelemetryForTest, setTelemetrySink, toOpaqueConnectionId, toOpaqueWorkspaceId } from "@/lib/observability/connector-telemetry";
import prisma from "@/lib/prisma";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55436/monstera_ci";
}

describe("pickDataThroughDate", () => {
  it("prefers the stored connection date over a live fallback", () => {
    const stored = new Date("2026-08-20T00:00:00.000Z");
    const fallback = new Date("2026-08-25T00:00:00.000Z");
    assert.equal(pickDataThroughDate(stored, fallback)?.toISOString(), stored.toISOString());
  });

  it("falls back to MAX(date) when the column is still null", () => {
    const fallback = new Date("2026-08-18T00:00:00.000Z");
    assert.equal(pickDataThroughDate(null, fallback)?.toISOString(), fallback.toISOString());
  });

  it("returns null rather than fabricating a date", () => {
    assert.equal(pickDataThroughDate(null, null), null);
    assert.equal(pickDataThroughDate(undefined, "not-a-date"), null);
  });
});

describe("shouldRefreshLastDataThrough", () => {
  it("advances only on full success", () => {
    assert.equal(shouldRefreshLastDataThrough("success"), true);
    assert.equal(shouldRefreshLastDataThrough("partial"), false);
    assert.equal(shouldRefreshLastDataThrough("failed"), false);
  });
});

describe("PostgreSQL Truthful Freshness Telemetry & Concurrency", () => {
  const wsA = "ws_freshness_A";
  const wsB = "ws_freshness_B";
  const testUser = "usr_freshness_test";
  const connA = "conn_freshness_A";
  const connDisconnected = "conn_freshness_disc";

  before(async () => {
    // Ensure test user and workspaces exist
    await prisma.user.upsert({
      where: { id: testUser },
      update: {},
      create: { id: testUser, email: "freshness@monstera.test", name: "Freshness Tester" },
    });

    for (const wsId of [wsA, wsB]) {
      await prisma.workspace.upsert({
        where: { id: wsId },
        update: {},
        create: { id: wsId, name: wsId, slug: wsId, ownerId: testUser, plan: "pro" },
      });
    }

    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsA } });
    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsB } });
    await prisma.connection.deleteMany({ where: { workspaceId: wsA } });
    await prisma.connection.deleteMany({ where: { workspaceId: wsB } });

    // Create active connection in wsA
    await prisma.connection.create({
      data: {
        id: connA,
        workspaceId: wsA,
        provider: "meta_ads",
        name: "Meta Test Conn",
        type: "source",
        status: "connected",
        remoteAccountId: "rem_freshness_A",
        credentials: "{}",
        lastDataThrough: null,
      },
    });

    // Create disconnected connection in wsA
    await prisma.connection.create({
      data: {
        id: connDisconnected,
        workspaceId: wsA,
        provider: "meta_ads",
        name: "Meta Disc Conn",
        type: "source",
        status: "disconnected",
        remoteAccountId: "rem_freshness_disc",
        credentials: "{}",
        lastDataThrough: null,
      },
    });
  });

  after(async () => {
    setTelemetrySink(null);
    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsA } });
    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsB } });
    await prisma.connection.deleteMany({ where: { workspaceId: wsA } });
    await prisma.connection.deleteMany({ where: { workspaceId: wsB } });
  });

  beforeEach(async () => {
    setTelemetrySink(null);
    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsA } });
    await prisma.campaignMetric.deleteMany({ where: { workspaceId: wsB } });
    await prisma.connection.update({
      where: { id: connA },
      data: { lastDataThrough: null },
    });
  });

  it("1. Null -> date: advances and emits truthful 'advanced' outcome", async () => {
    const capture = captureTelemetryForTest();
    try {
      const metricDate = new Date("2026-08-15T00:00:00.000Z");
      await prisma.campaignMetric.create({
        data: {
          workspaceId: wsA,
          connectionId: connA,
          platform: "meta_ads",
          accountId: "act_123",
          accountName: "Account 123",
          campaignId: "cmp_1",
          campaignName: "Summer Sale",
          date: metricDate,
          impressions: 1000,
          clicks: 50,
          spend: 100,
        },
      });

      const result = await refreshConnectionLastDataThrough(wsA, connA);
      assert.ok(result);
      assert.equal(result.toISOString(), metricDate.toISOString());

      const updatedConn = await prisma.connection.findUnique({ where: { id: connA } });
      assert.equal(updatedConn?.lastDataThrough?.toISOString(), metricDate.toISOString());

      const ev = capture.events.find((e) => e.operation === "data_through_refresh");
      assert.ok(ev);
      assert.equal(ev.freshnessOutcome, "advanced");
      assert.equal(ev.opaqueWorkspaceId, toOpaqueWorkspaceId(wsA));
      assert.equal(ev.opaqueConnectionId, toOpaqueConnectionId(connA));
    } finally {
      capture.restore();
    }
  });

  it("2. Older -> newer: advances and emits truthful 'advanced' outcome", async () => {
    const oldDate = new Date("2026-08-15T00:00:00.000Z");
    const newDate = new Date("2026-08-20T00:00:00.000Z");

    await prisma.connection.update({
      where: { id: connA },
      data: { lastDataThrough: oldDate },
    });

    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA,
        connectionId: connA,
        platform: "meta_ads",
        accountId: "act_123",
        accountName: "Account 123",
        campaignId: "cmp_2",
        campaignName: "Back to School",
        date: newDate,
        impressions: 500,
        clicks: 25,
        spend: 50,
      },
    });

    const capture = captureTelemetryForTest();
    try {
      const result = await refreshConnectionLastDataThrough(wsA, connA);
      assert.ok(result);
      assert.equal(result.toISOString(), newDate.toISOString());

      const updatedConn = await prisma.connection.findUnique({ where: { id: connA } });
      assert.equal(updatedConn?.lastDataThrough?.toISOString(), newDate.toISOString());

      const ev = capture.events.find((e) => e.operation === "data_through_refresh");
      assert.ok(ev);
      assert.equal(ev.freshnessOutcome, "advanced");
    } finally {
      capture.restore();
    }
  });

  it("3. Same -> same: date unchanged emits truthful 'unchanged' outcome", async () => {
    const targetDate = new Date("2026-08-20T00:00:00.000Z");

    await prisma.connection.update({
      where: { id: connA },
      data: { lastDataThrough: targetDate },
    });

    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA,
        connectionId: connA,
        platform: "meta_ads",
        accountId: "act_123",
        accountName: "Account 123",
        campaignId: "cmp_3",
        campaignName: "Fall Promo",
        date: targetDate,
        impressions: 200,
        clicks: 10,
        spend: 20,
      },
    });

    const capture = captureTelemetryForTest();
    try {
      const result = await refreshConnectionLastDataThrough(wsA, connA);
      assert.ok(result);
      assert.equal(result.toISOString(), targetDate.toISOString());

      const ev = capture.events.find((e) => e.operation === "data_through_refresh");
      assert.ok(ev);
      assert.equal(ev.freshnessOutcome, "unchanged");
    } finally {
      capture.restore();
    }
  });

  it("4. Newer -> older: predating candidate cannot overwrite newer date and emits 'unchanged'", async () => {
    const futureStoredDate = new Date("2026-08-25T00:00:00.000Z");
    const olderMetricDate = new Date("2026-08-20T00:00:00.000Z");

    await prisma.connection.update({
      where: { id: connA },
      data: { lastDataThrough: futureStoredDate },
    });

    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA,
        connectionId: connA,
        platform: "meta_ads",
        accountId: "act_123",
        accountName: "Account 123",
        campaignId: "cmp_4",
        campaignName: "Older Metric",
        date: olderMetricDate,
        impressions: 100,
        clicks: 5,
        spend: 10,
      },
    });

    const capture = captureTelemetryForTest();
    try {
      const result = await refreshConnectionLastDataThrough(wsA, connA);
      assert.ok(result);
      assert.equal(result.toISOString(), olderMetricDate.toISOString());

      // Stored connection date MUST remain the newer futureStoredDate
      const conn = await prisma.connection.findUnique({ where: { id: connA } });
      assert.equal(conn?.lastDataThrough?.toISOString(), futureStoredDate.toISOString());

      const ev = capture.events.find((e) => e.operation === "data_through_refresh");
      assert.ok(ev);
      assert.equal(ev.freshnessOutcome, "unchanged");
    } finally {
      capture.restore();
    }
  });

  it("5. Missing or disconnected connection emits 'unchanged' without crashing", async () => {
    const capture = captureTelemetryForTest();
    try {
      // Non-existent connection
      const missingResult = await refreshConnectionLastDataThrough(wsA, "conn_does_not_exist");
      assert.equal(missingResult, null);

      // Disconnected connection
      const discResult = await refreshConnectionLastDataThrough(wsA, connDisconnected);
      assert.equal(discResult, null);

      const events = capture.events.filter((e) => e.operation === "data_through_refresh");
      assert.equal(events.length, 2);
      assert.equal(events[0].freshnessOutcome, "unchanged");
      assert.equal(events[0].outcome, "skipped");
      assert.equal(events[1].freshnessOutcome, "unchanged");
      assert.equal(events[1].outcome, "skipped");
    } finally {
      capture.restore();
    }
  });

  it("5b. Connected connection with zero metrics returns null and emits 'unchanged' without advancing", async () => {
    const connEmpty = `conn_empty_${Date.now()}`;
    await prisma.connection.create({
      data: {
        id: connEmpty,
        name: "Empty Connection",
        type: "source",
        workspaceId: wsA,
        provider: "meta_ads",
        status: "connected",
        credentials: "{}",
      },
    });

    const capture = captureTelemetryForTest();
    try {
      const result = await refreshConnectionLastDataThrough(wsA, connEmpty);
      assert.equal(result, null);

      const conn = await prisma.connection.findUnique({ where: { id: connEmpty } });
      assert.equal(conn?.lastDataThrough, null);

      const ev = capture.events.find((e) => e.operation === "data_through_refresh");
      assert.ok(ev);
      assert.equal(ev.freshnessOutcome, "unchanged");
      assert.equal(ev.outcome, "skipped");
    } finally {
      capture.restore();
    }
  });

  it("6. Rival-workspace connection access fails closed and emits 'unchanged'", async () => {
    const capture = captureTelemetryForTest();
    try {
      // wsB attempts to refresh connA (which belongs to wsA)
      const result = await refreshConnectionLastDataThrough(wsB, connA);
      assert.equal(result, null);

      const ev = capture.events.find((e) => e.operation === "data_through_refresh");
      assert.ok(ev);
      assert.equal(ev.opaqueWorkspaceId, toOpaqueWorkspaceId(wsB));
      assert.equal(ev.freshnessOutcome, "unchanged");
      assert.equal(ev.outcome, "skipped");

      // Connection in wsA was not touched
      const conn = await prisma.connection.findUnique({ where: { id: connA } });
      assert.equal(conn?.lastDataThrough, null);
    } finally {
      capture.restore();
    }
  });

  it("7. Concurrent calls with older and newer candidates preserve the newest date atomically", async () => {
    const date2 = new Date("2026-08-28T00:00:00.000Z");

    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA,
        connectionId: connA,
        platform: "meta_ads",
        accountId: "act_123",
        accountName: "Account 123",
        campaignId: "cmp_conc_2",
        campaignName: "Newest",
        date: date2,
        impressions: 200,
        clicks: 10,
        spend: 20,
      },
    });

    const capture = captureTelemetryForTest();
    try {
      // Run two concurrent refreshes
      const [res1, res2] = await Promise.all([
        refreshConnectionLastDataThrough(wsA, connA),
        refreshConnectionLastDataThrough(wsA, connA),
      ]);

      assert.equal(res1?.toISOString(), date2.toISOString());
      assert.equal(res2?.toISOString(), date2.toISOString());

      const finalConn = await prisma.connection.findUnique({ where: { id: connA } });
      assert.equal(finalConn?.lastDataThrough?.toISOString(), date2.toISOString());

      const events = capture.events.filter((e) => e.operation === "data_through_refresh");
      assert.equal(events.length, 2);
      const outcomes = events.map((e) => e.freshnessOutcome);
      // Exactly one must be "advanced" (first atomic updateMany), other is "unchanged"
      assert.ok(outcomes.includes("advanced"));
      assert.ok(outcomes.includes("unchanged"));
    } finally {
      capture.restore();
    }
  });

  it("8. Telemetry sink failure does not prevent database update or throw", async () => {
    setTelemetrySink(() => {
      throw new Error("Deliberate sink explosion");
    });

    const metricDate = new Date("2026-08-29T00:00:00.000Z");
    await prisma.campaignMetric.create({
      data: {
        workspaceId: wsA,
        connectionId: connA,
        platform: "meta_ads",
        accountId: "act_123",
        accountName: "Account 123",
        campaignId: "cmp_sink_fail",
        campaignName: "Sink Failure Isolation",
        date: metricDate,
        impressions: 100,
        clicks: 5,
        spend: 10,
      },
    });

    const result = await refreshConnectionLastDataThrough(wsA, connA);
    assert.ok(result);
    assert.equal(result.toISOString(), metricDate.toISOString());

    const updatedConn = await prisma.connection.findUnique({ where: { id: connA } });
    assert.equal(updatedConn?.lastDataThrough?.toISOString(), metricDate.toISOString());
  });
});
