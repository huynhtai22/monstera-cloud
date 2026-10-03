import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateReportingWindows } from "./reporting-context";
import { getPlanLimits } from "@/lib/plan-config";

describe("Timezone Semantics & Plan Limit Enforcement", () => {
  it("never silently shortens requested periods and validates plan limits", () => {
    const freeLimits = getPlanLimits("free");
    assert.equal(freeLimits.maxHistoryDays, 14);

    const proLimits = getPlanLimits("professional");
    assert.equal(proLimits.maxHistoryDays, undefined);

    const pilotLimits = getPlanLimits("pilot");
    assert.equal(pilotLimits.maxHistoryDays, undefined);

    // Free plan requesting 30 days must be blocked, not silently truncated
    const requestedDays = 30;
    const isExceededForFree = freeLimits.maxHistoryDays != null && requestedDays > freeLimits.maxHistoryDays;
    assert.equal(isExceededForFree, true, "30-day period exceeds free plan 14-day limit");

    const isExceededForPro = proLimits.maxHistoryDays != null && requestedDays > proLimits.maxHistoryDays;
    assert.equal(isExceededForPro, false, "30-day period is within professional plan limits");
  });

  it("handles UTC date boundaries without shifting daily dates", () => {
    const now = new Date("2026-09-24T00:01:00.000Z");
    const windows = calculateReportingWindows("last_7d", now, "UTC", "verified");

    // 'Today' in UTC is 2026-09-24, so yesterday (last completed day) is 2026-09-23
    assert.equal(windows.current.end, "2026-09-23");
    assert.equal(windows.current.start, "2026-09-17");
    assert.equal(windows.timezone, "UTC");
    assert.equal(windows.timezoneSource, "verified");
  });

  it("derives wall-clock yesterday in Asia/Ho_Chi_Minh (UTC+7)", () => {
    // 2026-09-23T18:00:00.000Z is 2026-09-24 01:00:00 in VN (+7h).
    // Today in VN is Sep 24 -> last completed day is Sep 23.
    const now1 = new Date("2026-09-23T18:00:00.000Z");
    const w1 = calculateReportingWindows("last_7d", now1, "Asia/Ho_Chi_Minh", "verified");
    assert.equal(w1.current.end, "2026-09-23");

    // 2026-09-23T16:00:00.000Z is 2026-09-23 23:00:00 in VN.
    // Today in VN is still Sep 23 -> last completed day is Sep 22!
    const now2 = new Date("2026-09-23T16:00:00.000Z");
    const w2 = calculateReportingWindows("last_7d", now2, "Asia/Ho_Chi_Minh", "verified");
    assert.equal(w2.current.end, "2026-09-22");
  });

  it("handles Daylight Saving Time in America/New_York (summer EDT vs winter EST)", () => {
    // Summer (EDT = UTC-4): 2026-07-15T03:30:00Z = July 14 23:30 EDT -> today=Jul 14, yesterday=Jul 13
    const summerNow = new Date("2026-07-15T03:30:00.000Z");
    const wSummer = calculateReportingWindows("last_7d", summerNow, "America/New_York", "verified");
    assert.equal(wSummer.current.end, "2026-07-13");

    // Winter (EST = UTC-5): 2026-01-15T04:30:00Z = Jan 14 23:30 EST -> today=Jan 14, yesterday=Jan 13
    const winterNow = new Date("2026-01-15T04:30:00.000Z");
    const wWinter = calculateReportingWindows("last_7d", winterNow, "America/New_York", "verified");
    assert.equal(wWinter.current.end, "2026-01-13");
  });

  it("gracefully falls back to UTC with inferred source on unknown or invalid timezone", () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const wInvalid = calculateReportingWindows("last_7d", now, "Not_A_Real_Timezone", "verified");
    assert.equal(wInvalid.timezone, "UTC");
    assert.equal(wInvalid.timezoneSource, "inferred");
    assert.equal(wInvalid.current.end, "2026-09-23");
  });
});

