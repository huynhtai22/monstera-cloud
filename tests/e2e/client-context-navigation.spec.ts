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
      ],
    });
    await db.clientProviderAccountAssignment.createMany({
      data: [
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.aurora.id, provider: "google_ads", accountId: "8110008111", connectionId: connAurora },
        { workspaceId: fixture.workspaceId, clientId: fixture.clients.northwind.id, provider: "google_ads", accountId: "8220008222", connectionId: connNorth },
      ],
    });
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
      expect({ alice: aliceSession.loginCount, rival: bobSession.loginCount }).toEqual({ alice: 1, rival: 1 });
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

    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await page.getByRole("link", { name: "Clients" }).click();
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await page.getByRole("link", { name: "Exports & API" }).click();
    await expect(page).toHaveURL(new RegExp(`/exports\\?clientId=${fixture.clients.northwind.id}`));
    await page.getByRole("link", { name: "Sources" }).click();
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.northwind.id}`));
    await page.getByRole("link", { name: "Warehouse" }).click();
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
  });
});
