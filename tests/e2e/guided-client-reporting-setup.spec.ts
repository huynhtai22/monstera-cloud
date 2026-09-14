import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  createAuthenticatedSessionCache,
  sharedAuthenticatedSession,
} from "./authenticated-session";

/**
 * Guided client reporting setup v1 — browser acceptance.
 *
 * Covers the exposure slice only: the checklist surfaces existing
 * reporting-configuration, assignment and readiness contracts without
 * changing RBAC, approval, delivery or sync behavior.
 */

const SUFFIX = `setup-e2e-${Date.now()}-${process.pid}`;
const MEMBER_EMAIL = `member-setup-${SUFFIX}@alpha-agency.test`;
const MEMBER_PASSWORD = "Pilot_Alpha_2026!";

async function login(page: Page, email: string, password: string) {
  const csrfRes = await page.request.get("/api/auth/csrf");
  expect(csrfRes.ok()).toBeTruthy();
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const loginRes = await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password, redirect: "false", json: "true", callbackUrl: "/clients" },
  });
  if (!loginRes.ok()) {
    throw new Error(`login failed with status ${loginRes.status()}: ${await loginRes.text()}`);
  }
  const sessionRes = await page.request.get("/api/auth/session");
  const session = (await sessionRes.json()) as { user?: { email?: string } };
  expect(session.user?.email).toBe(email);
}

const adminSession = createAuthenticatedSessionCache();
const memberSession = createAuthenticatedSessionCache();
const betaSession = createAuthenticatedSessionCache();

async function sharedSession(
  browser: Parameters<typeof sharedAuthenticatedSession>[0],
  email: string,
  password: string,
  cache: typeof adminSession,
) {
  return sharedAuthenticatedSession(browser, cache, (page) => login(page, email, password));
}