describe("Plan Limits Enforcement across Current and Prior Windows (resolveReportingContext)", () => {
  function createPlanMockTx(plan: string) {
    let metricQueries = 0;
    const metricWindows: { start: string; end: string }[] = [];

    const tx: any = {
      $queryRaw: async () => [],
      client: {
        findFirst: async ({ where }: any) => ({
          id: where.id,
          name: "Acme Client",
          accountAssignmentsConfiguredAt: new Date("2026-09-01T00:00:00Z"),
          requirementsConfiguredAt: new Date("2026-09-01T00:00:00Z"),
          requiredProviders: ["meta_ads"],
          requiredDestinations: [],
          workspace: { id: where.workspaceId, plan },
        }),
        findMany: async () => [
          {
            id: "client_1",
            name: "Acme Client",
            accountAssignmentsConfiguredAt: new Date("2026-09-01T00:00:00Z"),
            requirementsConfiguredAt: new Date("2026-09-01T00:00:00Z"),
            requiredProviders: ["meta_ads"],
            requiredDestinations: [],
          },
        ],
      },
      clientProviderAccountAssignment: {
        findMany: async () => [
          {
            id: "asgn_1",
            provider: "meta_ads",
            accountId: "act_1",
            connectionId: "conn_1",
            assignedAt: new Date("2026-09-01T00:00:00Z"),
            updatedAt: new Date("2026-09-01T00:00:00Z"),
          },
        ],
      },
      connection: {
        findMany: async () => [
          {
            id: "conn_1",
            workspaceId: "ws_1",
            clientId: "client_1",
            provider: "meta_ads",
            type: "source",
            status: "active",
          },
        ],
      },
      accountReportingContext: {
        findMany: async () => [
          {
            provider: "meta_ads",
            accountId: "act_1",
            reportingTimezone: "Asia/Ho_Chi_Minh",
            verifiedAt: new Date("2026-09-01T00:00:00Z"),
            updatedAt: new Date("2026-09-01T00:00:00Z"),
          },
        ],
      },
      connectionMetricDay: {
        findMany: async () => [],
      },
      campaignMetric: {
        findMany: async (args: any) => {
          if (args?.select?.spend) {
            metricQueries++;
            if (args?.where?.date?.gte) {
              metricWindows.push({
                start: args.where.date.gte.toISOString().slice(0, 10),
                end: args.where.date.lte.toISOString().slice(0, 10),
              });
            }
          }
          return [
            {
              platform: "meta_ads",
              currency: "USD",
              spend: 1500,
              impressions: 25000,
              clicks: 400,
              conversions: 15,
              revenue: 4500,
              campaignId: "camp_1",
              entityId: "camp_1",
              breakdownHash: "bh_1",
              pulledAt: new Date("2026-09-20T00:00:00Z"),
              createdAt: new Date("2026-09-20T00:00:00Z"),
              date: new Date("2026-09-20T00:00:00Z"),
            },
          ];
        },
        groupBy: async () => [],
      },
      providerAccountHealth: {
        findMany: async () => [],
      },
      providerSyncRun: {
        findMany: async () => [],
      },
      warehouseImportJob: {
        findMany: async () => [],
      },
      destinationReceipt: {
        findMany: async () => [],
      },
      pipeline: {
        findMany: async () => [],
      },
      getMetricQueries: () => metricQueries,
      getMetricWindows: () => metricWindows,
    };

    return tx;
  }

  it("1. Current window disallowed: throws 403 PLAN_LIMIT_EXCEEDED when current window exceeds history limits", async () => {
    const { resolveReportingContext } = await import("./reporting-context");
    const tx = createPlanMockTx("free"); // Free plan: 14 days max history

    await assert.rejects(
      async () => {
        await resolveReportingContext({
          workspaceId: "ws_1",
          clientId: "client_1",
          preset: "last_30d", // 30 days > 14 days limit
          now: new Date("2026-09-24T12:00:00Z"),
          tx,
        });
      },
      (err: any) => {
        assert.equal(err.code, "PLAN_LIMIT_EXCEEDED");
        assert.equal(err.statusCode, 403);
        assert.match(err.message, /exceeds Start plan limit \(14 days max history\)/);
        return true;
      },
    );
  });

  it("2. Current permitted, prior outside history: returns comparison unavailable, omits prior queries, and clears deltas", async () => {
    const { resolveReportingContext } = await import("./reporting-context");
    const { PLAN_LIMITS } = await import("@/lib/plan-config");

    // Define a 10-day history plan to test boundary where 7d current window is within 10d, but 14d prior extends past 10d
    (PLAN_LIMITS as any).limited_history_10d = {
      ...PLAN_LIMITS.free,
      maxHistoryDays: 10,
      displayName: "Limited 10D Tier",
    };

    const tx = createPlanMockTx("limited_history_10d");
    const context = await resolveReportingContext({
      workspaceId: "ws_1",
      clientId: "client_1",
      preset: "last_7d",
      now: new Date("2026-09-24T12:00:00Z"),
      tx,
    });

    // A. Comparison is explicitly marked unavailable with reason
    assert.equal(context.windows.comparisonAvailable, false);
    assert.ok(typeof context.windows.comparisonUnavailableReason === "string");
    assert.match(context.windows.comparisonUnavailableReason!, /limited to 10 days history/);

    // B. Prior queries are OMITTED: metric queries ran exactly 1 time (current window only, zero prior queries)
    assert.equal(tx.getMetricQueries(), 1);
    assert.equal(tx.getMetricWindows().length, 1);
    assert.equal(tx.getMetricWindows()[0].start, context.windows.current.start);

    // C. Deltas and prior values are null across all metrics
    for (const metric of context.metrics) {
      assert.equal(metric.priorValue, null, `Metric ${metric.metricId} priorValue must be null`);
      assert.equal(metric.absoluteChange, null, `Metric ${metric.metricId} absoluteChange must be null`);
      assert.equal(metric.percentageChange, null, `Metric ${metric.metricId} percentageChange must be null`);
      assert.equal(metric.status, "unavailable", `Metric ${metric.metricId} status must be unavailable`);
      assert.ok(
        metric.limitations.some((lim) => lim.includes("Prior period comparison unavailable")),
        `Metric ${metric.metricId} limitations must explain unavailable comparison`,
      );
    }

    // D. Observations include explicit comparison limitation observation
    const compObs = context.observations.find((o) => o.id === "obs_comparison_plan_limited");
    assert.ok(compObs, "Must generate obs_comparison_plan_limited observation");
    assert.match(compObs!.text, /limited to 10 days history/);

    // E. Observations do NOT contain comparison delta claims (e.g. "increased by X% compared to prior")
    for (const obs of context.observations) {
      assert.doesNotMatch(obs.text, /compared to prior period/i);
    }
  });

  it("3. Both windows permitted: queries both periods and computes deltas when history allows", async () => {
    const { resolveReportingContext } = await import("./reporting-context");
    const tx = createPlanMockTx("professional"); // Professional: unlimited history

    const context = await resolveReportingContext({
      workspaceId: "ws_1",
      clientId: "client_1",
      preset: "last_7d",
      now: new Date("2026-09-24T12:00:00Z"),
      tx,
    });

    // Comparison is available
    assert.equal(context.windows.comparisonAvailable, true);
    assert.equal(context.windows.comparisonUnavailableReason, null);

    // Metric queries ran 2 times (current window + prior window)
    assert.equal(tx.getMetricQueries(), 2);
    assert.equal(tx.getMetricWindows().length, 2);

    // Spend metric has prior value and delta status
    const spend = context.metrics.find((m) => m.metricId === "spend");
    assert.ok(spend);
    assert.equal(spend!.priorValue, 1500);
    assert.equal(spend!.status, "available");
    assert.equal(spend!.percentageChange, 0); // 1500 vs 1500 -> 0%
  });
});
