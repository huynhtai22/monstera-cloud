import { expect, test as base } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { productionOverview, sampleApiPayload, sampleSession, SAMPLE_WORKSPACE_ID } from "../../src/app/demo/ui/console-structure/preview-data";
import type { PreviewState } from "../../src/app/demo/ui/console/fixtures";

// Exercise the production routes; demo routes remain unavailable in production.
const test = base.extend<{ fixtureState: (state: PreviewState) => void }>({
  fixtureState: [async ({ page, context, baseURL }, use) => {
    let state: PreviewState = "Overview";
    const token = await encode({ secret: process.env.NEXTAUTH_SECRET ?? "e2e-nextauth-secret-at-least-32-characters", token: { sub: sampleSession.user.id, email: sampleSession.user.email, name: sampleSession.user.name } });
    await context.addCookies([{ name: "next-auth.session-token", value: token, url: baseURL! }]);
    await page.addInitScript(({ workspaceId, userId }) => {
      localStorage.setItem("monstera-workspace-storage", JSON.stringify({ state: { activeWorkspaceId: workspaceId }, version: 0 }));
      sessionStorage.setItem("monstera-last-auth-user-id", userId);
    }, { workspaceId: SAMPLE_WORKSPACE_ID, userId: sampleSession.user.id });
    await page.route("**/api/**", async route => {
      const request = route.request();
      if (request.method() !== "GET") {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "read-only release fixture; no operation was sent" }) });
        return;
      }
      const url = new URL(request.url());
      const payload = url.pathname === "/api/dashboard/summary" ? productionOverview(state) : sampleApiPayload(url, state);
      await route.fulfill({ status: payload === null ? 503 : 200, contentType: "application/json", body: JSON.stringify(payload ?? { error: "No release fixture" }) });
    });
    await use(value => { state = value; });
  }, { auto: true }],
});

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) console.log("Release fixture failure", page.url(), await page.locator("body").innerText());
});

const root = "";
const sections = ["console", "operations", "sources", "sources?tab=accounts", "sources?tab=available", "sources?tab=attention", "reports?view=performance", "reports?view=readiness", "reports?view=sync", "explorer", "exports", "clients", "settings?tab=overview", "settings?tab=appearance", "settings?tab=workspace", "settings?tab=clients", "settings?tab=team", "settings?tab=alerts", "settings?tab=billing", "settings?tab=api", "settings?tab=sessions"];

for (const theme of ["light", "dark"]) {
  test(`console sections retain ${theme} theme and fit the viewport`, async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(value => localStorage.setItem("monstera-theme", value), theme);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(`${page.url()}: ${error.message}`));
    for (const section of sections) {
      await page.goto(`${root}/${section}`);
      await expect(page.locator("[data-console-theme]").first()).toHaveAttribute("data-console-theme", theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "Page guide", exact: true })).toBeVisible();
      await expect(page.locator("main h1").first(), section).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("mobile navigation contains focus, closes with Escape, and restores the opener", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024, "Mobile drawer only");
  await page.addInitScript(() => localStorage.setItem("monstera-sidebar-collapsed", "1"));
  await page.goto(`${root}/console`);
  const sidebar = page.locator("#application-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  const opener = page.getByRole("button", { name: "Open menu", exact: true });
  await opener.click();
  const close = page.getByRole("button", { name: "Close menu", exact: true });
  await expect(close).toBeFocused();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await close.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#application-sidebar"))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await close.press("Escape");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(opener).toBeFocused();
});

