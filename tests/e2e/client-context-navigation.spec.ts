import { expect, test as base, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "../../src/lib/pg-test-discipline";
import {
  createAuthenticatedSessionCache,
  freshAuthenticatedSession,
} from "./authenticated-session";

const suffix = `ccx-e2e-${Date.now()}-${process.pid}`;
const DATE = "2026-09-04";
const ALICE = { email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!" };
const BOB = { email: "bob@beta-media.test", password: "Pilot_Beta_2026!" };

type Fixture = {
  workspaceId: string;
  ownerUserId: string;
  rivalClientId: string;
  clients: {
    aurora: { id: string; name: string };
    northwind: { id: string; name: string };
    long: { id: string; name: string };
  };
};

let db: PrismaClient;
let fixture: Fixture;
const aliceSession = createAuthenticatedSessionCache();
const bobSession = createAuthenticatedSessionCache();

async function signIn(page: Page, credentials: { email: string; password: string }) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json() as { csrfToken: string };
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      email: credentials.email,
      password: credentials.password,
      redirect: "false",
      json: "true",
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function configureFixtureWorkspace(page: Page) {
  await page.addInitScript(({ workspaceId, userId }: { workspaceId: string; userId: string }) => {
    window.localStorage.setItem(
      "monstera-workspace-storage",
      JSON.stringify({ state: { activeWorkspaceId: workspaceId }, version: 0 }),
    );
    window.sessionStorage.setItem("monstera-last-auth-user-id", userId);
  }, { workspaceId: fixture.workspaceId, userId: fixture.ownerUserId });
}

const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ browser }, use) => {
    const session = await freshAuthenticatedSession(browser, aliceSession, (page) => signIn(page, ALICE));
    await configureFixtureWorkspace(session.page);
    await use(session.page);
    await session.context.close();
  },
});

async function selectClient(page: Page, name: string) {
  await page.getByLabel("Switch client").selectOption({ label: name });
}

async function followSidebarLink(page: Page, name: string) {
  if (await page.evaluate(() => window.innerWidth < 1024)) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.getByRole("link", { name }).click();
}

