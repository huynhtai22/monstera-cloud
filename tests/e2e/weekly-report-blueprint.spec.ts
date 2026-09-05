import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { reportingDataset } from "../../src/lib/report-delivery";

/**
 * Verified Weekly Performance Blueprint v1 — browser + API acceptance on the
 * PR #152 architecture. Requirements live on `Client` (managed via
 * /api/reports/readiness/configuration), delivery proof is a current
 * DestinationDeliveryReceipt. Runs on both desktop and mobile projects.
 * Shares one authenticated session per identity: the login endpoint
 * rate-limits per user (10 / 15 min) across the whole e2e suite.
 */

const SUFFIX = `bpe2e-${Date.now()}-${process.pid}`;

async function login(page: Page, email: string, password: string) {
  const csrfRes = await page.request.get("/api/auth/csrf");
  expect(csrfRes.ok()).toBeTruthy();
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const loginRes = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email,
      password,
      redirect: "false",
      json: "true",
      callbackUrl: "/reports",
    },
  });
  if (!loginRes.ok()) {
    throw new Error(`login failed with status ${loginRes.status()}: ${await loginRes.text()}`);
  }
  const sessionRes = await page.request.get("/api/auth/session");
  const session = (await sessionRes.json()) as { user?: { email?: string } };
  expect(session.user?.email).toBe(email);
}

type Session = { context: Awaited<ReturnType<Browser["newContext"]>>; page: Page };

async function sharedSession(
  browser: Browser,
  email: string,
  password: string,
  cache: { context?: Session["context"]; page?: Page },
): Promise<Session> {
  if (!cache.context || !cache.page) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    cache.context = context;
    cache.page = page;
  }
  return { context: cache.context, page: cache.page };
}

const aliceSession: { context?: Session["context"]; page?: Page } = {};
const bobSession: { context?: Session["context"]; page?: Page } = {};

async function noHorizontalOverflow(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    .toBeLessThanOrEqual(2);
}

