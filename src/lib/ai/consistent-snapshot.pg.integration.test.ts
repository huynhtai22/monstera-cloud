import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import prisma from "@/lib/prisma";
import { resolveReportingContext } from "./reporting-context";

describe("PostgreSQL Integration: Consistent Reporting Snapshot & Concurrency", () => {
  const workspaceId = `ws_snap_${Date.now()}`;
  const userId = `usr_snap_${Date.now()}`;
  const clientId = `cl_snap_${Date.now()}`;
  const connectionId = `conn_snap_${Date.now()}`;

  before(async () => {
    // Setup isolated test workspace, user, connection, client
    await prisma.user.create({
      data: {
        id: userId,
        email: `snap_${Date.now()}@example.com`,
      },
    });

    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Snapshot Test Workspace",
        slug: `snap-ws-${Date.now()}`,
        plan: "professional",
        ownerId: userId,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId,
        role: "owner",
      },
    });

    await prisma.client.create({
      data: {
        id: clientId,
        workspaceId,
        name: "Snapshot Client",
      },
    });

    await prisma.connection.create({
      data: {
        id: connectionId,
        workspaceId,
        clientId,
        name: "Meta Ads Source",
        provider: "meta_ads",
        type: "source",
        status: "active",
        credentials: "{}",
      },
    });

    // Seed baseline CampaignMetric rows (past 5 days)
    const dates = [
      new Date("2026-09-19T00:00:00.000Z"),
      new Date("2026-09-20T00:00:00.000Z"),
      new Date("2026-09-21T00:00:00.000Z"),
      new Date("2026-09-22T00:00:00.000Z"),
      new Date("2026-09-23T00:00:00.000Z"),
    ];

    for (let i = 0; i < dates.length; i++) {
      await prisma.campaignMetric.create({
        data: {
          workspaceId,
          connectionId,
          platform: "meta_ads",
          accountId: "act_snap_1",
          level: "campaign",
          entityId: `camp_${i}`,
          campaignId: `camp_${i}`,
          campaignName: `Campaign ${i}`,
          date: dates[i],
          spend: 1000,
          impressions: 10000,
          clicks: 250,
          conversions: 10,
          revenue: 3500,
          currency: "USD",
        },
      });
    }
  });

  after(async () => {
    // Cleanup test data
    await prisma.campaignMetric.deleteMany({ where: { workspaceId } });
    await prisma.connection.deleteMany({ where: { workspaceId } });
    await prisma.client.deleteMany({ where: { workspaceId } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("evaluates reporting context in a single consistent transaction without tearing", async () => {
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");

    const context = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
      now: fakeNow,
    });

    assert.equal(context.workspaceId, workspaceId);
    assert.equal(context.clientId, clientId);
    assert.equal(context.clientName, "Snapshot Client");
    assert.ok(context.fingerprint.length > 0);

    const spendMetric = context.metrics.find((m) => m.metricId === "spend");
    assert.ok(spendMetric);
    // 5 days of 1000 spend = 5000
    assert.equal(spendMetric.currentValue, 5000);
  });

  it("releases transaction before returning, permitting subsequent concurrent database work", async () => {
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");

    // 1. Resolve context
    const context = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
      now: fakeNow,
    });

    assert.ok(context.fingerprint);

    // 2. Insert new concurrent metric row in separate transaction (proves no locks remain open)
    const newMetric = await prisma.campaignMetric.create({
      data: {
        workspaceId,
        connectionId,
        platform: "meta_ads",
        accountId: "act_snap_1",
        level: "campaign",
        entityId: "camp_concurrent",
        campaignId: "camp_concurrent",
        campaignName: "Campaign Concurrent",
        date: new Date("2026-09-23T00:00:00.000Z"),
        spend: 500,
        impressions: 5000,
        clicks: 100,
        conversions: 4,
        revenue: 1500,
        currency: "USD",
      },
    });

    assert.ok(newMetric.id);

    // 3. New context resolution immediately reflects updated fingerprint
    const updatedContext = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
      now: fakeNow,
    });

    assert.notEqual(
      updatedContext.fingerprint,
      context.fingerprint,
      "Fingerprint must change when new metrics are ingested",
    );

    const updatedSpend = updatedContext.metrics.find((m) => m.metricId === "spend");
    assert.equal(updatedSpend?.currentValue, 5500);
  });

  it("preserves snapshot isolation: concurrent commit during resolution is NOT visible in RepeatableRead transaction", async () => {
    const fakeNow = new Date("2026-09-24T12:00:00.000Z");

    let concurrentInsertDone = false;

    // Connection 1 enters RepeatableRead transaction.
    // Connection 2 inserts and commits during onAfterReadiness hook.
    // Connection 1's subsequent query runs in the same transaction and must NOT see the concurrent commit.
    const context = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
      now: fakeNow,
      onAfterReadiness: async () => {
        // Concurrently insert a new metric row outside connection 1's transaction
        await prisma.campaignMetric.create({
          data: {
            workspaceId,
            connectionId,
            platform: "meta_ads",
            accountId: "act_snap_1",
            level: "campaign",
            entityId: "camp_barrier_test",
            campaignId: "camp_barrier_test",
            campaignName: "Campaign Barrier Test",
            date: new Date("2026-09-23T00:00:00.000Z"),
            spend: 2000,
            impressions: 20000,
            clicks: 500,
            conversions: 20,
            revenue: 7000,
            currency: "USD",
          },
        });
        concurrentInsertDone = true;
      },
    });

    assert.equal(concurrentInsertDone, true);
    const spendMetric = context.metrics.find((m) => m.metricId === "spend");
    // Baseline was 5000 + 500 from previous test = 5500.
    // Must NOT observe the 2000 spend committed by connection 2 during resolution!
    assert.equal(
      spendMetric?.currentValue,
      5500,
      "Must NOT observe concurrent metric commit made during RepeatableRead transaction",
    );

    // Subsequent resolution outside the transaction DOES observe the new row (5500 + 2000 = 7500)
    const afterContext = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
      now: fakeNow,
    });
    const afterSpend = afterContext.metrics.find((m) => m.metricId === "spend");
    assert.equal(afterSpend?.currentValue, 7500);
  });
});
