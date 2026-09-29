import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { previewOverview } from "../../src/app/demo/ui/console/fixtures";

test("loader milestones stay monotonic and fly only to an onscreen workspace mark", async ({ page, context, baseURL }) => {
  const overview = previewOverview("New workspace");
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters", token: { sub: "startup-fixture", email: "startup@example.test", name: "Startup fixture" } });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/session") data = { user: { id: "startup-fixture", email: "startup@example.test", name: "Startup fixture" }, expires: "2099-01-01T00:00:00Z" };
    else if (path === "/api/workspaces") data = [{ ...overview.workspace, role: "OWNER" }];
    else if (path === "/api/dashboard/summary") { await new Promise(resolve => setTimeout(resolve, 1200)); data = overview; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.addInitScript(() => {
    const samples: { lights: boolean[]; distance: number; flight: boolean }[] = [];
    (window as unknown as { startupSamples: typeof samples }).startupSamples = samples;
    function sample() {
      const loader = document.querySelector("[data-workspace-loader]");
      const tile = loader?.querySelector("svg[viewBox='0 0 32 32']");
      const target = document.querySelector("[data-workspace-mark] svg");
      if (tile && target) {
        const a = tile.getBoundingClientRect(), b = target.getBoundingClientRect();
        samples.push({ lights: [...loader!.querySelectorAll("[data-milestone]")].map(e => e.getAttribute("data-complete") === "true"), distance: Math.hypot(a.x+a.width/2-b.x-b.width/2, a.y+a.height/2-b.y-b.height/2), flight: document.documentElement.dataset.monsteraTileFlight === "true" });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
  const samples = await page.evaluate(() => (window as unknown as { startupSamples: { lights: boolean[]; distance: number; flight: boolean }[] }).startupSamples);
  expect(samples.some(s => s.lights.every(Boolean))).toBeTruthy();
  for (let i = 1; i < samples.length; i++) samples[i-1].lights.forEach((done, index) => { if (done) expect(samples[i].lights[index]).toBeTruthy(); });
  const flight = samples.filter(s => s.flight);
  if (page.viewportSize()!.width >= 1024) { expect(flight.length).toBeGreaterThan(3); expect(flight[flight.length-1].distance).toBeLessThan(35); }
  else expect(flight).toHaveLength(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-monstera-tile-flight", "true");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});
