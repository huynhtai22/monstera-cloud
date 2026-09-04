import { expect, test, type Browser, type Page } from "@playwright/test";

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
      callbackUrl: "/console",
    },
  });
  expect(loginRes.ok()).toBeTruthy();
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

test.describe("two-tenant isolation", () => {
  test.describe.configure({ mode: "serial" });

  test("rehearsal matrix: explorer, metrics 403, sync fence, viewer, API keys", async ({ browser }) => {
    test.setTimeout(180_000);
    const alice = await authedBrowser(browser, "alice@alpha-agency.test", "Pilot_Alpha_2026!");
    const bob = await authedBrowser(browser, "bob@beta-media.test", "Pilot_Beta_2026!");
    const charlie = await authedBrowser(browser, "charlie@alpha-agency.test", "Pilot_Alpha_2026!");

    const aliceWorkspaces = await alice.page.request.get("/api/workspaces");
    expect(aliceWorkspaces.ok()).toBeTruthy();
    const aliceList = (await aliceWorkspaces.json()) as Array<{ id: string; slug: string }>;
    const alpha = aliceList.find((workspace) => workspace.slug === "alpha-agency");
    expect(alpha?.id).toBeTruthy();

    const bobWorkspaces = await bob.page.request.get("/api/workspaces");
    expect(bobWorkspaces.ok()).toBeTruthy();
    const bobList = (await bobWorkspaces.json()) as Array<{ id: string; slug: string }>;
    const beta = bobList.find((workspace) => workspace.slug === "beta-media");
    expect(beta?.id).toBeTruthy();
    expect(bobList.some((workspace) => workspace.slug === "alpha-agency")).toBeFalsy();

    // New money and analyst surfaces must reject a real authenticated rival,
    // not merely contain a workspaceId in their query implementation.
    const bobBilling = await bob.page.request.get(`/api/workspaces/${alpha!.id}/billing`);
    expect(bobBilling.status()).toBe(403);
    const bobClients = await bob.page.request.get(`/api/clients?workspaceId=${alpha!.id}`);
    expect(bobClients.status()).toBe(403);
    const bobHistory = await bob.page.request.get(`/api/ai/analyst/turns?workspaceId=${alpha!.id}`);
    expect(bobHistory.status()).toBe(403);
    const bobTurn = await bob.page.request.post('/api/ai/analyst/turns', {
      data: { workspaceId: alpha!.id, question: 'Show spend', acknowledgeBestEffort: true },
    });
    expect(bobTurn.status()).toBe(403);
    const viewerTurn = await charlie.page.request.post('/api/ai/analyst/turns', {
      data: { workspaceId: alpha!.id, question: 'Show spend' },
    });
    expect(viewerTurn.status()).toBe(403);
    const manualPayment = await alice.page.request.post('/api/payments/vietqr/manual-confirm', {
      data: { orderCode: 1, workspaceId: alpha!.id },
    });
    expect([403, 410]).toContain(manualPayment.status());

    const bobOnAliceMetrics = await bob.page.request.get(
      `/api/metrics/query?workspaceId=${encodeURIComponent(alpha!.id)}&startDate=2026-08-01&endDate=2026-08-19`,
    );
    expect(bobOnAliceMetrics.status()).toBe(403);

    const aliceMetrics = await alice.page.request.get(
      `/api/metrics/query?workspaceId=${encodeURIComponent(alpha!.id)}&startDate=2026-08-01&endDate=2026-08-19`,
    );
    expect(aliceMetrics.ok()).toBeTruthy();
    const aliceRows = JSON.stringify(await aliceMetrics.json());
    expect(aliceRows).toContain("Alpha Summer Campaign");
    expect(aliceRows).toContain("Alpha Retargeting");
    expect(aliceRows).not.toContain("Beta Search LeadGen");

    const bobMetrics = await bob.page.request.get(
      `/api/metrics/query?workspaceId=${encodeURIComponent(beta!.id)}&startDate=2026-08-01&endDate=2026-08-19`,
    );
    expect(bobMetrics.ok()).toBeTruthy();
    const bobRows = JSON.stringify(await bobMetrics.json());
    expect(bobRows).toContain("Beta Search LeadGen");
    expect(bobRows).not.toContain("Alpha Summer Campaign");

    const aliceConnectionsRes = await alice.page.request.get(
      `/api/workspaces/${encodeURIComponent(alpha!.id)}/connections?type=source`,
    );
    expect(aliceConnectionsRes.ok()).toBeTruthy();
    const aliceConnections = (await aliceConnectionsRes.json()) as Array<{ id: string; name: string }>;
    const alphaMeta = aliceConnections.find((connection) => connection.name === "Alpha Meta Ads Main");
    expect(alphaMeta?.id).toBeTruthy();

    const bobSeesAliceConnections = await bob.page.request.get(
      `/api/workspaces/${encodeURIComponent(alpha!.id)}/connections?type=source`,
    );
    expect(bobSeesAliceConnections.status()).toBe(403);

    const bobSyncsAlice = await bob.page.request.post(`/api/connections/${alphaMeta!.id}/sync`);
    expect([403, 404]).toContain(bobSyncsAlice.status());

    const amazonConnect = await bob.page.request.get(
      `/api/auth/connect?provider=amazon&workspaceId=${encodeURIComponent(beta!.id)}`,
    );
    expect([403, 404]).toContain(amazonConnect.status());

    const charlieCreatesDashboard = await charlie.page.request.post("/api/dashboard-templates", {
      data: { workspaceId: alpha!.id, templateSlug: "agency-overview" },
    });
    expect(charlieCreatesDashboard.status()).toBe(403);

    const charlieCreatesKey = await charlie.page.request.post("/api/settings/api-keys", {
      data: { workspaceId: alpha!.id, name: "viewer-should-fail" },
    });
    expect(charlieCreatesKey.status()).toBe(403);

    const aliceKeyRes = await alice.page.request.post("/api/settings/api-keys", {
      data: { workspaceId: alpha!.id, name: "alpha-key-1" },
    });
    expect(aliceKeyRes.ok()).toBeTruthy();
    const aliceKey = (await aliceKeyRes.json()) as { id: string; secret?: string; key?: string };
    expect(aliceKey.id).toBeTruthy();

    const bobListsAliceKeys = await bob.page.request.get(
      `/api/settings/api-keys?workspaceId=${encodeURIComponent(alpha!.id)}`,
    );
    expect(bobListsAliceKeys.status()).toBe(403);

    const bobRevokesAliceKey = await bob.page.request.delete(
      `/api/settings/api-keys?id=${encodeURIComponent(aliceKey.id)}&workspaceId=${encodeURIComponent(beta!.id)}`,
    );
    expect([403, 404]).toContain(bobRevokesAliceKey.status());

    await alice.context.close();
    await bob.context.close();
    await charlie.context.close();
  });
});
