import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { previewOverview } from "../../src/app/demo/ui/console/fixtures";

for (const mode of ["expanded", "collapsed", "reduced"] as const) {
test(`loader uses real milestones and a safe ${mode} handoff`, async ({ page, context, baseURL }) => {
  if (mode === "collapsed") await page.addInitScript(() => localStorage.setItem("monstera-sidebar-collapsed", "1"));
  if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
  const overview = previewOverview("New workspace");
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters", token: { sub: "startup-fixture", email: "startup@example.test", name: "Startup fixture" } });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/session") data = { user: { id: "startup-fixture", email: "startup@example.test", name: "Startup fixture" }, expires: "2099-01-01T00:00:00Z" };
    else if (path === "/api/workspaces") data = [{ ...overview.workspace, role: "OWNER", sources: overview.sourcesList.map(source => ({ provider: source.provider })) }];
    else if (path === "/api/dashboard/summary") { await new Promise(resolve => setTimeout(resolve, 1200)); data = overview; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.addInitScript(() => {
    const samples: { lights: boolean[]; distance: number; flight: boolean; phase: string; packet: string; providers: string[]; targetHidden: boolean; contentStarted: boolean }[] = [];
    (window as unknown as { startupSamples: typeof samples }).startupSamples = samples;
    function sample() {
      const loader = document.querySelector("[data-workspace-loader]");
      const tile = loader?.querySelector("svg[viewBox='0 0 32 32']");
      const target = document.querySelector("[data-workspace-mark] svg");
      if (tile && target) {
        const a = tile.getBoundingClientRect(), b = target.getBoundingClientRect();
        samples.push({ lights: [...loader!.querySelectorAll("[data-milestone]")].map(e => e.getAttribute("data-complete") === "true"), distance: Math.hypot(a.x+a.width/2-b.x-b.width/2, a.y+a.height/2-b.y-b.height/2), flight: document.documentElement.dataset.monsteraTileFlight === "true", phase: loader!.getAttribute("data-phase") ?? "", packet: (() => { const packet = loader!.querySelector("[data-loop=true]"); return packet ? getComputedStyle(packet).transform : ""; })(), providers: [...loader!.querySelectorAll("[data-provider]")].map(node => node.getAttribute("data-provider")!), targetHidden: getComputedStyle(target).visibility === "hidden", contentStarted: document.querySelector("[data-workspace-content]")?.parentElement?.getAttribute("data-reveal") === "true" });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
  const samples = await page.evaluate(() => (window as unknown as { startupSamples: { lights: boolean[]; distance: number; flight: boolean; phase: string; packet: string; providers: string[]; targetHidden: boolean; contentStarted: boolean }[] }).startupSamples);
  expect(samples.some(s => s.lights.every(Boolean))).toBeTruthy();
  for (let i = 1; i < samples.length; i++) samples[i-1].lights.forEach((done, index) => { if (done) expect(samples[i].lights[index]).toBeTruthy(); });
  const work = samples.filter(s => s.phase === "enter" && s.packet);
  if (mode !== "reduced") expect(new Set(work.map(s => s.packet)).size).toBeGreaterThan(10);
  expect(samples.some(s => s.providers.length === overview.sourcesList.length)).toBeTruthy();
  const resolve = samples.filter(s => s.phase === "resolve");
  if (mode !== "reduced") expect(resolve.length).toBeGreaterThan(10);
  else expect(resolve).toHaveLength(0);
  expect(resolve.every(s => s.lights.every(Boolean))).toBeTruthy();
  const flight = samples.filter(s => s.flight);
  expect(flight.every(s => s.targetHidden)).toBeTruthy();
  expect(flight.slice(0, 3).every(s => !s.contentStarted)).toBeTruthy();
  expect(flight.length === 0 || flight.some(s => s.contentStarted)).toBeTruthy();
  if (page.viewportSize()!.width >= 1024 && mode === "expanded") { expect(flight.length).toBeGreaterThan(3); expect(flight[flight.length-1].distance).toBeLessThan(1.5); }
  else expect(flight).toHaveLength(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-monstera-tile-flight", "true");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});
}

test("a slow startup exposes a usable skeleton and retries without inventing completion", async ({ page, context, baseURL }) => {
  test.setTimeout(25000);
  const overview = previewOverview("New workspace");
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters", token: { sub: "startup-fixture", email: "startup@example.test" } });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
  let requests = 0;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/session") data = { user: { id: "startup-fixture", email: "startup@example.test" }, expires: "2099-01-01T00:00:00Z" };
    if (path === "/api/workspaces") data = [{ ...overview.workspace, role: "OWNER", sources: overview.sourcesList.map(source => ({ provider: source.provider })) }];
    if (path === "/api/dashboard/summary") {
      requests++;
      if (requests === 1) return; // A genuinely pending request, rather than fabricated progress.
      data = overview;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "Still working..." })).toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-milestone="4"]')).toHaveAttribute("data-complete", "false");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible({ timeout: 8000 });
  await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
  if (page.viewportSize()!.width >= 1024) await expect(page.locator('aside[aria-label="Application sidebar"]')).toBeInViewport();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  expect(requests).toBeGreaterThan(1);
});
