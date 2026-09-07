import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashApiKey } from "../../src/lib/api-key-security";
import { assertAllowedTestDatabase } from "../../src/lib/pg-test-discipline";

/**
 * Persisted assignment coverage matrix
 *
 *  1–3: deep-link selection, five-client management, and visible tuple identity
 *  4–7: single assignment, persisted refresh, bulk assignment, explicit reassign confirmation
 *  8–11: atomic cutover conflict, source switch, final unassign, explicit-empty persistence
 * 12–13: warehouse and CSV export exact (connection, provider, account) tuple scoping
 * 14–15: viewer and rival-workspace authorization boundaries
 * 16–17: ambiguous MCC roots remain manual-only, plus desktop/mobile overflow checks
 *
 * The fixture writes only to the isolated monstera_e2e database. Every positive
 * assignment transition is exercised through the rendered application UI.
 */

const suffix = `caa-e2e-${Date.now()}-${process.pid}`;
const DATE = "2026-09-01";
const ALICE = { email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!" };
const CHARLIE = { email: "charlie@alpha-agency.test", password: "Pilot_Alpha_2026!" };
const BOB = { email: "bob@beta-media.test", password: "Pilot_Beta_2026!" };

type Fixture = {
  workspaceId: string;
  ownerUserId: string;
  apiKeySecret: string;
  clients: {
    one: { id: string; name: string };
    two: { id: string; name: string };
    three: { id: string; name: string };
    four: { id: string; name: string };
    five: { id: string; name: string };
  };
  connections: {
    main: { id: string; name: string };
    sharedOne: { id: string; name: string };
    sharedTwo: { id: string; name: string };
    conflictOne: { id: string; name: string };
    conflictTwo: { id: string; name: string };
  };
  accounts: {
    single: string;
    bulkOne: string;
    bulkTwo: string;
    shared: string;
    conflict: string;
  };
};

let db: PrismaClient;
let fixture: Fixture;

function accountRow(page: Page, accountId: string) {
  return page.locator("tbody tr").filter({ hasText: accountId }).first();
}

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

async function useFixtureWorkspace(page: Page) {
  await page.addInitScript(({ workspaceId, userId }: { workspaceId: string; userId: string }) => {
    window.localStorage.setItem(
      "monstera-workspace-storage",
      JSON.stringify({ state: { activeWorkspaceId: workspaceId }, version: 0 }),
    );
    window.sessionStorage.setItem("monstera-last-auth-user-id", userId);
  }, { workspaceId: fixture.workspaceId, userId: fixture.ownerUserId });
}

async function signInToFixture(page: Page) {
  await signIn(page, ALICE);
  await useFixtureWorkspace(page);
}

async function getAccounts(page: Page, clientId?: string) {
  const search = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  const response = await page.request.get(`/api/workspaces/${fixture.workspaceId}/client-accounts${search}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{
    accounts: Array<{
      provider: string;
      accountId: string;
      assignedClient: { id: string; name: string } | null;
      authoritativeConnectionId: string | null;
    }>;
  }>;
}

async function assignAccountFromUi(
  page: Page,
  accountId: string,
  clientId: string,
  connectionId?: string,
) {
  const row = accountRow(page, accountId);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Assign account ${accountId}` }).click();
  await expect(page.getByRole("heading", { name: "Assign Account" })).toBeVisible();

  await page.getByText("Target Client Brand", { exact: true }).locator("..").locator("select").selectOption(clientId);
  if (connectionId) {
    await page
      .getByText("Authoritative Root Connection", { exact: true })
      .locator("..")
      .locator("select")
      .selectOption(connectionId);
  }

  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && candidate.url().includes(`/api/workspaces/${fixture.workspaceId}/client-accounts`)
    && candidate.status() === 200,
  );
  await page.getByRole("button", { name: "Confirm Assignment" }).click();
  await response;
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBeTruthy();
}

