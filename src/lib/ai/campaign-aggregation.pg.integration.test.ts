import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import prisma from "@/lib/prisma";
import { assertAllowedTestDatabase } from "@/lib/pg-test-discipline";
import { queryMetricsAggregate } from "@/lib/warehouse-aggregate";
import { runAnalystTurn, defaultWindow } from "./analyst";
import { reportingDataset } from "@/lib/report-delivery";
import type { ScopedTransaction } from "@/lib/warehouse-query";

describe("PostgreSQL Integration: Campaign Aggregation & Analyst Ranking Semantics", () => {
  const timestamp = Date.now();
  const workspaceId = `ws_camp_${timestamp}`;
  const userId = `usr_camp_${timestamp}`;
  const clientId = `cl_camp_${timestamp}`;
  const connMetaId = `conn_camp_meta_${timestamp}`;
  const connGoogleId = `conn_camp_goog_${timestamp}`;
  const acctMeta = `act_meta_${timestamp}`;
  const acctGoog = `act_goog_${timestamp}`;

  before(async () => {
    assertAllowedTestDatabase(process.env.DATABASE_URL);

    await prisma.user.create({
      data: {
        id: userId,
        email: `camp_analyst_${timestamp}@example.com`,
      },
    });

    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Campaign Aggregation Test Workspace",
        slug: `camp-ws-${timestamp}`,
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
        name: "Brand Zenith",
        requiredProviders: ["meta_ads", "google_ads"],
        requiredDestinations: ["google_sheets"],
        requirementsConfiguredAt: new Date(),
        accountAssignmentsConfiguredAt: new Date(),
      },
    });

    await prisma.connection.create({
      data: {
        id: connMetaId,
        workspaceId,
        clientId,
        name: "Meta Ads Connection",
        provider: "meta_ads",
        type: "source",
        status: "connected",
        remoteAccountId: acctMeta,
        credentials: "{}",
        lastSyncAt: new Date(),
      },
    });

    await prisma.connection.create({
      data: {
        id: connGoogleId,
        workspaceId,
        clientId,
        name: "Google Ads Connection",
        provider: "google_ads",
        type: "source",
        status: "connected",
        remoteAccountId: acctGoog,
        credentials: "{}",
        lastSyncAt: new Date(),
      },
    });

    await prisma.clientProviderAccountAssignment.createMany({
      data: [
        {
          workspaceId,
          clientId,
          connectionId: connMetaId,
          provider: "meta_ads",
          accountId: acctMeta,
        },
        {
          workspaceId,
          clientId,
          connectionId: connGoogleId,
          provider: "google_ads",
          accountId: acctGoog,
        },
      ],
    });

    await prisma.accountReportingContext.createMany({
      data: [
        {
          workspaceId,
          connectionId: connMetaId,
          accountId: acctMeta,
          providerTimezone: "UTC",
          providerCurrency: "USD",
          providerObservedAt: new Date(),
        },
        {
          workspaceId,
          connectionId: connGoogleId,
          accountId: acctGoog,
          providerTimezone: "UTC",
          providerCurrency: "USD",
          providerObservedAt: new Date(),
        },
      ],
    });

    // Seed multiple rows across 2 dates for 3 distinct campaigns:
    // 1. "Alpha Brand Awareness" (meta_ads):
    //    Day 1: Spend 1,000, Revenue 3,000, Conv 10, Clicks 200, Imp 5000
    //    Day 2: Spend 1,500, Revenue 7,000, Conv 20, Clicks 300, Imp 7000
    //    Total: Spend 2,500, Revenue 10,000, Conv 30
    // 2. "Beta Retargeting Promo" (meta_ads):
    //    Day 1: Spend 500, Revenue 2,000, Conv 5, Clicks 100, Imp 2000
    //    Day 2: Spend 500, Revenue 3,000, Conv 8, Clicks 150, Imp 3000
    //    Total: Spend 1,000, Revenue 5,000, Conv 13
    // 3. "Gamma High-Intent Search" (google_ads):
    //    Day 1: Spend 3,000, Revenue 15,000, Conv 40, Clicks 600, Imp 12000
    //    Day 2: Spend 3,000, Revenue 25,000, Conv 60, Clicks 900, Imp 18000
    //    Total: Spend 6,000, Revenue 40,000, Conv 100

    const day1 = new Date("2026-09-20T12:00:00.000Z");
    const day2 = new Date("2026-09-21T12:00:00.000Z");

    const dw = defaultWindow();
    const minStart = dw.startDate < "2026-09-18" ? dw.startDate : "2026-09-18";
    const maxEnd = dw.endDate > "2026-09-25" ? dw.endDate : "2026-09-25";

    const fillerDates: Date[] = [];
    const cur = new Date(`${minStart}T12:00:00.000Z`);
    const endBound = new Date(`${maxEnd}T12:00:00.000Z`);
    while (cur <= endBound) {
      const dStr = cur.toISOString().slice(0, 10);
      if (dStr !== "2026-09-20" && dStr !== "2026-09-21") {
        fillerDates.push(new Date(cur));
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const fillerRows = fillerDates.flatMap((d) => [
      {
        workspaceId,
        connectionId: connMetaId,
        platform: "meta_ads",
        accountId: acctMeta,
        entityId: "cmp_alpha",
        campaignId: "cmp_alpha",
        campaignName: "Alpha Brand Awareness",
        date: d,
        currency: "USD",
        spend: 0,
        revenue: 0,
        conversions: 0,
        clicks: 0,
        impressions: 0,
      },
      {
        workspaceId,
        connectionId: connGoogleId,
        platform: "google_ads",
        accountId: acctGoog,
        entityId: "cmp_gamma",
        campaignId: "cmp_gamma",
        campaignName: "Gamma High-Intent Search",
        date: d,
        currency: "USD",
        spend: 0,
        revenue: 0,
        conversions: 0,
        clicks: 0,
        impressions: 0,
      },
    ]);

    await prisma.campaignMetric.createMany({
      data: [
        {
          workspaceId,
          connectionId: connMetaId,
          platform: "meta_ads",
          accountId: acctMeta,
          entityId: "cmp_alpha",
          campaignId: "cmp_alpha",
          campaignName: "Alpha Brand Awareness",
          date: day1,
          currency: "USD",
          spend: 1000,
          revenue: 3000,
          conversions: 10,
          clicks: 200,
          impressions: 5000,
        },
        {
          workspaceId,
          connectionId: connMetaId,
          platform: "meta_ads",
          accountId: acctMeta,
          entityId: "cmp_alpha",
          campaignId: "cmp_alpha",
          campaignName: "Alpha Brand Awareness",
          date: day2,
          currency: "USD",
          spend: 1500,
          revenue: 7000,
          conversions: 20,
          clicks: 300,
          impressions: 7000,
        },
        {
          workspaceId,
          connectionId: connMetaId,
          platform: "meta_ads",
          accountId: acctMeta,
          entityId: "cmp_beta",
          campaignId: "cmp_beta",
          campaignName: "Beta Retargeting Promo",
          date: day1,
          currency: "USD",
          spend: 500,
          revenue: 2000,
          conversions: 5,
          clicks: 100,
          impressions: 2000,
        },
        {
          workspaceId,
          connectionId: connMetaId,
          platform: "meta_ads",
          accountId: acctMeta,
          entityId: "cmp_beta",
          campaignId: "cmp_beta",
          campaignName: "Beta Retargeting Promo",
          date: day2,
          currency: "USD",
          spend: 500,
          revenue: 3000,
          conversions: 8,
          clicks: 150,
          impressions: 3000,
        },
        {
          workspaceId,
          connectionId: connGoogleId,
          platform: "google_ads",
          accountId: acctGoog,
          entityId: "cmp_gamma",
          campaignId: "cmp_gamma",
          campaignName: "Gamma High-Intent Search",
          date: day1,
          currency: "USD",
          spend: 3000,
          revenue: 15000,
          conversions: 40,
          clicks: 600,
          impressions: 12000,
        },
        {
          workspaceId,
          connectionId: connGoogleId,
          platform: "google_ads",
          accountId: acctGoog,
          entityId: "cmp_gamma",
          campaignId: "cmp_gamma",
          campaignName: "Gamma High-Intent Search",
          date: day2,
          currency: "USD",
          spend: 3000,
          revenue: 25000,
          conversions: 60,
          clicks: 900,
          impressions: 18000,
        },
        ...fillerRows,
      ],
    });

    // Seed delivery receipt so readiness evaluates cleanly for analyst tests
    const window = { start: dw.startDate, end: dw.endDate };
    const dataset = await prisma.$transaction((tx) =>
      reportingDataset(tx as unknown as ScopedTransaction, workspaceId, clientId, window, ["meta_ads", "google_ads"]));

    await prisma.destinationDeliveryReceipt.create({
      data: {
        workspaceId,
        clientId,
        destination: "google_sheets",
        windowStart: window.start,
        windowEnd: window.end,
        dataThroughDate: dataset.dataThroughDate ?? window.end,
        datasetFingerprint: dataset.fingerprint,
        rowCount: dataset.rowCount,
        actorId: userId,
      },
    });
  });

  after(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.destinationDeliveryReceipt.deleteMany({ where: { workspaceId } });
        await tx.campaignMetric.deleteMany({ where: { workspaceId } });
        await tx.accountReportingContext.deleteMany({ where: { workspaceId } });
        await tx.clientProviderAccountAssignment.deleteMany({ where: { workspaceId } });
        await tx.connection.deleteMany({ where: { workspaceId } });
        await tx.client.deleteMany({ where: { workspaceId } });
        await tx.workspaceMember.deleteMany({ where: { workspaceId } });
        await tx.workspace.delete({ where: { id: workspaceId } });
        await tx.user.delete({ where: { id: userId } });
      });
    } catch {
      // Best-effort cleanup
    }
  });

  it("aggregates dimensions: ['campaignName', 'platform'] with exact sums and deterministic ordering without P2019", async () => {
    const result = await queryMetricsAggregate({
      workspaceId,
      clientId,
      startDateStr: "2026-09-18",
      endDateStr: "2026-09-24",
      dimensions: ["campaignName", "platform"],
      metrics: ["revenue", "spend"],
      strictReporting: true,
    });

    assert.equal(result.mode, "aggregate");
    assert.equal(result.rows.length, 3, "Expected 3 grouped campaign-platform rows");

    // Deterministic ordering by grouped fields: campaignName asc, platform asc
    const [row0, row1, row2] = result.rows;

    // Row 0: Alpha Brand Awareness (meta_ads)
    assert.equal(row0.campaignName, "Alpha Brand Awareness");
    assert.equal(row0.platform, "meta_ads");
    assert.equal(row0["metric:spend"], 2500, "Spend should equal 1000 + 1500");
    assert.equal(row0["metric:revenue"], 10000, "Revenue should equal 3000 + 7000");

    // Row 1: Beta Retargeting Promo (meta_ads)
    assert.equal(row1.campaignName, "Beta Retargeting Promo");
    assert.equal(row1.platform, "meta_ads");
    assert.equal(row1["metric:spend"], 1000, "Spend should equal 500 + 500");
    assert.equal(row1["metric:revenue"], 5000, "Revenue should equal 2000 + 3000");

    // Row 2: Gamma High-Intent Search (google_ads)
    assert.equal(row2.campaignName, "Gamma High-Intent Search");
    assert.equal(row2.platform, "google_ads");
    assert.equal(row2["metric:spend"], 6000, "Spend should equal 3000 + 3000");
    assert.equal(row2["metric:revenue"], 40000, "Revenue should equal 15000 + 25000");

    // Full strict reporting totals
    assert.ok(result.fullTotals, "fullTotals must be computed in strictReporting mode");
    assert.equal(result.fullTotals.spend, 9500);
    assert.equal(result.fullTotals.revenue, 55000);
    assert.equal(result.truncated, false);
  });

  it("preserves date-descending ordering when date is included in dimensions", async () => {
    const result = await queryMetricsAggregate({
      workspaceId,
      clientId,
      startDateStr: "2026-09-18",
      endDateStr: "2026-09-24",
      dimensions: ["date", "campaignName"],
      metrics: ["spend"],
      strictReporting: true,
    });

    assert.ok(result.rows.length >= 2);
    // Top rows should have the latest date (2026-09-24)
    const dates = result.rows.map((r) => r.date as string);
    assert.equal(dates[0], "2026-09-24");
    assert.ok(dates.includes("2026-09-20"));
    for (let i = 0; i < dates.length - 1; i++) {
      assert.ok(dates[i] >= dates[i + 1], `Dates should be descending: ${dates[i]} >= ${dates[i + 1]}`);
    }
  });

  it("exercises campaign contribution analysis in runAnalystTurn through the real PostgreSQL path", async () => {
    const turn = await runAnalystTurn({
      workspaceId,
      actorUserId: userId,
      clientId,
      question: "Which campaigns contributed most to the revenue change?",
      acknowledgeBestEffort: true,
    });

    if (turn.status !== "answered") {
      console.error("DEBUG TURN REFUSAL:", JSON.stringify(turn, null, 2));
    }

    assert.equal(turn.status, "answered", "Analyst turn must succeed through real database aggregation");
    assert.ok(turn.structured, "Must return structured output");
    assert.equal(turn.structured.isAgencyOverview, false);

    // Verify observations order by revenue descending:
    // 1. Gamma High-Intent Search ($40,000 revenue)
    // 2. Alpha Brand Awareness ($10,000 revenue)
    // 3. Beta Retargeting Promo ($5,000 revenue)
    const obs = turn.structured.observations;
    assert.ok(obs.length >= 3, `Expected at least 3 campaign observations, got ${obs.length}`);

    const gammaObs = obs.find((o) => o.text.includes("Gamma High-Intent Search"));
    const alphaObs = obs.find((o) => o.text.includes("Alpha Brand Awareness"));
    const betaObs = obs.find((o) => o.text.includes("Beta Retargeting Promo"));

    assert.ok(gammaObs, "Gamma High-Intent Search must be present in observations");
    assert.ok(alphaObs, "Alpha Brand Awareness must be present in observations");
    assert.ok(betaObs, "Beta Retargeting Promo must be present in observations");

    assert.ok(gammaObs.text.includes("40,000.00 USD"), "Gamma revenue must be exactly 40,000.00 USD");
    assert.ok(gammaObs.text.includes("6,000.00 spend"), "Gamma spend must be exactly 6,000.00 spend");
    assert.ok(gammaObs.text.includes("google_ads"), "Gamma platform must be google_ads");

    assert.ok(alphaObs.text.includes("10,000.00 USD"), "Alpha revenue must be exactly 10,000.00 USD");
    assert.ok(alphaObs.text.includes("2,500.00 spend"), "Alpha spend must be exactly 2,500.00 spend");

    // Check rank ordering in observations: Gamma before Alpha before Beta
    const gammaIndex = obs.indexOf(gammaObs);
    const alphaIndex = obs.indexOf(alphaObs);
    const betaIndex = obs.indexOf(betaObs);

    assert.ok(gammaIndex < alphaIndex, "Top revenue campaign (Gamma) must rank before 2nd (Alpha)");
    assert.ok(alphaIndex < betaIndex, "2nd revenue campaign (Alpha) must rank before 3rd (Beta)");
  });
});
