import { expect, test } from "@playwright/test";

test("private invitation page exposes the acceptance shell", async ({ page }) => {
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByRole("heading", { name: "Agency invitation" })).toBeVisible();
});

test("protected console redirects to login", async ({ page }) => {
  await page.goto("/console");
  await expect(page).toHaveURL(/\/login/);
});

test("version endpoint exposes an uncached release identity", async ({ request }) => {
  const response = await request.get("/api/version");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toContain("no-store");
  await expect(response.json()).resolves.toMatchObject({
    schemaVersion: "20260818000000_harden_idempotency_and_schema_checks",
  });
});

test("cron and disabled production integrations fail closed", async ({ request }) => {
  const cron = await request.get("/api/cron/master");
  expect([401, 503]).toContain(cron.status());

  const healthTick = await request.get("/api/cron/health-tick");
  expect([401, 503]).toContain(healthTick.status());

  const runs = await request.get("/api/runs?workspaceId=ws_x");
  expect(runs.status()).toBe(401);

  const stripe = await request.post("/api/stripe/webhook", { data: {} });
  expect(stripe.status()).toBe(404);

  const lookerJobs = await request.post("/api/looker-studio/jobs", { data: {} });
  expect(lookerJobs.status()).toBe(503);
});