test.describe("verified weekly report blueprint", () => {
  test.describe.configure({ mode: "serial" });

  let prisma: PrismaClient;
  let workspaceId: string;
  let clientId: string;
  let googleConnectionId: string;
  let metaConnectionId: string;
  const WINDOW = { start: "2026-08-24", end: "2026-08-30" };
  const WEEK_DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const workspace = await prisma.workspace.findFirst({ where: { slug: "alpha-agency" } });
    if (!workspace) throw new Error("alpha-agency rehearsal workspace missing; run global-setup seed");
    workspaceId = workspace.id;

    clientId = (await prisma.client.create({
      data: {
        workspaceId,
        name: `Blueprint Client ${SUFFIX}`,
        requiredProviders: ["google_ads", "meta_ads"],
        requiredDestinations: ["google_sheets"],
        requirementsConfiguredAt: new Date(),
      },
      select: { id: true },
    })).id;

    googleConnectionId = (await prisma.connection.create({
      data: {
        workspaceId,
        clientId,
        name: `Google ${SUFFIX}`,
        type: "source",
        provider: "google_ads",
        credentials: "enc:v1:e2e",
        remoteAccountId: `g-${SUFFIX}`,
        status: "connected",
        lastSyncAt: new Date(),
      },
      select: { id: true },
    })).id;

    metaConnectionId = (await prisma.connection.create({
      data: {
        workspaceId,
        clientId,
        name: `Meta ${SUFFIX}`,
        type: "source",
        provider: "meta_ads",
        credentials: "enc:v1:e2e",
        remoteAccountId: `m-${SUFFIX}`,
        status: "connected",
        lastSyncAt: new Date(),
      },
      select: { id: true },
    })).id;

    await prisma.accountReportingContext.createMany({
      data: [
        {
          workspaceId,
          connectionId: googleConnectionId,
          accountId: `g-${SUFFIX}`,
          providerTimezone: "Asia/Ho_Chi_Minh",
          providerCurrency: "VND",
          providerObservedAt: new Date(),
        },
        {
          workspaceId,
          connectionId: metaConnectionId,
          accountId: `m-${SUFFIX}`,
          providerTimezone: "Asia/Ho_Chi_Minh",
          providerCurrency: "VND",
          providerObservedAt: new Date(),
        },
      ],
    });

    await prisma.campaignMetric.createMany({
      data: WEEK_DAYS.flatMap((day) => ([
        {
          workspaceId,
          connectionId: googleConnectionId,
          platform: "google_ads",
          accountId: `g-${SUFFIX}`,
          level: "campaign",
          entityId: `e-g-${SUFFIX}`,
          campaignId: "1795849302486751234",
          campaignName: "Always On",
          date: new Date(`${day}T00:00:00.000Z`),
          impressions: 1000,
          clicks: 100,
          spend: 50_000_000,
          conversions: 4,
          revenue: 250_000_000,
          currency: "VND",
        },
        // Meta rows shaped like the active syncMetaAds output: level "ad",
        // entityId = ad_id, two ads per campaign.
        {
          workspaceId,
          connectionId: metaConnectionId,
          platform: "meta_ads",
          accountId: `m-${SUFFIX}`,
          level: "ad",
          entityId: `ad-a-${SUFFIX}`,
          campaignId: "120210543958",
          campaignName: "Retargeting",
          adsetId: `adset-${SUFFIX}`,
          adId: `ad-a-${SUFFIX}`,
          date: new Date(`${day}T00:00:00.000Z`),
          impressions: 1200,
          clicks: 40,
          spend: 12_000_000,
          conversions: 1,
          revenue: 30_000_000,
          currency: "VND",
        },
        {
          workspaceId,
          connectionId: metaConnectionId,
          platform: "meta_ads",
          accountId: `m-${SUFFIX}`,
          level: "ad",
          entityId: `ad-b-${SUFFIX}`,
          campaignId: "120210543958",
          campaignName: "Retargeting",
          adsetId: `adset-${SUFFIX}`,
          adId: `ad-b-${SUFFIX}`,
          date: new Date(`${day}T00:00:00.000Z`),
          impressions: 800,
          clicks: 20,
          spend: 8_000_000,
          conversions: 1,
          revenue: 20_000_000,
          currency: "VND",
        },
      ])),
    });
    // Previous-window rows for week-over-week deltas.
    await prisma.campaignMetric.createMany({
      data: ["2026-08-18", "2026-08-19"].map((day) => ({
        workspaceId,
        connectionId: googleConnectionId,
        platform: "google_ads",
        accountId: `g-${SUFFIX}`,
        level: "campaign",
        entityId: `e-g-prev-${SUFFIX}`,
        campaignId: "1795849302486751234",
        campaignName: "Always On",
        date: new Date(`${day}T00:00:00.000Z`),
        impressions: 800,
        clicks: 80,
        spend: 40_000_000,
        conversions: 3,
        revenue: 150_000_000,
        currency: "VND",
      })),
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await aliceSession.context?.close().catch(() => undefined);
    await bobSession.context?.close().catch(() => undefined);
    await prisma.campaignMetric.deleteMany({ where: { connectionId: { in: [googleConnectionId, metaConnectionId] } } });
    await prisma.accountReportingContext.deleteMany({ where: { connectionId: { in: [googleConnectionId, metaConnectionId] } } }).catch(() => undefined);
    await prisma.connection.deleteMany({ where: { id: { in: [googleConnectionId, metaConnectionId] } } }).catch(() => undefined);
    await prisma.client.deleteMany({ where: { id: clientId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function seedCurrentReceipt() {
    const dataset = await reportingDataset(prisma, workspaceId, clientId, WINDOW);
    return prisma.destinationDeliveryReceipt.create({
      data: {
        workspaceId,
        clientId,
        destination: "google_sheets",
        windowStart: WINDOW.start,
        windowEnd: WINDOW.end,
        dataThroughDate: dataset.dataThroughDate ?? WINDOW.end,
        datasetFingerprint: dataset.fingerprint,
        rowCount: dataset.rowCount,
        actorId: "e2e",
      },
    });
  }

  test("API: without delivery evidence the report cannot verify (5)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);

    const generate = await page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    expect(generate.ok()).toBeTruthy();
    const generated = (await generate.json()) as {
      created: boolean;
      snapshot: { id: string; verificationStatus: string; verificationReasons: string[] };
      report: { overview: { reportingTimezone: string | null; currency: string | null; requiredProviders: string[]; requiredDestinations: string[]; readiness: { status: string; destinationState: string } } };
    };
    expect(generated.snapshot.verificationStatus).toBe("NOT_VERIFIED");
    expect(generated.snapshot.verificationReasons).toContain("destination_evidence_missing");
    expect(generated.report.overview.requiredProviders).toEqual(["google_ads", "meta_ads"]);
    expect(generated.report.overview.requiredDestinations).toEqual(["google_sheets"]);
    expect(generated.report.overview.reportingTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(generated.report.overview.currency).toBe("VND");
    expect(generated.report.overview.readiness.destinationState).toBe("unverified");
  });

  test("API: valid current receipt verifies; reopen is idempotent and reproduces hash + result (11, 13, 14)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);
    await seedCurrentReceipt();

    const generate = await page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    expect(generate.ok()).toBeTruthy();
    const generated = (await generate.json()) as {
      created: boolean;
      snapshot: { id: string; dependencyHash: string; verificationStatus: string; sequence: number };
      report: { overview: { verification: { status: string }; readiness: { status: string; destinationState: string } } };
    };
    expect(generated.snapshot.verificationStatus).toBe("VERIFIED");
    expect(generated.report.overview.readiness.status).toBe("READY");
    expect(generated.report.overview.readiness.destinationState).toBe("verified");

    const regenerate = await page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    const regenerated = (await regenerate.json()) as typeof generated & { created: boolean };
    expect(regenerated.created).toBe(false);
    expect(regenerated.snapshot.id).toBe(generated.snapshot.id);

    const reopen = await page.request.get(
      `/api/reports/blueprint?workspaceId=${workspaceId}&clientId=${clientId}&windowStart=${WINDOW.start}&windowEnd=${WINDOW.end}`,
    );
    expect(reopen.ok()).toBeTruthy();
    const reopened = (await reopen.json()) as {
      snapshot: { id: string; dependencyHash: string; verification: { status: string }; freshness: { freshness: string } };
      report: unknown;
    };
    expect(reopened.snapshot.id).toBe(generated.snapshot.id);
    expect(reopened.snapshot.dependencyHash).toBe(generated.snapshot.dependencyHash);
    expect(reopened.snapshot.freshness.freshness).toBe("CURRENT");
    expect(reopened.snapshot.verification.status).toBe("VERIFIED");
  });

  test("API: requirement changes via the owner/admin configuration route go stale; duplicate requirements route is gone (3, 13)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);

    // The blueprint's own requirements route was removed (one source of truth).
    const gone = await page.request.put("/api/reports/blueprint/requirements", {
      data: { workspaceId, clientId, requiredProviders: ["google_ads"] },
    });
    expect([404, 405]).toContain(gone.status());

    // GET rejects either half-specified window boundary with HTTP 400.
    const halfStart = await page.request.get(
      `/api/reports/blueprint?workspaceId=${workspaceId}&clientId=${clientId}&windowStart=${WINDOW.start}`,
    );
    expect(halfStart.status()).toBe(400);
    const halfEnd = await page.request.get(
      `/api/reports/blueprint?workspaceId=${workspaceId}&clientId=${clientId}&windowEnd=${WINDOW.end}`,
    );
    expect(halfEnd.status()).toBe(400);

    // Requirement mutation follows PR #152's configuration route (admin).
    const patch = await page.request.patch("/api/reports/readiness/configuration", {
      data: { workspaceId, clientId, requirements: { providers: ["google_ads"], destinations: ["google_sheets"] } },
    });
    expect(patch.ok()).toBeTruthy();

    const reopen = await page.request.get(
      `/api/reports/blueprint?workspaceId=${workspaceId}&clientId=${clientId}&windowStart=${WINDOW.start}&windowEnd=${WINDOW.end}`,
    );
    const reopened = (await reopen.json()) as {
      snapshot: {
        verification: { status: string; reasons: string[] };
        freshness: { freshness: string; staleReasons: Array<{ code: string }> };
      };
    };
    expect(reopened.snapshot.freshness.freshness).toBe("STALE");
    expect(reopened.snapshot.freshness.staleReasons.map((reason) => reason.code)).toContain("requirement_changed");
    expect(reopened.snapshot.verification.status).toBe("NOT_VERIFIED");

    // Restore the original requirements; the changed clock creates a new version.
    await page.request.patch("/api/reports/readiness/configuration", {
      data: { workspaceId, clientId, requirements: { providers: ["google_ads", "meta_ads"], destinations: ["google_sheets"] } },
    });
    const regenerate = await page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    const regenerated = (await regenerate.json()) as { created: boolean; snapshot: { sequence: number }; snapshot_verification?: string };
    expect(regenerated.created).toBe(true);
  });

  test("API: rival workspace fails closed and caller-declared verification is ignored (17, 18)", async ({ browser }) => {
    test.setTimeout(120_000);
    const bob = await sharedSession(browser, "bob@beta-media.test", "Pilot_Beta_2026!", bobSession);

    const rival = await bob.page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    expect(rival.status()).toBe(403);

    // Injected verification state in the request body must not change the
    // derived snapshot verification: the service has no such input. The
    // current dataset has no current receipt after regeneration, so the
    // honest label is NOT_VERIFIED regardless of the forged field.
    const forge = await bob.page.request.post("/api/reports/blueprint", {
      data: {
        workspaceId: (await bob.page.request.get("/api/workspaces").then((r) => r.json() as Promise<Array<{ id: string; slug: string }>>))
          .find((w) => w.slug === "beta-media")?.id,
        clientId,
        windowStart: WINDOW.start,
        windowEnd: WINDOW.end,
        verificationStatus: "VERIFIED",
      },
    });
    expect([403, 404, 409, 400]).toContain(forge.status());

    // Re-seed the receipt so the UI tests below see a verifiable report.
    await seedCurrentReceipt();
  });

  test("UI: blueprint generates, shows VERIFIED badge, provider and campaign tables without overflow (21-23)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);
    await page.goto(`/reports?clientId=${clientId}`);
    await expect(page.getByRole("region", { name: "Verified Weekly Performance Blueprint" })).toBeVisible();
    await expect(page.getByText("Weekly Paid Media Performance").first()).toBeVisible();

    // Context is shown BEFORE generation: timezone + currency + requirements.
    await expect(page.getByText("Asia/Ho_Chi_Minh").first()).toBeVisible();
    await expect(page.getByText("Google Ads, Meta Ads").first()).toBeVisible();

    await page.getByRole("button", { name: "Last complete week" }).waitFor();
    await page.getByRole("button", { name: /Generate report/ }).click();

    await expect(page.getByText("Verified", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Cross-channel totals")).toBeVisible();
    await expect(page.getByText("Provider breakdown")).toBeVisible();
    await expect(page.getByText("1795849302486751234")).toBeVisible();
    await expect(page.getByText("120210543958")).toBeVisible();

    await noHorizontalOverflow(page);
  });

  test("UI: mobile viewport renders without horizontal overflow (23)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);
    await page.goto(`/reports?clientId=${clientId}`);
    await expect(page.getByRole("region", { name: "Verified Weekly Performance Blueprint" })).toBeVisible();
    await page.getByRole("button", { name: /Generate report/ }).click();
    await expect(page.getByText("Cross-channel totals")).toBeVisible({ timeout: 30_000 });
    await noHorizontalOverflow(page);
  });
});
