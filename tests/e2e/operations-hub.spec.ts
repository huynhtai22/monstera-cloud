import { expect, test as base, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertAllowedTestDatabase } from "../../src/lib/pg-test-discipline";
import {
  createAuthenticatedSessionCache,
  freshAuthenticatedSession,
} from "./authenticated-session";

const suffix = `ops-e2e-${Date.now()}-${process.pid}`;
const DAY = "2026-09-04";
const ALICE = { email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!" };

type Fixture = {
  workspaceId: string;
  ownerUserId: string;
  connectionId: string;
  clients: { healthy: { id: string; name: string }; sick: { id: string; name: string } };
};

let db: PrismaClient;
let fixture: Fixture;
const aliceSession = createAuthenticatedSessionCache();

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

async function followSidebarLink(page: Page, name: string) {
  if (await page.evaluate(() => window.innerWidth < 1024)) {
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await page.getByRole("link", { name }).click();
}

test.describe("operations hub", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    const alice = await db.user.findUniqueOrThrow({ where: { email: ALICE.email }, select: { id: true } });

    fixture = {
      workspaceId: `ws-ops-${suffix}`,
      ownerUserId: alice.id,
      connectionId: `conn-ops-${suffix}`,
      clients: {
        healthy: { id: `client-ops-ok-${suffix}`, name: "Operations Healthy Brand" },
        sick: { id: `client-ops-sick-${suffix}`, name: "Operations Sick Brand" },
      },
    };

    await db.workspace.create({
      data: {
        id: fixture.workspaceId,
        slug: `ops-e2e-${suffix}`,
        name: "Operations Hub E2E Workspace",
        ownerId: alice.id,
        plan: "pilot",
        status: "PILOT",
        members: { create: [{ userId: alice.id, role: "owner" }] },
      },
    });

    await db.client.createMany({
      data: [
        {
          id: fixture.clients.healthy.id,
          workspaceId: fixture.workspaceId,
          name: fixture.clients.healthy.name,
          accountAssignmentsConfiguredAt: new Date(),
        },
        {
          id: fixture.clients.sick.id,
          workspaceId: fixture.workspaceId,
          name: fixture.clients.sick.name,
          accountAssignmentsConfiguredAt: new Date(),
        },
      ],
    });

    await db.connection.create({
      data: {
        id: fixture.connectionId,
        workspaceId: fixture.workspaceId,
        name: "Operations Google",
        provider: "google_ads",
        type: "source",
        status: "connected",
        remoteAccountId: `ops-${suffix}`,
        credentials: JSON.stringify({ customerIds: ["8550008555"] }),
      },
    });

    // One healthy and one quarantined account so connector health is provably
    // derived from the whole population rather than the display slice.
    await db.providerAccountHealth.createMany({
      data: [
        {
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connectionId,
          provider: "google_ads",
          accountId: `ok-${suffix}`,
          accountName: "Operations Healthy Account",
          status: "healthy",
        },
        {
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connectionId,
          provider: "google_ads",
          accountId: `quarantined-${suffix}`,
          accountName: "Operations Quarantined Account",
          status: "quarantined",
          consecutiveFailures: 4,
          errorCategory: "AUTH_EXPIRED",
          lastError: "token expired",
        },
      ],
    });

    await db.destinationDeliveryReceipt.create({
      data: {
        workspaceId: fixture.workspaceId,
        clientId: fixture.clients.healthy.id,
        destination: "google_sheets",
        windowStart: DAY,
        windowEnd: DAY,
        dataThroughDate: DAY,
        datasetFingerprint: `fp-${suffix}`,
        rowCount: 12,
        actorId: alice.id,
      },
    });

    await db.campaignMetric.create({
      data: {
        workspaceId: fixture.workspaceId,
        connectionId: fixture.connectionId,
        platform: "google_ads",
        accountId: `ok-${suffix}`,
        accountName: "Operations Healthy Account",
        campaignId: `ops-camp-${suffix}`,
        campaignName: "Operations Campaign",
        date: new Date(`${DAY}T00:00:00.000Z`),
        spend: 25,
        impressions: 250,
        clicks: 5,
        currency: "USD",
      },
    });
  });

  test.afterAll(async () => {
    try {
      await db?.$transaction(async (tx) => {
        await tx.campaignMetric.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.destinationDeliveryReceipt.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.providerAccountHealth.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.connection.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.client.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspace.delete({ where: { id: fixture.workspaceId } });
      });
    } finally {
      await db?.$disconnect();
    }
  });

  test("redirects an anonymous visitor to login with a callback to /operations", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/operations");
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).searchParams.get("callbackUrl")).toBe("/operations");
    await context.close();
  });

  test("renders every operations section with connector attention and the client context bar", async ({ authenticatedPage: page }) => {
    await page.goto("/operations");
    await expect(page.getByTestId("operations-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operations Hub" })).toBeVisible();
    await expect(page.getByTestId("client-context-bar")).toBeVisible();

    for (const key of ["connectorHealth", "freshness", "ingestion", "readiness", "delivery", "anomalies"]) {
      await expect(page.getByTestId(`operations-section-${key}`)).toBeVisible();
    }

    // The quarantined account makes connector health need attention, and the
    // healthy account is still counted in the totals.
    await expect(page.getByTestId("operations-state-connectorHealth")).toHaveAttribute("data-state", "attention");
    await expect(page.getByTestId("operations-section-connectorHealth")).toContainText("Operations Quarantined Account");
    await expect(page.getByTestId("operations-section-connectorHealth")).toContainText("Quarantined");

    // Workspace-wide: the readiness section evaluates both fixture clients.
    await expect(page.getByTestId("operations-section-readiness")).toContainText("Evaluated");
    await expect(page.getByTestId("operations-section-readiness")).toContainText("Operations Healthy Brand");

    // Nothing may leak provider credentials into the page.
    await expect(page.locator("body")).not.toContainText("8550008555");

    // The card lists one action per non-ready section, so this fixture yields
    // five: connector health, freshness and readiness need attention, ingestion
    // and anomalies are empty, and delivery is ready (no action). The
    // assertions below then narrow to the high-priority connector-health action
    // specifically.
    await expect(page.getByTestId("operations-actions")).toBeVisible();
    await expect(page.getByTestId("operations-actions-count")).toHaveText("5");
    const connectorAction = page.getByTestId("operations-action-connectorHealth");
    await expect(connectorAction).toBeVisible();
    await expect(connectorAction).toHaveAttribute("data-priority", "high");
    await expect(connectorAction).toContainText("quarantined");
    await expect(connectorAction.getByRole("link", { name: "Open sources" })).toHaveAttribute("href", "/sources");
  });

  test("scopes to a client, marks ingestion not applicable, and restores it for All clients", async ({ authenticatedPage: page }) => {
    await page.goto("/operations");
    await expect(page.getByTestId("operations-page")).toBeVisible();

    await page.getByLabel("Switch client").selectOption({ label: fixture.clients.healthy.name });
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.healthy.id}`));
    await expect(page.getByTestId("client-context-bar")).toContainText(`Viewing: ${fixture.clients.healthy.name}`);
    await expect(page.getByTestId("operations-scope")).toContainText(fixture.clients.healthy.name);

    // Ingestion is workspace-scoped by design and must be disclosed, never guessed.
    const ingestion = page.getByTestId("operations-section-ingestion");
    await expect(ingestion).toHaveAttribute("data-state", "unsupported");
    await expect(page.getByTestId("operations-state-ingestion")).toHaveText(/Not applicable/);
    await expect(ingestion).toContainText("All clients");

    // Ingestion action explains scope limitation
    const ingestionAction = page.getByTestId("operations-action-ingestion");
    await expect(ingestionAction).toBeVisible();
    await expect(ingestionAction).toHaveAttribute("data-priority", "low");

    await page.getByLabel("Switch client").selectOption({ label: "All clients" });
    await expect(page.getByTestId("operations-section-ingestion")).not.toHaveAttribute("data-state", "unsupported");
  });

  test("reaches the operations hub from the sidebar and keeps client context", async ({ authenticatedPage: page }) => {
    await page.goto("/explorer");
    await page.getByLabel("Switch client").selectOption({ label: fixture.clients.sick.name });
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.sick.id}`));

    await followSidebarLink(page, "Operations");
    await expect(page).toHaveURL(/\/operations\?/);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.sick.id}`));
    await expect(page.getByTestId("client-context-bar")).toContainText(`Viewing: ${fixture.clients.sick.name}`);
  });

  test("navigates through next action CTA preserving client context", async ({ authenticatedPage: page }) => {
    await page.goto("/operations");
    await page.getByLabel("Switch client").selectOption({ label: fixture.clients.sick.name });
    await expect(page.getByTestId("operations-scope")).toContainText(fixture.clients.sick.name);

    // Ingestion action points to reports and preserves client context
    const ingestionAction = page.getByTestId("operations-action-ingestion");
    await expect(ingestionAction).toBeVisible();
    await ingestionAction.getByRole("link", { name: "Open reports" }).click();
    await expect(page).toHaveURL(/\/reports\?/);
    await expect(page).toHaveURL(new RegExp(`clientId=${fixture.clients.sick.id}`));
    await expect(page.getByTestId("client-context-bar")).toContainText(`Viewing: ${fixture.clients.sick.name}`);
  });
});
