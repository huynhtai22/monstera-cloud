import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!", redirect: "false", json: "true" },
  });
  expect(response.ok()).toBeTruthy();
  const workspaces = await (await page.request.get("/api/workspaces")).json() as Array<{ id: string; slug: string }>;
  return workspaces.find((workspace) => workspace.slug === "alpha-agency")!.id;
}

test.describe("client account assignment journeys", () => {
  test("clients deep-link Manage sources and account APIs preserve authorization boundaries", async ({ page }) => {
    const workspaceId = await login(page);
    const clients = await (await page.request.get(`/api/clients?workspaceId=${workspaceId}`)).json() as Array<{ id: string; name: string }>;
    expect(clients.length).toBeGreaterThanOrEqual(1);
    await page.goto("/clients");
    const manage = page.getByRole("link", { name: "Manage sources" }).first();
    await expect(manage).toBeVisible();
    await expect(manage).toHaveAttribute("href", new RegExp("/sources\\?clientId=.*tab=accounts"));
    await manage.click();
    await expect(page).toHaveURL(/\/sources\?clientId=.*tab=accounts/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();

    const accounts = await page.request.get(`/api/workspaces/${workspaceId}/client-accounts`);
    expect(accounts.ok()).toBeTruthy();
    const forbidden = await page.request.post(`/api/workspaces/${workspaceId}/client-accounts`, { data: { clientId: clients[0].id, provider: "google_ads", accountId: "not-discovered", connectionId: "missing" } });
    expect([400, 403, 404]).toContain(forbidden.status());
  });

  test("rival workspace cannot read or mutate assignment surfaces", async ({ browser }) => {
    const context = await browser.newContext(); const page = await context.newPage();
    const workspaceId = await login(page);
    const rival = await browser.newContext(); const rivalPage = await rival.newPage();
    const csrf = await (await rivalPage.request.get("/api/auth/csrf")).json();
    await rivalPage.request.post("/api/auth/callback/credentials", { form: { csrfToken: csrf.csrfToken, email: "bob@beta-media.test", password: "Pilot_Beta_2026!", redirect: "false", json: "true" } });
    expect((await rivalPage.request.get(`/api/workspaces/${workspaceId}/client-accounts`)).status()).toBe(403);
    expect((await rivalPage.request.post(`/api/workspaces/${workspaceId}/client-accounts/cutover`, { data: {} })).status()).toBe(403);
    await context.close(); await rival.close();
  });
});
