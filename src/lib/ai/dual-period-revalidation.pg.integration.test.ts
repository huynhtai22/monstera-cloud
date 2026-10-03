import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import prisma from "@/lib/prisma";
import { assertAllowedTestDatabase } from "@/lib/pg-test-discipline";
import { resolveReportingContext, calculateReportingWindows, setReportingClockOverride } from "./reporting-context";
import { POST } from "@/app/api/ai/executive-brief/route";
import { setAuthSessionOverride } from "@/lib/auth-session";

describe("PostgreSQL Integration: Dual-Period Fingerprint & Export Revalidation", () => {
  const timestamp = Date.now();
  const workspaceId = `ws_dual_${timestamp}`;
  const userId = `usr_dual_${timestamp}`;
  const userEmail = `analyst_dual_${timestamp}@example.com`;
  const clientId = `cl_dual_${timestamp}`;
  const connectionId = `conn_dual_${timestamp}`;
  const accountId = `act_dual_${timestamp}`;

  // Fixed test clock shared deterministically by fixture generation, context resolution, and real export handler
  const fixedNow = new Date("2026-09-24T12:00:00.000Z");
  const baseWindows = calculateReportingWindows("last_7d", fixedNow, "Asia/Ho_Chi_Minh", "verified");

  function getDatesInRange(startStr: string, endStr: string): Date[] {
    const dates: Date[] = [];
    const curr = new Date(`${startStr}T00:00:00.000Z`);
    const end = new Date(`${endStr}T00:00:00.000Z`);
    while (curr <= end) {
      dates.push(new Date(curr));
      curr.setUTCDate(curr.getUTCDate() + 1);
    }
    return dates;
  }

  const currentDates = getDatesInRange(baseWindows.current.start, baseWindows.current.end);
  const priorDates = getDatesInRange(baseWindows.prior.start, baseWindows.prior.end);
  const priorMutateDate = priorDates[0];

  before(async () => {
    assertAllowedTestDatabase(process.env.DATABASE_URL);
    setReportingClockOverride(fixedNow);

    // 1. Create User and Workspace on professional plan (unlimited history)
    await prisma.user.create({
      data: {
        id: userId,
        email: userEmail,
      },
    });

    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Dual Period Revalidation Workspace",
        slug: `dual-ws-${timestamp}`,
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

    // 2. Create Client with configured account assignments
    await prisma.client.create({
      data: {
        id: clientId,
        workspaceId,
        name: "Dual Period Client",
        accountAssignmentsConfiguredAt: new Date("2026-09-01T00:00:00.000Z"),
        requirementsConfiguredAt: new Date("2026-09-01T00:00:00.000Z"),
        requiredProviders: ["meta_ads"],
      },
    });

    // 3. Create Connection
    await prisma.connection.create({
      data: {
        id: connectionId,
        workspaceId,
        clientId,
        name: "Meta Ads Dual Source",
        provider: "meta_ads",
        type: "source",
        status: "active",
        credentials: "{}",
      },
    });

    // 4. Assign Account to Client
    await prisma.clientProviderAccountAssignment.create({
      data: {
        workspaceId,
        clientId,
        connectionId,
        provider: "meta_ads",
        accountId,
      },
    });

    // 5. Provide Verified Account Reporting Context (Asia/Ho_Chi_Minh)
    await prisma.accountReportingContext.create({
      data: {
        workspaceId,
        connectionId,
        accountId,
        providerTimezone: "Asia/Ho_Chi_Minh",
        providerCurrency: "USD",
        providerObservedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    // 6. Seed Baseline CampaignMetric Rows: 7 days in Current period, 7 days in Prior period
    for (let i = 0; i < currentDates.length; i++) {
      await prisma.campaignMetric.create({
        data: {
          workspaceId,
          connectionId,
          platform: "meta_ads",
          accountId,
          level: "campaign",
          entityId: `camp_curr_${i}`,
          campaignId: `camp_curr_${i}`,
          campaignName: `Current Campaign ${i}`,
          date: currentDates[i],
          spend: 1000,
          impressions: 10000,
          clicks: 250,
          conversions: 10,
          revenue: 3500,
          currency: "USD",
        },
      });
    }

    for (let i = 0; i < priorDates.length; i++) {
      await prisma.campaignMetric.create({
        data: {
          workspaceId,
          connectionId,
          platform: "meta_ads",
          accountId,
          level: "campaign",
          entityId: `camp_prior_${i}`,
          campaignId: `camp_prior_${i}`,
          campaignName: `Prior Campaign ${i}`,
          date: priorDates[i],
          spend: 800,
          impressions: 8000,
          clicks: 200,
          conversions: 8,
          revenue: 2800,
          currency: "USD",
        },
      });
    }
  });

  after(async () => {
    setReportingClockOverride(null);
    setAuthSessionOverride(null);
    await prisma.campaignMetric.deleteMany({ where: { workspaceId } });
    await prisma.accountReportingContext.deleteMany({ where: { workspaceId } });
    await prisma.clientProviderAccountAssignment.deleteMany({ where: { workspaceId } });
    await prisma.connection.deleteMany({ where: { workspaceId } });
    await prisma.client.deleteMany({ where: { workspaceId } });
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("binds brief export to both reporting periods: prior-period mutation changes brief fingerprint while current-period dataset fingerprint is unchanged, returning 409 on export", async () => {
    // 1. Resolve initial reporting context preview using the real reporting-context resolver
    const preview1 = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
    });

    const initialBriefFingerprint = preview1.fingerprint;
    const initialCurrentDatasetFingerprint = preview1.readiness.fingerprint;

    assert.ok(initialBriefFingerprint, "Initial brief fingerprint must be defined");
    assert.ok(initialCurrentDatasetFingerprint, "Initial current-period dataset fingerprint must be defined");
    assert.equal(preview1.windows.comparisonAvailable, true);

    // 2. Mutate ONLY a prior-period metric row (strictly in the prior window)
    const updateResult = await prisma.campaignMetric.updateMany({
      where: {
        workspaceId,
        date: priorMutateDate,
      },
      data: {
        spend: 1500, // Modified from 800
        revenue: 5200, // Modified from 2800
        clicks: 350, // Modified from 200
      },
    });
    assert.equal(updateResult.count, 1, "Exactly one prior-period row should be mutated");

    // 3. Resolve reporting context again using the real reporting-context resolver
    const preview2 = await resolveReportingContext({
      workspaceId,
      clientId,
      preset: "last_7d",
    });

    // 4. Assert that:
    //    A. Current-period dataset fingerprint (readiness.fingerprint) remains UNCHANGED
    assert.equal(
      preview2.readiness.fingerprint,
      initialCurrentDatasetFingerprint,
      "Current-period dataset fingerprint must remain unchanged when only prior-period data mutates (destination receipt contract)",
    );

    //    B. Composite brief-specific fingerprint HAS CHANGED
    assert.notEqual(
      preview2.fingerprint,
      initialBriefFingerprint,
      "Brief-specific composite fingerprint MUST change when prior-period comparison data mutates",
    );

    // 5. Submit original preview fingerprint to the real export handler and assert HTTP 409 Conflict
    setAuthSessionOverride(async () => ({
      user: { id: userId, email: userEmail },
      expires: "2026-12-31T00:00:00.000Z",
    }));

    const exportReq = new Request("http://localhost/api/ai/executive-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        clientId,
        dateRange: "last_7d",
        action: "export",
        expectedFingerprint: initialBriefFingerprint, // Stale preview fingerprint
        format: "markdown",
      }),
    });

    const exportRes = await POST(exportReq);

    assert.equal(exportRes.status, 409, "Export must return HTTP 409 Conflict when dataset has mutated since preview");
    assert.equal(exportRes.headers.get("Cache-Control"), "private, no-store");

    const exportJson = await exportRes.json();
    assert.equal(exportJson.stale, true);
    assert.equal(
      exportJson.currentFingerprint,
      preview2.fingerprint,
      "409 response must return the newly recomputed current brief fingerprint",
    );
    assert.match(exportJson.error, /Regeneration required before export/);
  });
});
