import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { previewOverview } from "../../src/app/demo/ui/console/fixtures";

// Opt-in production browser verification; route fixtures still hold real readiness signals.
test.beforeEach(async ({ page }) => {
  if (process.env.LOADER_THROTTLE !== "1") return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375,
  });
});

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
    const samples: { lights: boolean[]; distance: number; sizeError: number; flight: boolean; sameAsset: boolean; visibleMarks: number; glowHidden: boolean; states: string[]; pending: boolean; label: string; status: string; phase: string; packet: string; providers: string[]; targetHidden: boolean; contentStarted: boolean }[] = [];
    (window as unknown as { startupSamples: typeof samples }).startupSamples = samples;
    function sample() {
      const loader = document.querySelector("[data-workspace-loader]");
      const tile = loader?.querySelector("svg[viewBox='0 0 32 32']");
      const target = document.querySelector("[data-workspace-mark] svg");
      if (tile && target) {
        const a = tile.getBoundingClientRect(), b = target.getBoundingClientRect();
        samples.push({ lights: [...loader!.querySelectorAll("[data-milestone]")].map(e => e.getAttribute("data-complete") === "true"), distance: Math.hypot(a.x+a.width/2-b.x-b.width/2, a.y+a.height/2-b.y-b.height/2), sizeError: Math.abs(a.width-b.width), flight: document.documentElement.dataset.monsteraTileFlight === "true", sameAsset: tile.innerHTML === target.innerHTML, visibleMarks: [tile,target].filter(mark => getComputedStyle(mark).visibility !== "hidden").length, glowHidden: getComputedStyle(loader!.querySelector("[data-loader-tile]")!, "::before").visibility === "hidden", states: [...loader!.querySelectorAll("[data-source-node]")].map(node => node.getAttribute("data-state")!), pending: loader!.getAttribute("data-pending") === "true", label: loader!.querySelector("[data-loader-step]")?.textContent ?? "", status: loader!.getAttribute("aria-label") ?? "", phase: loader!.getAttribute("data-phase") ?? "", packet: (() => { const packet = loader!.querySelector("[data-loop=true]"); return packet ? getComputedStyle(packet).transform : ""; })(), providers: [...loader!.querySelectorAll("[data-provider]")].map(node => node.getAttribute("data-provider")!), targetHidden: getComputedStyle(target).visibility === "hidden", contentStarted: document.querySelector("[data-workspace-content]")?.parentElement?.getAttribute("data-reveal") === "true" });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
  const samples = await page.evaluate(() => (window as unknown as { startupSamples: { lights: boolean[]; distance: number; sizeError: number; flight: boolean; sameAsset: boolean; visibleMarks: number; glowHidden: boolean; states: string[]; pending: boolean; label: string; status: string; phase: string; packet: string; providers: string[]; targetHidden: boolean; contentStarted: boolean }[] }).startupSamples);
  expect(samples.some(s => s.lights.every(Boolean))).toBeTruthy();
  for (let i = 1; i < samples.length; i++) samples[i-1].lights.forEach((done, index) => { if (done) expect(samples[i].lights[index]).toBeTruthy(); });
  for (const sample of samples) {
    expect(sample.sameAsset).toBeTruthy();
    expect(sample.states.map(state => state === "done")).toEqual(sample.lights);
    if (sample.pending) expect(sample.lights[3]).toBeFalsy();
    expect(sample.label).toContain(sample.status);
    const active = sample.lights.findIndex(done => !done);
    if (active >= 0) expect(sample.states[active]).toBe("active");
  }
  const work = samples.filter(s => s.phase === "enter" && s.packet);
  if (mode !== "reduced") expect(new Set(work.map(s => s.packet)).size).toBeGreaterThan(10);
  expect(samples.some(s => s.providers.length === overview.sourcesList.length)).toBeTruthy();
  const resolve = samples.filter(s => s.phase === "resolve");
  if (mode !== "reduced") expect(resolve.length).toBeGreaterThan(3);
  else expect(resolve).toHaveLength(0);
  expect(resolve.every(s => s.lights.every(Boolean))).toBeTruthy();
  const flight = samples.filter(s => s.flight);
  expect(flight.filter(s => !s.targetHidden || s.visibleMarks !== 1 || !s.glowHidden)).toEqual([]);
  expect(flight.slice(0, 1).every(s => !s.contentStarted)).toBeTruthy();
  expect(flight.length === 0 || flight.some(s => s.contentStarted)).toBeTruthy();
  if (page.viewportSize()!.width >= 1024 && mode === "expanded") { expect(flight.length).toBeGreaterThan(3); expect(flight[flight.length-1].distance).toBeLessThan(.5); expect(flight[flight.length-1].sizeError).toBeLessThan(.25); }
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

test("progress follows held API responses and keeps the last node active until dashboard readiness", async ({ page, context, baseURL }) => {
  const overview = previewOverview("New workspace");
  const token = await encode({ secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters", token: { sub: "startup-fixture", email: "startup@example.test" } });
  await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
  const held = new Map<string, import("@playwright/test").Route>();
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (["/api/auth/session", "/api/workspaces", "/api/dashboard/summary"].includes(path)) held.set(path, route);
    else await route.fulfill({ json: {} });
  });
  const signal = (index: number) => page.locator(`[data-source-node][data-signal="${index}"]`);
  await page.goto("/console", { waitUntil: "domcontentloaded" });
  await expect(signal(1)).toHaveAttribute("data-state", "active");
  await expect(signal(2)).toHaveAttribute("data-state", "pending");
  await expect.poll(() => held.has("/api/auth/session")).toBeTruthy();
  await held.get("/api/auth/session")!.fulfill({ json: { user: { id: "startup-fixture", email: "startup@example.test" }, expires: "2099-01-01T00:00:00Z" } });
  await expect(signal(1)).toHaveAttribute("data-state", "done");
  await expect(signal(2)).toHaveAttribute("data-state", "active");
  await expect(signal(3)).toHaveAttribute("data-state", "pending");
  await expect.poll(() => held.has("/api/workspaces")).toBeTruthy();
  await held.get("/api/workspaces")!.fulfill({ json: [{ ...overview.workspace, role: "OWNER", sources: overview.sourcesList.slice(0,2).map(source => ({ provider: source.provider })) }] });
  await expect(signal(2)).toHaveAttribute("data-state", "done");
  await expect(signal(3)).toHaveAttribute("data-state", "done");
  await expect(signal(4)).toHaveAttribute("data-state", "active");
  await expect(page.locator("[data-loader-step]")).toHaveText(/^STEP 4 \/ 4(Preparing dashboard|Still working\.\.\.)$/);
  await expect(page.getByRole("status", { name: /^(Preparing dashboard|Still working\.\.\.)$/ })).toBeVisible();
  await expect(page.getByText("Workspace ready", { exact: true })).toHaveCount(0);
  await expect.poll(() => held.has("/api/dashboard/summary")).toBeTruthy();
  await held.get("/api/dashboard/summary")!.fulfill({ json: overview });
  await expect(page.locator("[data-workspace-loader]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});
