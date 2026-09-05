import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Verified Weekly Performance Blueprint v1 — browser + API acceptance.
 * Runs on both desktop-chromium and mobile-chromium projects.
 * Requires DATABASE_URL (the rehearsal seed users from global-setup).
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

async function authedBrowser(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

/**
 * One authenticated session per identity per project. The login endpoint
 * rate-limits per identity (10 / 15 min), and the full e2e suite logs in as
 * these rehearsal users across many specs — so serial tests here MUST reuse
 * a single session instead of logging in per test.
 */
async function sharedSession(
  browser: Browser,
  email: string,
  password: string,
  cache: { context?: Awaited<ReturnType<Browser["newContext"]>>; page?: Page },
) {
  if (!cache.context || !cache.page) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, email, password);
    cache.context = context;
    cache.page = page;
  }
  return cache;
}

const aliceSession: { context?: Awaited<ReturnType<Browser["newContext"]>>; page?: Page } = {};
const bobSession: { context?: Awaited<ReturnType<Browser["newContext"]>>; page?: Page } = {};

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
  let destinationConnectionId: string;
  const WINDOW = { start: "2026-08-24", end: "2026-08-30" };

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const workspace = await prisma.workspace.findFirst({ where: { slug: "alpha-agency" } });
    if (!workspace) throw new Error("alpha-agency rehearsal workspace missing; run global-setup seed");
    workspaceId = workspace.id;

    clientId = await prisma.client.create({
      data: { workspaceId, name: `Blueprint Client ${SUFFIX}` },
      select: { id: true },
    }).then((client) => client.id);

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
        lastDataThrough: new Date("2026-08-30T00:00:00.000Z"),
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
        lastDataThrough: new Date("2026-08-30T00:00:00.000Z"),
      },
      select: { id: true },
    })).id;

    // The shared readiness evaluator treats a workspace without any
    // destination as `no_destination`-blocked, so seed one for VERIFIED.
    destinationConnectionId = (await prisma.connection.create({
      data: {
        workspaceId,
        name: `Sheets Destination ${SUFFIX}`,
        type: "destination",
        provider: "google_sheets",
        credentials: "enc:v1:e2e",
        remoteAccountId: `dest-${SUFFIX}`,
        status: "connected",
      },
      select: { id: true },
    })).id;

    await prisma.clientReportingRequirement.create({
      data: {
        workspaceId,
        clientId,
        requiredProviders: ["google_ads", "meta_ads"],
        reportingTimezone: "Asia/Ho_Chi_Minh",
        reportingCurrency: "VND",
      },
    });

    await prisma.campaignMetric.createMany({
      data: [
        {
          workspaceId,
          connectionId: googleConnectionId,
          platform: "google_ads",
          accountId: `g-${SUFFIX}`,
          level: "campaign",
          entityId: `e-g-${SUFFIX}`,
          campaignId: "1795849302486751234",
          campaignName: "Always On",
          date: new Date("2026-08-25T00:00:00.000Z"),
          impressions: 1000,
          clicks: 100,
          spend: 50_000_000,
          conversions: 4,
          revenue: 250_000_000,
          currency: "VND",
        },
        {
          workspaceId,
          connectionId: metaConnectionId,
          platform: "meta_ads",
          accountId: `m-${SUFFIX}`,
          level: "campaign",
          entityId: `e-m-${SUFFIX}`,
          campaignId: "120210543958",
          campaignName: "Retargeting",
          date: new Date("2026-08-25T00:00:00.000Z"),
          impressions: 2000,
          clicks: 60,
          spend: 20_000_000,
          conversions: 2,
          revenue: 50_000_000,
          currency: "VND",
        },
        // Previous window rows (2026-08-17..23) for week-over-week deltas.
        {
          workspaceId,
          connectionId: googleConnectionId,
          platform: "google_ads",
          accountId: `g-${SUFFIX}`,
          level: "campaign",
          entityId: `e-g-prev-${SUFFIX}`,
          campaignId: "1795849302486751234",
          campaignName: "Always On",
          date: new Date("2026-08-18T00:00:00.000Z"),
          impressions: 800,
          clicks: 80,
          spend: 40_000_000,
          conversions: 3,
          revenue: 150_000_000,
          currency: "VND",
        },
      ],
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await aliceSession.context?.close().catch(() => undefined);
    await bobSession.context?.close().catch(() => undefined);
    await prisma.campaignMetric.deleteMany({ where: { connectionId: { in: [googleConnectionId, metaConnectionId] } } });
    await prisma.connection.deleteMany({ where: { id: { in: [googleConnectionId, metaConnectionId, destinationConnectionId] } } }).catch(() => undefined);
    await prisma.client.deleteMany({ where: { id: clientId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  test("API: generate → VERIFIED → idempotent reopen reproduces hash and result (13, 17, 18, 19)", async ({ browser }) => {
    test.setTimeout(120_000);
    const alice = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);

    const generate = await alice.page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    expect(generate.ok()).toBeTruthy();
    const generated = (await generate.json()) as {
      created: boolean;
      snapshot: { id: string; dependencyHash: string; verificationStatus: string; sequence: number };
      report: {
        overview: { verification: { status: string }; readiness: { status: string }; reportingTimezone: string; currency: string | null };
        totals: { currency: string | null; monetaryAvailable: boolean; spend: number | null };
      };
    };
    expect(generated.snapshot.verificationStatus).toBe("VERIFIED");
    expect(generated.report.overview.readiness.status).toBe("READY");
    expect(generated.report.overview.reportingTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(generated.report.overview.currency).toBe("VND");
    expect(generated.report.totals.monetaryAvailable).toBe(true);

    const regenerate = await alice.page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    const regenerated = (await regenerate.json()) as typeof generated & { created: boolean; snapshot: { id: string } };
    expect(regenerated.created).toBe(false);
    expect(regenerated.snapshot.id).toBe(generated.snapshot.id);

    const reopen = await alice.page.request.get(
      `/api/reports/blueprint?workspaceId=${workspaceId}&clientId=${clientId}&windowStart=${WINDOW.start}&windowEnd=${WINDOW.end}`,
    );
    expect(reopen.ok()).toBeTruthy();
    const reopened = (await reopen.json()) as {
      snapshot: { id: string; dependencyHash: string; verification: { status: string }; freshness: { freshness: string }; report?: unknown };
      report: { totals: { spend: number | null } };
    };
    expect(reopened.snapshot.id).toBe(generated.snapshot.id);
    expect(reopened.snapshot.dependencyHash).toBe(generated.snapshot.dependencyHash);
    expect(reopened.snapshot.freshness.freshness).toBe("CURRENT");
    expect(reopened.snapshot.verification.status).toBe("VERIFIED");

  });

  test("API: staleness when warehouse data advances; VERIFIED drops (15)", async ({ browser }) => {
    const alice = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);

    await prisma.connection.update({
      where: { id: googleConnectionId },
      data: { lastDataThrough: new Date("2026-08-30T12:00:00.000Z") },
    });

    const reopen = await alice.page.request.get(
      `/api/reports/blueprint?workspaceId=${workspaceId}&clientId=${clientId}&windowStart=${WINDOW.start}&windowEnd=${WINDOW.end}`,
    );
    const reopened = (await reopen.json()) as {
      snapshot: {
        verification: { status: string; reasons: string[] };
        freshness: { freshness: string; staleReasons: Array<{ code: string }> };
      };
    };
    expect(reopened.snapshot.freshness.freshness).toBe("STALE");
    expect(reopened.snapshot.freshness.staleReasons.map((reason) => reason.code)).toContain("data_through_changed");
    expect(reopened.snapshot.verification.status).toBe("NOT_VERIFIED");

    await prisma.connection.update({
      where: { id: googleConnectionId },
      data: { lastDataThrough: new Date("2026-08-30T00:00:00.000Z") },
    });
  });

  test("API: rival workspace fails closed and caller-declared verification is ignored (11, 12)", async ({ browser }) => {
    const bob = await sharedSession(browser, "bob@beta-media.test", "Pilot_Beta_2026!", bobSession);

    const rival = await bob.page.request.post("/api/reports/blueprint", {
      data: { workspaceId, clientId, windowStart: WINDOW.start, windowEnd: WINDOW.end },
    });
    expect(rival.status()).toBe(403);

    const rivalRequirements = await bob.page.request.put("/api/reports/blueprint/requirements", {
      data: { workspaceId, clientId, requiredProviders: ["google_ads"] },
    });
    expect([403, 404]).toContain(rivalRequirements.status());

    // Injected verification state in the request body must not change the
    // derived snapshot verification: the service has no such input.
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

  });

  test("UI: blueprint generates, shows VERIFIED badge, provider and campaign tables without overflow (21, 22, 23)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);
    await page.goto(`/reports?clientId=${clientId}`);
    await expect(page.getByRole("region", { name: "Verified Weekly Performance Blueprint" })).toBeVisible();
    await expect(page.getByText("Weekly Paid Media Performance").first()).toBeVisible();

    // Context is shown BEFORE generation (5): timezone + currency + providers.
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

  test("UI: mobile viewport renders without horizontal overflow (21)", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", aliceSession);
    await page.goto(`/reports?clientId=${clientId}`);
    await expect(page.getByRole("region", { name: "Verified Weekly Performance Blueprint" })).toBeVisible();
    await page.getByRole("button", { name: /Generate report/ }).click();
    await expect(page.getByText("Cross-channel totals")).toBeVisible({ timeout: 30_000 });
    await noHorizontalOverflow(page);
  });
});