test.describe("guided client reporting setup", () => {
  test.describe.configure({ mode: "serial" });

  let prisma: PrismaClient;
  let workspaceId: string;
  let betaWorkspaceId: string;
  let memberUserId: string;
  let clientAId: string;
  let clientBId: string;
  let betaClientId: string;
  let connectionAId: string;
  const accountA = `m-${SUFFIX}`;
  const WEEK_DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
  const clientAName = `Setup Client A ${SUFFIX}`;
  const clientBName = `Setup Client B ${SUFFIX}`;

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    const workspace = await prisma.workspace.findFirst({ where: { slug: "alpha-agency" } });
    if (!workspace) throw new Error("alpha-agency rehearsal workspace missing; run global-setup seed");
    workspaceId = workspace.id;
    const betaWorkspace = await prisma.workspace.findFirst({ where: { slug: "beta-media" } });
    if (!betaWorkspace) throw new Error("beta-media rehearsal workspace missing; run global-setup seed");
    betaWorkspaceId = betaWorkspace.id;

    memberUserId = (await prisma.user.create({
      data: {
        email: MEMBER_EMAIL,
        name: "Member Setup",
        hashedPassword: await bcrypt.hash(MEMBER_PASSWORD, 12),
        emailVerified: new Date(),
        plan: "pilot",
      },
      select: { id: true },
    })).id;
    await prisma.workspaceMember.create({
      data: { workspaceId, userId: memberUserId, role: "member" },
    });

    clientAId = (await prisma.client.create({
      data: { workspaceId, name: clientAName },
      select: { id: true },
    })).id;
    clientBId = (await prisma.client.create({
      data: {
        workspaceId,
        name: clientBName,
        requiredProviders: ["meta_ads"],
        requiredDestinations: ["google_sheets"],
        requirementsConfiguredAt: new Date(),
      },
      select: { id: true },
    })).id;
    betaClientId = (await prisma.client.create({
      data: { workspaceId: betaWorkspaceId, name: `Setup Client Beta ${SUFFIX}` },
      select: { id: true },
    })).id;

    connectionAId = (await prisma.connection.create({
      data: {
        workspaceId,
        clientId: clientAId,
        name: `Meta Setup ${SUFFIX}`,
        type: "source",
        provider: "meta_ads",
        credentials: "enc:v1:e2e",
        remoteAccountId: accountA,
        status: "connected",
        lastSyncAt: new Date(),
      },
      select: { id: true },
    })).id;

    await prisma.providerAccountHealth.create({
      data: {
        workspaceId,
        connectionId: connectionAId,
        provider: "meta_ads",
        accountId: accountA,
        accountName: "Setup Ad Account",
        status: "healthy",
        lastSuccessAt: new Date(),
      },
    });
    await prisma.accountReportingContext.create({
      data: {
        workspaceId,
        connectionId: connectionAId,
        accountId: accountA,
        providerTimezone: "Asia/Ho_Chi_Minh",
        providerCurrency: "VND",
        providerObservedAt: new Date(),
      },
    });
    await prisma.campaignMetric.createMany({
      data: WEEK_DAYS.map((day) => ({
        workspaceId,
        connectionId: connectionAId,
        platform: "meta_ads",
        accountId: accountA,
        level: "ad",
        entityId: `ad-setup-${SUFFIX}`,
        campaignId: "120210543958",
        campaignName: "Setup Campaign",
        adsetId: `adset-setup-${SUFFIX}`,
        adId: `ad-setup-${SUFFIX}`,
        date: new Date(`${day}T00:00:00.000Z`),
        impressions: 1000,
        clicks: 50,
        spend: 10_000_000,
        conversions: 2,
        revenue: 40_000_000,
        currency: "VND",
      })),
    });
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await adminSession.context?.close().catch(() => undefined);
    await memberSession.context?.close().catch(() => undefined);
    await betaSession.context?.close().catch(() => undefined);
    await prisma.campaignMetric.deleteMany({ where: { connectionId: connectionAId } }).catch(() => undefined);
    await prisma.accountReportingContext.deleteMany({ where: { connectionId: connectionAId } }).catch(() => undefined);
    await prisma.providerAccountHealth.deleteMany({ where: { connectionId: connectionAId } }).catch(() => undefined);
    await prisma.clientProviderAccountAssignment.deleteMany({ where: { workspaceId } }).catch(() => undefined);
    await prisma.connection.deleteMany({ where: { id: connectionAId } }).catch(() => undefined);
    await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } }).catch(() => undefined);
    await prisma.client.deleteMany({ where: { id: betaClientId } }).catch(() => undefined);
    await prisma.workspaceMember.deleteMany({ where: { userId: memberUserId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: memberUserId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  test("member journey: sees configuration state without admin mutation controls", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, MEMBER_EMAIL, MEMBER_PASSWORD, memberSession);
    await page.goto(`/clients?clientId=${clientAId}`, { waitUntil: "domcontentloaded" });

    const checklist = page.getByRole("region", { name: `Reporting setup for ${clientAName}` });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText("Waiting for admin").first()).toBeVisible();
    await expect(checklist.getByText(/owner or admin/i).first()).toBeVisible();
    await expect(checklist.getByText("Configure reporting evidence")).toBeHidden();
    await expect(checklist.getByText("Save requirements")).toBeHidden();
    // Member keeps member-authorized recovery navigation, never admin forms.
    await expect(checklist.getByRole("link", { name: /sources/i }).first()).toBeVisible();
  });

  test("admin journey: configure requirements through the exposed checklist", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", adminSession);
    await page.goto(`/clients?clientId=${clientAId}`, { waitUntil: "domcontentloaded" });

    const checklist = page.getByRole("region", { name: `Reporting setup for ${clientAName}` });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText("Action required").first()).toBeVisible();

    // The previously hidden configuration is open by default for unconfigured clients.
    const requirementsForm = checklist.locator("form").filter({ hasText: "Save requirements" });
    await expect(requirementsForm).toBeVisible();
    await requirementsForm.getByRole("checkbox", { name: "meta ads" }).check();
    await requirementsForm.getByRole("checkbox", { name: "Google Sheets" }).check();
    const saved = page.waitForResponse(
      (candidate) => candidate.request().method() === "PATCH"
        && candidate.url().includes("/api/reports/readiness/configuration")
        && candidate.status() === 200,
    );
    await requirementsForm.getByRole("button", { name: "Save requirements" }).click();
    await saved;
    await expect(checklist.getByText(/Required providers:.*Meta Ads/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("admin journey: assign the required account and observe completion", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", adminSession);
    await page.goto(`/sources?clientId=${clientAId}&tab=accounts`, { waitUntil: "domcontentloaded" });

    const row = page.locator("tr, li, div", { hasText: accountA }).filter({ hasText: `Assign account ${accountA}` }).first();
    await expect(row.getByRole("button", { name: `Assign account ${accountA}` })).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: `Assign account ${accountA}` }).click();
    await expect(page.getByRole("heading", { name: "Assign Account" })).toBeVisible();
    await page.getByText("Target Client Brand", { exact: true }).locator("..").locator("select").selectOption(clientAId);
    const assigned = page.waitForResponse(
      (candidate) => candidate.request().method() === "POST"
        && candidate.url().includes(`/api/workspaces/${workspaceId}/client-accounts`)
        && candidate.status() === 200,
    );
    await page.getByRole("button", { name: "Confirm Assignment" }).click();
    await assigned;

    await page.goto(`/clients?clientId=${clientAId}`, { waitUntil: "domcontentloaded" });
    const checklist = page.getByRole("region", { name: `Reporting setup for ${clientAName}` });
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText("Every required provider has an account assigned").first()).toBeVisible({ timeout: 30_000 });
  });

  test("admin journey: Blueprint pre-generation links to the exact setup section", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", adminSession);
    await page.goto(`/reports?clientId=${clientAId}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Check prerequisites for this client")).toBeVisible();
    const requirementsLink = page.getByRole("link", { name: "Requirements" });
    await expect(requirementsLink).toHaveAttribute("href", `/clients?clientId=${clientAId}#reporting-setup`);

    await page.getByText("Check prerequisites for this client").click();
    const setupLink = page.getByRole("link", { name: "Open this client's reporting setup" }).first();
    await expect(setupLink).toHaveAttribute("href", `/clients?clientId=${clientAId}#reporting-setup`);
    await setupLink.click();
    await expect(page).toHaveURL(new RegExp(`/clients\\?clientId=${clientAId}#reporting-setup`));
    await expect(page.getByRole("region", { name: `Reporting setup for ${clientAName}` })).toBeVisible();
  });

  test("tenant isolation: switching client and workspace never retains setup state", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page } = await sharedSession(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!", adminSession);
    await page.goto(`/clients?clientId=${clientAId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: `Reporting setup for ${clientAName}` })).toBeVisible();

    await page.goto(`/clients?clientId=${clientBId}`, { waitUntil: "domcontentloaded" });
    const checklistB = page.getByRole("region", { name: `Reporting setup for ${clientBName}` });
    await expect(checklistB).toBeVisible();
    await expect(page.getByRole("region", { name: `Reporting setup for ${clientAName}` })).toBeHidden();

    const { page: betaPage } = await sharedSession(browser, "bob@beta-media.test", "Pilot_Beta_2026!", betaSession);
    await betaPage.goto(`/clients?clientId=${betaClientId}`, { waitUntil: "domcontentloaded" });
    await expect(betaPage.getByRole("region", { name: /Reporting setup for/ })).toBeVisible();
    await expect(betaPage.getByText(clientAName)).toBeHidden();
    await expect(betaPage.getByText(clientBName)).toBeHidden();
  });
});