test.describe("client account assignment journeys", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const url = assertAllowedTestDatabase(process.env.DATABASE_URL);
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();

    const [alice, charlie] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: ALICE.email }, select: { id: true } }),
      db.user.findUniqueOrThrow({ where: { email: CHARLIE.email }, select: { id: true } }),
    ]);

    fixture = {
      workspaceId: `ws-${suffix}`,
      ownerUserId: alice.id,
      apiKeySecret: `mc_live_${suffix}`,
      clients: {
        one: { id: `client-one-${suffix}`, name: "Assignment Client One" },
        two: { id: `client-two-${suffix}`, name: "Assignment Client Two" },
        three: { id: `client-three-${suffix}`, name: "Assignment Client Three" },
        four: { id: `client-four-${suffix}`, name: "Assignment Client Four" },
        five: { id: `client-five-${suffix}`, name: "Assignment Client Five" },
      },
      connections: {
        main: { id: `connection-main-${suffix}`, name: "Assignment Google Main Root" },
        sharedOne: { id: `connection-shared-one-${suffix}`, name: "Assignment Shared MCC A" },
        sharedTwo: { id: `connection-shared-two-${suffix}`, name: "Assignment Shared MCC B" },
        conflictOne: { id: `connection-conflict-one-${suffix}`, name: "Assignment Conflict MCC A" },
        conflictTwo: { id: `connection-conflict-two-${suffix}`, name: "Assignment Conflict MCC B" },
      },
      accounts: {
        single: "8111111111",
        bulkOne: "8222222222",
        bulkTwo: "8333333333",
        shared: "8444444444",
        conflict: "8555555555",
      },
    };

    await db.workspace.create({
      data: {
        id: fixture.workspaceId,
        slug: `assignment-e2e-${suffix}`,
        name: "Assignment E2E Workspace",
        ownerId: alice.id,
        plan: "pilot",
        status: "PILOT",
        members: {
          create: [
            { userId: alice.id, role: "owner" },
            { userId: charlie.id, role: "viewer" },
          ],
        },
        providerAccess: { create: { provider: "google_ads", enabled: true } },
      },
    });

    await db.client.createMany({
      data: Object.values(fixture.clients).map((client) => ({
        id: client.id,
        workspaceId: fixture.workspaceId,
        name: client.name,
      })),
    });

    await db.connection.createMany({
      data: [
        {
          id: fixture.connections.main.id,
          workspaceId: fixture.workspaceId,
          name: fixture.connections.main.name,
          provider: "google_ads",
          type: "source",
          credentials: JSON.stringify({
            customerIds: [fixture.accounts.single, fixture.accounts.bulkOne, fixture.accounts.bulkTwo],
          }),
          remoteAccountId: `main-${suffix}`,
          status: "connected",
          lastSyncAt: new Date(`${DATE}T12:00:00.000Z`),
        },
        {
          id: fixture.connections.sharedOne.id,
          workspaceId: fixture.workspaceId,
          name: fixture.connections.sharedOne.name,
          provider: "google_ads",
          type: "source",
          credentials: JSON.stringify({ customerIds: [fixture.accounts.shared] }),
          remoteAccountId: `shared-one-${suffix}`,
          status: "connected",
          lastSyncAt: new Date(`${DATE}T12:00:00.000Z`),
        },
        {
          id: fixture.connections.sharedTwo.id,
          workspaceId: fixture.workspaceId,
          clientId: fixture.clients.five.id,
          name: fixture.connections.sharedTwo.name,
          provider: "google_ads",
          type: "source",
          credentials: JSON.stringify({ customerIds: [fixture.accounts.shared] }),
          remoteAccountId: `shared-two-${suffix}`,
          status: "connected",
          lastSyncAt: new Date(`${DATE}T12:00:00.000Z`),
        },
        {
          id: fixture.connections.conflictOne.id,
          workspaceId: fixture.workspaceId,
          clientId: fixture.clients.four.id,
          name: fixture.connections.conflictOne.name,
          provider: "google_ads",
          type: "source",
          credentials: JSON.stringify({ customerIds: [fixture.accounts.conflict] }),
          remoteAccountId: `conflict-one-${suffix}`,
          status: "connected",
          lastSyncAt: new Date(`${DATE}T12:00:00.000Z`),
        },
        {
          id: fixture.connections.conflictTwo.id,
          workspaceId: fixture.workspaceId,
          name: fixture.connections.conflictTwo.name,
          provider: "google_ads",
          type: "source",
          credentials: JSON.stringify({ customerIds: [fixture.accounts.conflict] }),
          remoteAccountId: `conflict-two-${suffix}`,
          status: "connected",
          lastSyncAt: new Date(`${DATE}T12:00:00.000Z`),
        },
      ],
    });

    await Promise.all([
      db.apiKey.create({
        data: {
          workspaceId: fixture.workspaceId,
          name: "Assignment E2E export key",
          keyHash: hashApiKey(fixture.apiKeySecret),
          keyPrefix: "mc_live_",
          keyLastFour: fixture.apiKeySecret.slice(-4),
        },
      }),
      db.campaignMetric.create({
        data: {
          id: `shared-legacy-metric-${suffix}`,
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connections.sharedTwo.id,
          platform: "google_ads",
          accountId: fixture.accounts.shared,
          accountName: "Shared account legacy fallback",
          campaignId: `shared-legacy-${suffix}`,
          campaignName: "Legacy fallback must not return after final unassign",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 1,
          currency: "USD",
        },
      }),
    ]);
  });

  test.afterAll(async () => {
    try {
      await db?.$transaction(async (tx) => {
        await tx.campaignMetric.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.clientProviderAccountAssignment.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.connection.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.client.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.apiKey.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspaceProviderAccess.deleteMany({ where: { workspaceId: fixture.workspaceId } });
        await tx.workspace.delete({ where: { id: fixture.workspaceId } });
      });
    } finally {
      await db?.$disconnect();
    }
  });

  test("Manage sources deep-link selects the accounts tab and preserves five-client identity", async ({ page }) => {
    await signInToFixture(page);
    await page.goto("/clients");

    const manage = page.locator(`a[href="/sources?clientId=${fixture.clients.one.id}&tab=accounts"]`);
    await expect(manage).toBeVisible();
    await expect(manage).toHaveAccessibleName("Manage sources");
    await manage.click();

    const accountsTab = page.getByRole("tab", { name: "Client accounts" });
    await expect(accountsTab).toHaveAttribute("aria-selected", "true");
    const clientFilter = page.getByLabel("Filter accounts by client");
    await expect(clientFilter).toHaveValue(fixture.clients.one.id);

    const clientOptions = await clientFilter.locator("option").allTextContents();
    for (const client of Object.values(fixture.clients)) {
      expect(clientOptions).toContain(client.name);
    }

    // A client-scoped view intentionally contains only that client's explicit
    // assignments; discovering an unassigned workspace account must not make it
    // appear under the deep-linked client.
    await expect(page.getByText("No provider accounts found")).toBeVisible();
    await expectNoDocumentOverflow(page);
  });

  test("single assignment is visibly distinct and persists across refresh and a new API request", async ({ page }) => {
    await signInToFixture(page);
    await page.goto("/sources?tab=accounts");

    await assignAccountFromUi(page, fixture.accounts.single, fixture.clients.one.id);
    const row = accountRow(page, fixture.accounts.single);
    await expect(row).toContainText(fixture.clients.one.name);
    await expect(row).toContainText(fixture.connections.main.name);
    await expect(row).toContainText("Google Ads");

    await page.reload();
    await expect(page.getByRole("tab", { name: "Client accounts" })).toHaveAttribute("aria-selected", "true");
    await expect(accountRow(page, fixture.accounts.single)).toContainText(fixture.clients.one.name);

    const refreshed = await getAccounts(page, fixture.clients.one.id);
    expect(refreshed.accounts).toEqual([
      expect.objectContaining({
        provider: "google_ads",
        accountId: fixture.accounts.single,
        authoritativeConnectionId: fixture.connections.main.id,
        assignedClient: expect.objectContaining({ id: fixture.clients.one.id }),
      }),
    ]);
    await expectNoDocumentOverflow(page);
  });

  test("bulk assignment scopes warehouse and export output to exact assigned tuples", async ({ page }) => {
    await signInToFixture(page);
    await page.goto("/sources?tab=accounts");

    await page.getByLabel(`Select account ${fixture.accounts.bulkOne}`).check();
    await page.getByLabel(`Select account ${fixture.accounts.bulkTwo}`).check();
    await page.getByRole("button", { name: /Assign 2 selected/ }).click();
    await expect(page.getByRole("heading", { name: "Bulk Assign Accounts" })).toBeVisible();
    await page.getByText("Target Client Brand", { exact: true }).locator("..").locator("select").selectOption(fixture.clients.three.id);

    const bulkResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && candidate.url().includes(`/api/workspaces/${fixture.workspaceId}/client-accounts`)
      && candidate.status() === 200,
    );
    await page.getByRole("button", { name: "Assign 2 Accounts" }).click();
    await bulkResponse;

    const assigned = await getAccounts(page, fixture.clients.three.id);
    expect(assigned.accounts.map((account) => account.accountId).sort()).toEqual([
      fixture.accounts.bulkOne,
      fixture.accounts.bulkTwo,
    ]);
    expect(assigned.accounts.every((account) => account.authoritativeConnectionId === fixture.connections.main.id)).toBeTruthy();

    await db.campaignMetric.createMany({
      data: [
        {
          id: `bulk-included-one-${suffix}`,
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connections.main.id,
          platform: "google_ads",
          accountId: fixture.accounts.bulkOne,
          accountName: "Bulk One",
          campaignId: `bulk-included-one-${suffix}`,
          entityId: `bulk-included-one-${suffix}`,
          campaignName: "Tuple included bulk one",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 10,
          currency: "USD",
        },
        {
          id: `bulk-included-two-${suffix}`,
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connections.main.id,
          platform: "google_ads",
          accountId: fixture.accounts.bulkTwo,
          accountName: "Bulk Two",
          campaignId: `bulk-included-two-${suffix}`,
          entityId: `bulk-included-two-${suffix}`,
          campaignName: "Tuple included bulk two",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 20,
          currency: "USD",
        },
        {
          id: `bulk-wrong-root-${suffix}`,
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connections.sharedOne.id,
          platform: "google_ads",
          accountId: fixture.accounts.bulkOne,
          accountName: "Wrong root",
          campaignId: `bulk-wrong-root-${suffix}`,
          entityId: `bulk-wrong-root-${suffix}`,
          campaignName: "Tuple excluded wrong root",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 30,
          currency: "USD",
        },
        {
          id: `bulk-wrong-provider-${suffix}`,
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connections.main.id,
          platform: "meta_ads",
          accountId: fixture.accounts.bulkOne,
          accountName: "Wrong provider",
          campaignId: `bulk-wrong-provider-${suffix}`,
          entityId: `bulk-wrong-provider-${suffix}`,
          campaignName: "Tuple excluded wrong provider",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 40,
          currency: "USD",
        },
        {
          id: `bulk-wrong-account-${suffix}`,
          workspaceId: fixture.workspaceId,
          connectionId: fixture.connections.main.id,
          platform: "google_ads",
          accountId: "8999999999",
          accountName: "Wrong account",
          campaignId: `bulk-wrong-account-${suffix}`,
          entityId: `bulk-wrong-account-${suffix}`,
          campaignName: "Tuple excluded wrong account",
          date: new Date(`${DATE}T00:00:00.000Z`),
          spend: 50,
          currency: "USD",
        },
      ],
    });

    const warehouseResponse = await page.request.get(
      `/api/metrics/query?workspaceId=${fixture.workspaceId}&clientId=${fixture.clients.three.id}&startDate=${DATE}&endDate=${DATE}`,
    );
    expect(warehouseResponse.ok()).toBeTruthy();
    const warehouse = await warehouseResponse.json() as {
      metrics: Array<{ connectionId: string; platform: string; accountId: string; campaignName: string }>;
    };
    expect(warehouse.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        connectionId: fixture.connections.main.id,
        platform: "google_ads",
        accountId: fixture.accounts.bulkOne,
        campaignName: "Tuple included bulk one",
      }),
      expect.objectContaining({
        connectionId: fixture.connections.main.id,
        platform: "google_ads",
        accountId: fixture.accounts.bulkTwo,
        campaignName: "Tuple included bulk two",
      }),
    ]));
    expect(warehouse.metrics).toHaveLength(2);

    const exportResponse = await page.request.get(`/api/export/rows?clientId=${fixture.clients.three.id}`, {
      headers: { Authorization: `Bearer ${fixture.apiKeySecret}` },
    });
    expect(exportResponse.ok()).toBeTruthy();
    const exported = await exportResponse.json() as { rows: Array<Array<string | number>> };
    const exportText = exported.rows.flat().join(" ");
    expect(exportText).toContain("Tuple included bulk one");
    expect(exportText).toContain("Tuple included bulk two");
    expect(exportText).not.toContain("Tuple excluded wrong root");
    expect(exportText).not.toContain("Tuple excluded wrong provider");
    expect(exportText).not.toContain("Tuple excluded wrong account");
    await expectNoDocumentOverflow(page);
  });

  test("ambiguous roots require a manual source choice, reassign only on confirmation, and final unassign remains empty", async ({ page }) => {
    await signInToFixture(page);
    await page.goto("/sources?tab=accounts");

    const sharedRow = accountRow(page, fixture.accounts.shared);
    await expect(sharedRow).toContainText("Ambiguous: 2 overlapping roots (MCC)");
    await expect(sharedRow).toContainText("Unassigned");

    await assignAccountFromUi(
      page,
      fixture.accounts.shared,
      fixture.clients.two.id,
      fixture.connections.sharedOne.id,
    );
    expect((await getAccounts(page, fixture.clients.two.id)).accounts).toEqual([
      expect.objectContaining({
        accountId: fixture.accounts.shared,
        authoritativeConnectionId: fixture.connections.sharedOne.id,
        assignedClient: expect.objectContaining({ id: fixture.clients.two.id }),
      }),
    ]);

    await accountRow(page, fixture.accounts.shared)
      .getByRole("button", { name: `Change authoritative source for account ${fixture.accounts.shared}` })
      .click();
    await expect(page.getByRole("heading", { name: "Change Authoritative Root Source" })).toBeVisible();
    await page
      .getByText("Select Authoritative Connection", { exact: true })
      .locator("..")
      .locator("select")
      .selectOption(fixture.connections.sharedTwo.id);
    const switchResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && candidate.url().includes(`/api/workspaces/${fixture.workspaceId}/client-accounts/switch-source`)
      && candidate.status() === 200,
    );
    await page.getByRole("button", { name: "Update Authoritative Root" }).click();
    await switchResponse;

    const switched = await getAccounts(page, fixture.clients.two.id);
    expect(switched.accounts[0]).toEqual(expect.objectContaining({
      accountId: fixture.accounts.shared,
      authoritativeConnectionId: fixture.connections.sharedTwo.id,
      assignedClient: expect.objectContaining({ id: fixture.clients.two.id }),
    }));

    await accountRow(page, fixture.accounts.shared)
      .getByRole("button", { name: `Reassign account ${fixture.accounts.shared}` })
      .click();
    await expect(page.getByRole("heading", { name: "Reassign Account" })).toBeVisible();
    await page.getByText("Target Client Brand", { exact: true }).locator("..").locator("select").selectOption(fixture.clients.five.id);

    // Selection alone is not a mutation: the old client still owns the tuple until explicit confirmation.
    expect((await getAccounts(page, fixture.clients.two.id)).accounts).toHaveLength(1);
    const reassignResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && candidate.url().includes(`/api/workspaces/${fixture.workspaceId}/client-accounts`)
      && candidate.status() === 200,
    );
    await page.getByRole("button", { name: "Confirm Reassignment" }).click();
    await reassignResponse;

    const reassigned = await getAccounts(page, fixture.clients.five.id);
    expect(reassigned.accounts).toEqual([
      expect.objectContaining({
        accountId: fixture.accounts.shared,
        authoritativeConnectionId: fixture.connections.sharedTwo.id,
        assignedClient: expect.objectContaining({ id: fixture.clients.five.id }),
      }),
    ]);

    await accountRow(page, fixture.accounts.shared)
      .getByRole("button", { name: `Unassign account ${fixture.accounts.shared}` })
      .click();
    const unassignDialog = page.getByRole("alertdialog");
    await expect(unassignDialog).toBeVisible();
    expect((await getAccounts(page, fixture.clients.five.id)).accounts).toHaveLength(1);
    const unassignResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && candidate.url().includes(`/api/workspaces/${fixture.workspaceId}/client-accounts/unassign`)
      && candidate.status() === 200,
    );
    await unassignDialog.getByRole("button", { name: "Unassign" }).click();
    await unassignResponse;

    await page.goto(`/sources?clientId=${fixture.clients.five.id}&tab=accounts`);
    await expect(page.getByLabel("Filter accounts by client")).toHaveValue(fixture.clients.five.id);
    await expect(page.getByText("No provider accounts found")).toBeVisible();

    const explicitClient = await page.request.get(`/api/clients?workspaceId=${fixture.workspaceId}`);
    expect(explicitClient.ok()).toBeTruthy();
    const clients = await explicitClient.json() as Array<{ id: string; accountAssignmentsConfiguredAt: string | null }>;
    expect(clients.find((client) => client.id === fixture.clients.five.id)?.accountAssignmentsConfiguredAt).toBeTruthy();

    const emptyWarehouse = await page.request.get(
      `/api/metrics/query?workspaceId=${fixture.workspaceId}&clientId=${fixture.clients.five.id}&startDate=${DATE}&endDate=${DATE}`,
    );
    expect(emptyWarehouse.ok()).toBeTruthy();
    expect((await emptyWarehouse.json() as { metrics: unknown[] }).metrics).toHaveLength(0);
    await expectNoDocumentOverflow(page);
  });

  test("failed cutover is atomic, five client filters remain isolated, and unauthorized callers cannot mutate", async ({ page, browser }) => {
    await signInToFixture(page);
    await page.goto("/sources?tab=accounts");

    const conflictRow = accountRow(page, fixture.accounts.conflict);
    await expect(conflictRow).toContainText("Ambiguous: 2 overlapping roots (MCC)");
    await expect(conflictRow).toContainText("Unassigned");

    const before = await Promise.all([
      db.client.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId: fixture.workspaceId, id: fixture.clients.four.id } },
        select: { accountAssignmentsConfiguredAt: true },
      }),
      db.clientProviderAccountAssignment.count({
        where: { workspaceId: fixture.workspaceId, clientId: fixture.clients.four.id },
      }),
      db.auditEvent.count({
        where: {
          workspaceId: fixture.workspaceId,
          action: "client_account.cutover_completed",
          resourceId: fixture.clients.four.id,
        },
      }),
    ]);

    const cutover = await page.request.post(`/api/workspaces/${fixture.workspaceId}/client-accounts/cutover`, {
      data: { clientId: fixture.clients.four.id },
    });
    expect(cutover.status()).toBe(409);

    const after = await Promise.all([
      db.client.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId: fixture.workspaceId, id: fixture.clients.four.id } },
        select: { accountAssignmentsConfiguredAt: true },
      }),
      db.clientProviderAccountAssignment.count({
        where: { workspaceId: fixture.workspaceId, clientId: fixture.clients.four.id },
      }),
      db.auditEvent.count({
        where: {
          workspaceId: fixture.workspaceId,
          action: "client_account.cutover_completed",
          resourceId: fixture.clients.four.id,
        },
      }),
    ]);
    expect(after).toEqual(before);
    expect(after[0].accountAssignmentsConfiguredAt).toBeNull();

    // Ambiguity is manual-only: a user can choose one root, but the failed automatic cutover did nothing.
    await assignAccountFromUi(
      page,
      fixture.accounts.conflict,
      fixture.clients.four.id,
      fixture.connections.conflictOne.id,
    );

    const clientFilter = page.getByLabel("Filter accounts by client");
    const expectedByClient = new Map<string, string[]>([
      [fixture.clients.one.id, [fixture.accounts.single]],
      [fixture.clients.two.id, []],
      [fixture.clients.three.id, [fixture.accounts.bulkOne, fixture.accounts.bulkTwo]],
      [fixture.clients.four.id, [fixture.accounts.conflict]],
      [fixture.clients.five.id, []],
    ]);
    for (const [clientId, expectedAccounts] of expectedByClient) {
      await clientFilter.selectOption(clientId);
      if (expectedAccounts.length === 0) {
        await expect(page.getByText("No provider accounts found")).toBeVisible();
      } else {
        for (const accountId of expectedAccounts) {
          await expect(accountRow(page, accountId)).toBeVisible();
        }
        const rendered = await page.locator("tbody tr").allTextContents();
        for (const accountId of [
          fixture.accounts.single,
          fixture.accounts.bulkOne,
          fixture.accounts.bulkTwo,
          fixture.accounts.conflict,
        ]) {
          expect(rendered.some((row) => row.includes(accountId))).toBe(expectedAccounts.includes(accountId));
        }
      }
    }

    const viewer = await browser.newContext();
    const viewerPage = await viewer.newPage();
    await signIn(viewerPage, CHARLIE);
    const viewerMutation = await viewerPage.request.post(`/api/workspaces/${fixture.workspaceId}/client-accounts`, {
      data: {
        clientId: fixture.clients.one.id,
        provider: "google_ads",
        accountId: fixture.accounts.single,
        connectionId: fixture.connections.main.id,
      },
    });
    expect(viewerMutation.status()).toBe(403);
    const viewerCutover = await viewerPage.request.post(`/api/workspaces/${fixture.workspaceId}/client-accounts/cutover`, {
      data: { clientId: fixture.clients.one.id },
    });
    expect(viewerCutover.status()).toBe(403);

    const rival = await browser.newContext();
    const rivalPage = await rival.newPage();
    await signIn(rivalPage, BOB);
    expect((await rivalPage.request.get(`/api/workspaces/${fixture.workspaceId}/client-accounts`)).status()).toBe(403);
    expect((await rivalPage.request.post(`/api/workspaces/${fixture.workspaceId}/client-accounts`, {
      data: {
        clientId: fixture.clients.one.id,
        provider: "google_ads",
        accountId: fixture.accounts.single,
        connectionId: fixture.connections.main.id,
      },
    })).status()).toBe(403);
    expect((await rivalPage.request.post(`/api/workspaces/${fixture.workspaceId}/client-accounts/cutover`, {
      data: { clientId: fixture.clients.one.id },
    })).status()).toBe(403);

    const ownerAfterDeniedMutations = await getAccounts(page, fixture.clients.one.id);
    expect(ownerAfterDeniedMutations.accounts).toEqual([
      expect.objectContaining({
        accountId: fixture.accounts.single,
        assignedClient: expect.objectContaining({ id: fixture.clients.one.id }),
      }),
    ]);
    await expectNoDocumentOverflow(page);
    await Promise.all([viewer.close(), rival.close()]);
  });
});