test("Sources tabs support arrows, Home and End and preserve selection on reload", async ({ page }) => {
  await page.goto(`${root}/sources`);
  const tabs = page.getByRole("tablist", { name: "Filter integrations" });
  await tabs.getByRole("tab", { name: /^Your sources/ }).press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Client accounts", exact: true })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: "Client accounts", exact: true }).press("End");
  await expect(tabs.getByRole("tab", { name: /^Needs attention/ })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: /^Needs attention/ }).press("Home");
  await expect(tabs.getByRole("tab", { name: /^Your sources/ })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: /^Your sources/ }).press("ArrowRight");
  await expect(page).toHaveURL(/tab=accounts/);
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "Client accounts", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("reviewed onboarding result survives reload without granting monitoring consent", async ({ page, fixtureState }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${root}/console?onboardingRunId=sample-reviewed-run`);
  const result = page.getByRole("region", { name: "Review advertising spend", exact: true });
  await expect(result).toContainText("2026-09-25 — 2026-10-01");
  await expect(result).toContainText("account timezone not verified");
  await result.getByRole("button", { name: "Review ongoing checks" }).click();
  await expect(result.getByRole("alert")).toContainText("read-only");
  await page.reload();
  await expect(result).toContainText("USD 21,500");
  fixtureState("Monitoring draft");
  await page.reload();
  const setup = page.getByRole("region", { name: "Keep my connected data healthy" });
  await expect(setup).toContainText("Setup goal: Review advertising spend");
  await expect(setup.getByRole("checkbox", { name: /^I approve daily checks/ })).not.toBeChecked();
  await expect(setup.getByRole("button", { name: "Approve and start daily checks" })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && !!animation.effect.target.closest("main")).length)).toBe(0);
});


test("light connector cards and consent portal use readable light surfaces", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("monstera-theme", "light"));
  await page.goto("/sources?tab=available");
  const cards = page.locator(".glass-card");
  await expect(cards.first()).toBeVisible();
  const colors = await cards.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
  expect(colors.every(color => color === "rgb(255, 255, 255)")).toBe(true);
  await page.getByRole("button", { name: /^Add (data )?source$/ }).click();
  await page.getByRole("option", { name: /^Meta Ads Facebook/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Meta Ads to Monstera Cloud", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color })))
    .toEqual({ background: "rgb(255, 255, 255)", color: "rgb(32, 33, 36)" });
  await expect(dialog.getByRole("button", { name: "Continue to Meta Ads", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
});


test("light saved-view notification uses the same light surface as the console", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("monstera-theme", "light"));
  await page.goto("/sources");
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("Name this view").fill("Light theme review");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("View saved on this browser", { exact: true })).toBeVisible();
  const notification = page.locator("[data-sonner-toast]").first();
  await expect(notification).toBeVisible();
  expect(await notification.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await notification.locator("[data-title]").evaluate(element => getComputedStyle(element).color)).toBe("rgb(32, 33, 36)");
});


test("light account status does not retain a dark emerald plate", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("monstera-theme", "light"));
  await page.goto("/sources?tab=accounts");
  const connected = page.getByRole("table").getByText("connected", { exact: true }).first();
  await expect(connected).toBeVisible();
  expect(await connected.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color })))
    .toEqual({ background: "rgb(237, 247, 239)", color: "rgb(40, 107, 64)" });
});


test("theme switching preserves account scope and restores the last preference", async ({ page }) => {
  await page.goto("/sources?tab=accounts");
  await expect(page.getByRole("table")).toBeVisible();
  const originalUrl = page.url();
  for (const theme of ["light", "dark", "light"] as const) {
    await page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true }).filter({ visible: true }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-console-theme", theme);
    await expect(page.locator("[data-workspace-shell]")).toHaveAttribute("data-console-theme", theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-console-theme-motion"))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
    await expect(page.getByRole("table")).toBeVisible();
    expect(page.url()).toBe(originalUrl);
  }
  await page.reload();
  await expect(page.locator("[data-workspace-shell]")).toHaveAttribute("data-console-theme", "light");
  await expect(page.getByRole("table")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).filter({ visible: true }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-console-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-console-theme-motion"))).toBe(false);
});


test("Settings search opens the right controls and preserves category across reload and history", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Make room for the work.", exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search settings", exact: true });
  await search.fill("Sheets");
  await expect(page.getByRole("region", { name: "Settings search results" })).toContainText("API & access keys");
  await search.press("Enter");
  await expect(page).toHaveURL(/tab=api/);
  await expect(page.getByRole("region", { name: "API & access keys", exact: true })).toContainText("Active keys");
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "API & access keys", exact: true })).toHaveAttribute("aria-pressed", "true");
  await search.fill("no-such-setting");
  await expect(page.getByRole("heading", { name: "No matching settings" })).toBeVisible();
  await search.press("Escape");
  await expect(page.getByRole("region", { name: "API & access keys", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: "People & roles", exact: true }).click();
  await expect(page).toHaveURL(/tab=team/);
  await page.goBack();
  await expect(page).toHaveURL(/tab=api/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Settings Appearance uses the shell theme transition and persists the selected theme", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/settings?tab=appearance");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-console-theme", "light");
  await expect(page.getByRole("button", { name: "Light theme", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-console-theme", "light");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-console-theme", "dark");
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && !!animation.effect.target.closest("[data-console-section=settings]")).length)).toBe(0);
});
