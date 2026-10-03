import { expect, test } from "@playwright/test";

const root = "/demo/ui/console-structure";
const sections = ["console", "operations", "sources", "sources?tab=accounts", "sources?tab=available", "sources?tab=attention", "reports?view=performance", "reports?view=readiness", "reports?view=sync", "explorer", "exports", "clients", "settings?tab=workspace", "settings?tab=clients", "settings?tab=team", "settings?tab=alerts", "settings?tab=billing", "settings?tab=api", "settings?tab=sessions"];

for (const theme of ["light", "dark"]) {
  test(`console sections retain ${theme} theme and fit the viewport`, async ({ page }) => {
    test.setTimeout(120000);
    await page.addInitScript(value => localStorage.setItem("monstera-theme", value), theme);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const section of sections) {
      await page.goto(`${root}/${section}`);
      await expect(page.getByText("Production console preview", { exact: true })).toBeVisible();
      await expect(page.locator("[data-console-theme]").first()).toHaveAttribute("data-console-theme", theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "Page guide", exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

test("mobile navigation contains focus, closes with Escape, and restores the opener", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024, "Mobile drawer only");
  await page.goto(`${root}/console`);
  const sidebar = page.locator("#application-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  const opener = page.getByRole("button", { name: "Open menu", exact: true });
  await opener.click();
  const close = page.getByRole("button", { name: "Close menu", exact: true });
  await expect(close).toBeFocused();
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
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "Client accounts", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("reviewed onboarding result survives reload without granting monitoring consent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${root}/console?onboardingRunId=sample-reviewed-run`);
  const result = page.getByRole("region", { name: "Review advertising spend", exact: true });
  await expect(result).toContainText("2026-09-25 — 2026-10-01");
  await expect(result).toContainText("account timezone not verified");
  await result.getByRole("button", { name: "Review ongoing checks" }).click();
  await expect(result.getByRole("alert")).toContainText("read-only");
  await page.reload();
  await expect(result).toContainText("USD 21,500");
  await page.getByRole("combobox", { name: "Preview state" }).selectOption("Monitoring draft");
  const setup = page.getByRole("region", { name: "Keep my connected data healthy" });
  await expect(setup).toContainText("Setup goal: Review advertising spend");
  await expect(setup.getByRole("checkbox", { name: /^I approve daily checks/ })).not.toBeChecked();
  await expect(setup.getByRole("button", { name: "Approve and start daily checks" })).toBeDisabled();
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element && !!animation.effect.target.closest("main")).length)).toBe(0);
});
