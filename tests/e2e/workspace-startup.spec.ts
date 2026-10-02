import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { previewOverview } from "../../src/app/demo/ui/console/fixtures";

test("workspace handoff keeps headings and activation text unique", async ({ page, context, baseURL }) => {
  const overview = previewOverview("New workspace");
  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters",
    token: { sub: "startup-fixture", email: "startup@example.test", name: "Startup fixture" },
  });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/session") {
      data = { user: { id: "startup-fixture", email: "startup@example.test", name: "Startup fixture" }, expires: "2099-01-01T00:00:00Z" };
    } else if (path === "/api/workspaces") {
      data = [{ ...overview.workspace, role: "OWNER" }];
    } else if (path === "/api/dashboard/summary") {
      // Keep the handoff active long enough to inspect the outgoing placeholders.
      await new Promise(resolve => setTimeout(resolve, 250));
      data = overview;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  const placeholders = page.locator('[data-ready="true"] > [aria-hidden="true"][inert]');
  await expect(placeholders.locator("svg")).toBeAttached();
  await expect(placeholders.locator("rect").first()).toBeAttached();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByText("Pilot activation", { exact: true })).toHaveCount(1);
  await expect(placeholders.locator("h1,h2,h3,a,button,[role]")).toHaveCount(0);
  await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
  await expect(placeholders).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

for (const status of ["draft", "active"] as const) {
  test(`monitoring setup visibility follows responsibility status: ${status}`, async ({ page, context, baseURL }) => {
    const overview = previewOverview("New workspace");
    const token = await encode({ secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters", token: { sub: "startup-fixture", email: "startup@example.test" } });
    await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = {};
      if (path === "/api/auth/session") data = { user: { id: "startup-fixture", email: "startup@example.test" }, expires: "2099-01-01T00:00:00Z" };
      else if (path === "/api/workspaces") data = [{ ...overview.workspace, role: "OWNER" }];
      else if (path === "/api/dashboard/summary") data = overview;
      else if (path === "/api/agent-console/summary") data = { workspaceId: overview.workspace.id, schedulerStatus: status === "active" ? "active" : "no_responsibility", monitoringAvailable: true, supportedCadenceLabel: "Daily", nextScheduledCheck: null, lastSuccessfulCheck: null, dataThroughCoverage: null, activeBlockers: [], responsibilities: [{ id: "setup-fixture", kind: "data_health", status, version: 0, cadence: "daily", scopeCount: 1, nextDueAt: null, lastSuccessfulAt: null }] };
      await route.fulfill({ json: data });
    });
    await page.goto("/console");
    await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
    const setup = page.getByRole("heading", { name: "Keep my connected data healthy", exact: true });
    if (status === "draft") await expect(setup).toBeVisible();
    else { await expect(page.getByRole("button", { name: "Pause monitoring", exact: true })).toBeVisible(); await expect(setup).toHaveCount(0); }
  });
}