test.describe("client context navigation", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    const alice = await db.user.findUniqueOrThrow({ where: { email: ALICE.email }, select: { id: true } });
    const extraClients = Array.from({ length: 12 }, (_, index) => ({
      id: `client-pad-${index + 1}-${suffix}`,
      name: `Context Client ${String(index + 1).padStart(2, "0")}`,
    }));

    fixture = {
      workspaceId: `ws-ccx-${suffix}`,
      ownerUserId: alice.id,
      rivalClientId: `client-rival-${suffix}`,
      clients: {
        aurora: { id: `client-aurora-${suffix}`, name: "Aurora Retailer" },
        northwind: { id: `client-northwind-${suffix}`, name: "Northwind Traders" },
        long: {
          id: `client-long-${suffix}`,
          name: "Very Long Client Name For Truncation And Keyboard Navigation Coverage",
        },
      },
    };

    await db.workspace.create({
      data: {
        id: fixture.workspaceId,
        slug: `context-e2e-${suffix}`,
        name: "Client Context E2E Workspace",
        ownerId: alice.id,
        plan: "pilot",
        status: "PILOT",
        members: { create: [{ userId: alice.id, role: "owner" }] },
        providerAccess: { create: { provider: "google_ads", enabled: true } },
      },
    });

    await db.client.createMany({
      data: [
        { id: fixture.clients.aurora.id, workspaceId: fixture.workspaceId, name: fixture.clients.aurora.name, accountAssignmentsConfiguredAt: new Date() },
        { id: fixture.clients.northwind.id, workspaceId: fixture.workspaceId, name: fixture.clients.northwind.name, accountAssignmentsConfiguredAt: new Date() },
        { id: fixture.clients.long.id, workspaceId: fixture.workspaceId, name: fixture.clients.long.name, accountAssignmentsConfiguredAt: new Date() },
        ...extraClients.map((client) => ({
          id: client.id,
          workspaceId: fixture.workspaceId,
          name: client.name,
          accountAssignmentsConfiguredAt: new Date(),
        })),
      ],
    });

    const connAurora = `conn-aurora-${suffix}`;
    const connNorth = `conn-north-${suffix}`;
    const connShared = `conn-shared-${suffix}`;
    const connShopeeShared = `conn-shopee-shared-${suffix}`;
    await db.connection.createMany({
      data: [
        {
          id: connAurora,
          workspaceId: fixture.workspaceId,
          name: "Aurora Google",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `aurora-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["8110008111"] }),
        },
        {
          id: connNorth,
          workspaceId: fixture.workspaceId,
          name: "Northwind Google",
          provider: "google_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `north-${suffix}`,
          credentials: JSON.stringify({ customerIds: ["8220008222"] }),
        },
        {
          id: connShared,
          workspaceId: fixture.workspaceId,
          name: "Shared Meta root",
          provider: "meta_ads",
          type: "source",
          status: "connected",
          remoteAccountId: `shared-${suffix}`,
          credentials: JSON.stringify({
            adAccountIds: ["act_8330008333", "act_8440008444"],
            adAccounts: [
              { id: "act_8330008333", name: "Aurora Shared Account" },
              { id: "act_8440008444", name: "Northwind Shared Account" },
            ],
            accessToken: "must-not-render",
          }),
        },
        {
          id: connShopeeShared,
          workspaceId: fixture.workspaceId,
          name: "Shared Shopee root",
          provider: "shopee",
          type: "source",
          status: "connected",
          remoteAccountId: `shopee-shared-${suffix}`,
          credentials: JSON.stringify({ shopId: "shop-northwind" }),
        },
      ],
    });
    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.aurora.id, provider: "google_ads", accountId: "8110008111", connectionId: connAurora },
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.northwind.id, provider: "google_ads", accountId: "8220008222", connectionId: connNorth },
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.aurora.id, provider: "meta_ads", accountId: "8330008333", connectionId: connShared },
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.northwind.id, provider: "meta_ads", accountId: "8440008444", connectionId: connShared },
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.aurora.id, provider: "shopee", accountId: "shop-aurora", connectionId: connShopeeShared },
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.northwind.id, provider: "shopee", accountId: "shop-northwind", connectionId: connShopeeShared },
      ],
    });
    await db.shopeeCampaign.createMany({ data: [
      { workspaceId: fixture.workspaceId, connectionId: connShopeeShared, environment: "sandbox", shopId: "shop-aurora", region: "VN", externalCampaignId: `shopee-a-${suffix}`, adType: "search", campaignName: "Aurora Catalog Campaign" },
      { workspaceId: fixture.workspaceId, connectionId: connShopeeShared, environment: "sandbox", shopId: "shop-northwind", region: "VN", externalCampaignId: `shopee-b-${suffix}`, adType: "search", campaignName: "Northwind Catalog Campaign" },
    ] });
    await db.campaignMetric.createMany({
      data: [
        {
          workspaceId: fixture.workspaceId,
          connectionId: connAurora,
          platform: "google_ads",
          accountId: "8110008111",
          accountName: "Aurora Ads",
          campaignId: `aurora-camp-${suffix}`,
          campaignName: "Aurora Exclusive Campaign",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 111,
          impressions: 1100,
          clicks: 11,
          currency: "USD",
        },
        {
          workspaceId: fixture.workspaceId,
          connectionId: connNorth,
          platform: "google_ads",
          accountId: "8220008222",
          accountName: "Northwind Ads",
          campaignId: `north-camp-${suffix}`,
          campaignName: "Northwind Exclusive Campaign",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 222,
          impressions: 2200,
          clicks: 22,
          currency: "USD",
        },
      ],
    });

    const bobWorkspace = await db.workspace.findFirst({
      where: { members: { some: { user: { email: BOB.email } } } },
      select: { id: true },
    });
    if (bobWorkspace) {
      await db.client.create({
        data: { id: fixture.rivalClientId, workspaceId: bobWorkspace.id, name: "Beta Rival Brand" },
      });
    }
  });

  test.afterAll(async () => {
    try {
      await db?.$transaction(async (tx) => {
        await tx.campaignMetric.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.connection.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.client.deleteMany({ where: { id: fixture.rivalClientId } });
        await tx.client.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspaceProviderAccess.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspace.delete({ where: { id: fixture.workspaceId } });
      });
    } finally {
      await db?.$disconnect();
    }
  });

  test("selects Client A, switches to B, refreshes, deep-links, and preserves filters across surfaces", async ({ authenticatedPage: page }) => {
    await page.goto(`/explorer?startDate=${DATE}&endDate=${DATE}&platform=google_ads`);
    await expect(page.getByTestId("client-context-bar")).toBeVisible();
    await selectClient(page, fixture.clients.aurora.name);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.aurora.id}`));
    await expect(page.getByTestId("client-context-bar")).toContainText("Viewing: Aurora Retailer");
    await expect(page.getByText("Aurora Exclusive Campaign")).toBeVisible();
    await expect(page.getByText("Northwind Exclusive Campaign")).toHaveCount(0);
    await expect(page).toHaveURL(/platform=google_ads/);
    await expect(page).toHaveURL(new RegExp(`startDate=${DATE}`));

    await selectClient(page, fixture.clients.northwind.name);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await expect(page.getByTestId("client-context-bar")).toContainText("Viewing: Northwind Traders");
    await expect(page.getByText("Northwind Exclusive Campaign")).toBeVisible();
    await expect(page.getByText("Aurora Exclusive Campaign")).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("client-context-bar")).toContainText("Viewing: Northwind Traders");
    await expect(page.getByText("Northwind Exclusive Campaign")).toBeVisible();
    await expect(page.getByText("Aurora Exclusive Campaign")).toHaveCount(0);

    const copied = new URL(page.url());
    await page.goto("/console");
    await page.goto(`${copied.pathname}${copied.search}`);
    await expect(page.getByTestId("client-context-bar")).toContainText("Viewing: Northwind Traders");

    await followSidebarLink(page, "Reports");
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await followSidebarLink(page, "Clients");
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await followSidebarLink(page, "Exports & API");
    await expect(page).toHaveURL(/\/exports\?/);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await expect(page).toHaveURL(new RegExp(`startDate=${DATE}`));
    await expect(page).toHaveURL(new RegExp(`endDate=${DATE}`));
    await expect(page).toHaveURL(/platform=google_ads/);
    await followSidebarLink(page, "Sources");
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await followSidebarLink(page, "Warehouse");
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await expect(page.getByText("Northwind Exclusive Campaign")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/sources/);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await page.goForward();
    await expect(page).toHaveURL(/\/explorer/);
    await expect(page.getByText("Northwind Exclusive Campaign")).toBeVisible();
  });

  test("keyboard selector, long names, and 5–20 client list stay usable", async ({ authenticatedPage: page }) => {
    await page.goto("/clients");
    const selector = page.getByLabel("Switch client");
    await expect(selector).toBeVisible();
    await selector.focus();
    await selector.selectOption({ label: fixture.clients.long.name });
    await expect(page.getByTestId("client-context-bar")).toContainText("Viewing:");
    await expect(page.getByTestId("client-context-bar")).toContainText("Very Long Client Name");
    const optionCount = await selector.locator("option").count();
    expect(optionCount).toBeGreaterThanOrEqual(16);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBeTruthy();
  });

  test("selected Clients view hides sibling-client content", async ({ authenticatedPage: page }) => {
    await page.goto(`/clients?clientId=${fixture.clients.aurora.id}`);
    await expect(page.getByTestId("client-context-bar")).toContainText("Viewing: Aurora Retailer");
    await expect(page.getByRole("heading", { name: fixture.clients.aurora.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: fixture.clients.northwind.name })).toHaveCount(0);
    await expect(page.getByText("1 Brands")).toBeVisible();
  });

  test("selected Sources view projects shared-root account metadata", async ({ authenticatedPage: page }) => {
    await page.goto(`/sources?clientId=${fixture.clients.aurora.id}`);
    await expect(page.getByText("8330008333")).toBeVisible();
    await expect(page.getByText("8440008444")).toHaveCount(0);
    await expect(page.getByText("must-not-render")).toHaveCount(0);
  });

  test("selected Warehouse view scopes Shopee catalog rows under a shared root", async ({ authenticatedPage: page }) => {
    await page.goto(`/explorer?clientId=${fixture.clients.aurora.id}&platform=shopee&startDate=${DATE}&endDate=${DATE}`);
    // Catalog cards render `Campaign <externalCampaignId>` plus `shop <shopId>`;
    // campaignName is API-only, so assert the rendered scoped shop identity.
    await expect(page.getByRole("heading", { name: "Campaigns (1)" })).toBeVisible();
    await expect(page.getByText("shop-aurora")).toBeVisible();
    await expect(page.getByText("shop-northwind")).toHaveCount(0);
  });

  test("filter controls write canonical URLs and restore through refresh and history", async ({ authenticatedPage: page }) => {
    await page.goto("/explorer");
    await expect(page).toHaveURL(/startDate=/);
    await expect(page).toHaveURL(/endDate=/);
    const dateInputs = page.locator('input[type="date"]');
    await dateInputs.nth(0).fill(DATE);
    await dateInputs.nth(1).fill(DATE);

    const platformControl = page.getByText("Platform", { exact: true }).locator("..").getByRole("button").first();
    await platformControl.click();
    await page.getByRole("button", { name: /Google Ads/ }).last().click();
    await expect(page).toHaveURL(new RegExp(`startDate=${DATE}`));
    await expect(page).toHaveURL(new RegExp(`endDate=${DATE}`));
    await expect(page).toHaveURL(/platform=google_ads/);

    await page.goto(`${page.url()}&accountId=unsafe&page=7&unknown=drop-me&code=oauth`);
    await selectClient(page, fixture.clients.aurora.name);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.aurora.id}`));
    await expect(page).not.toHaveURL(/accountId=|page=7|unknown=|code=/);
    await expect(page).toHaveURL(/platform=google_ads/);

    await followSidebarLink(page, "Reports");
    await page.getByRole("button", { name: "Sync activity" }).click();
    await page.getByLabel("From").fill(DATE);
    await page.getByLabel("To").fill(DATE);
    await page.getByRole("button", { name: "Error", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`dateFrom=${DATE}`));
    await expect(page).toHaveURL(new RegExp(`dateTo=${DATE}`));
    await expect(page).toHaveURL(/status=error/);
    await page.reload();
    await expect(page.getByLabel("From")).toHaveValue(DATE);
    await expect(page.getByLabel("To")).toHaveValue(DATE);
    await expect(page.getByRole("button", { name: "Error", exact: true })).toHaveClass(/bg-white/);

    await page.getByRole("button", { name: "Success", exact: true }).click();
    await expect(page).toHaveURL(/status=success/);
    await page.goBack();
    await expect(page).toHaveURL(/status=error/);
    await expect(page.getByRole("button", { name: "Error", exact: true })).toHaveClass(/bg-white/);
    await page.goForward();
    await expect(page).toHaveURL(/status=success/);
  });

  test("rival and malformed client ids reveal no rival data and cannot broaden warehouse/report/export scope", async ({ authenticatedPage: page, browser }) => {
    await page.goto(`/explorer?clientId=${fixture.rivalClientId}&startDate=${DATE}&endDate=${DATE}`);
    await expect(page.getByTestId("client-context-bar")).toContainText("This client is no longer available");
    await expect(page.getByText("Beta Rival Brand")).toHaveCount(0);
    await expect(page.getByText("Rival Campaign")).toHaveCount(0);
    await expect(page.getByText("Aurora Exclusive Campaign")).toHaveCount(0);
    await expect(page.getByText("Northwind Exclusive Campaign")).toHaveCount(0);

    const metricsRival = await page.request.get(
      `/api/metrics/query?workspaceId=${fixture.workspaceId}&clientId=${fixture.rivalClientId}&startDate=${DATE}&endDate=${DATE}`,
    );
    expect(metricsRival.status()).toBe(404);
    const rivalBody = await metricsRival.json() as { error?: string; metrics?: unknown };
    expect(rivalBody.metrics).toBeUndefined();
    expect(rivalBody.error).toBe("Client not found in workspace");

    const malformed = await page.request.get(
      `/api/metrics/query?workspaceId=${fixture.workspaceId}&clientId=${encodeURIComponent("not valid")}&startDate=${DATE}&endDate=${DATE}`,
    );
    expect(malformed.status()).toBe(400);

    const reportRival = await page.request.get(
      `/api/reports/performance?workspaceId=${fixture.workspaceId}&clientId=${fixture.rivalClientId}&startDate=${DATE}&endDate=${DATE}`,
    );
    expect(reportRival.status()).toBe(404);

    const bob = await freshAuthenticatedSession(browser, bobSession, (page) => signIn(page, BOB));
    try {
      const bobOnAlice = await bob.page.request.get(
        `/api/metrics/query?workspaceId=${fixture.workspaceId}&clientId=${fixture.clients.aurora.id}&startDate=${DATE}&endDate=${DATE}`,
      );
      expect(bobOnAlice.status()).toBe(403);
    } finally {
      await bob.context.close();
    }
    expect({ alice: aliceSession.loginCount, rival: bobSession.loginCount }).toEqual({ alice: 1, rival: 1 });
  });
});
