// Local-only, synthetic-data verification. No login, database seed or real payment.
// Run with a dev server: node scripts/check-billing-ui.mjs
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = "http://localhost:3000";
const browser = await chromium.launch();
const issues = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const attempts = [];
    page.on("pageerror", error => issues.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin && !["data:", "blob:"].includes(url.protocol)) return route.abort();
      if (url.pathname === "/api/payments/vietqr/create") {
        attempts.push(route.request().postDataJSON());
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic test: no payment order created." }) });
      }
      return route.continue();
    });
    await page.goto(`${origin}/demo/ui/billing`);
    await page.getByRole("button", { name: "Manage plan", exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/monstera-billing-overview-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Manage plan", exact: true }).click();
    const modal = page.locator("dialog");
    assert.equal(await modal.getByRole("button", { name: "Monthly", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await modal.innerText(), /1\.490\.000/);
    assert.doesNotMatch(await modal.innerText(), /Choose Studio|Save 20%|Most popular/);
    await page.screenshot({ path: `/tmp/monstera-billing-plans-${width}.png` });
    const overflow = await modal.evaluate(element => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, false, `Modal overflow at ${width}`);
    await modal.getByRole("button", { name: "Annual", exact: true }).click();
    await modal.getByRole("button", { name: "Extend Agency Pro" }).click();
    assert.match(await modal.innerText(), /14\.900\.000/);
    assert.match(await modal.innerText(), /365 days/);
    assert.equal(attempts.length, 0, "Review must not create an order");
    await page.screenshot({ path: `/tmp/monstera-billing-review-${width}.png` });
    await page.keyboard.press("Escape");
    assert.equal(await modal.count(), 0);
    assert.equal(await page.getByRole("button", { name: "Manage plan", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole("button", { name: "Manage plan", exact: true }).click();
    assert.equal(await modal.getByRole("button", { name: "Monthly", exact: true }).getAttribute("aria-pressed"), "true");
    await modal.getByLabel("Billing currency").selectOption("USD");
    assert.match(await modal.innerText(), /\$79/);
    assert.equal(await modal.getByRole("button", { name: "Contact sales for USD" }).count(), 1);
    assert.equal(attempts.length, 0);
    await modal.getByLabel("Billing currency").selectOption("VND");
    await modal.getByRole("button", { name: "Extend Agency Pro" }).click();
    await modal.getByRole("button", { name: "Continue to secure payment" }).click();
    await page.getByText("Synthetic test: no payment order created.").waitFor();
    assert.deepEqual(attempts.at(-1), { plan: "professional", billingCycle: "monthly", workspaceId: "billing-preview" });

    for (const scenario of ["paid", "free", "legacy", "viewer"]) {
      await page.goto(`${origin}/demo/ui/billing`);
      await page.getByLabel("Scenario").selectOption(scenario);
      const button = page.getByRole("button", { name: "Manage plan", exact: true });
      if (scenario === "viewer") { assert.equal(await button.isDisabled(), true); continue; }
      if (scenario === "paid") assert.match(await page.locator("main").innerText(), /moves to Free/);
      await button.click();
      if (scenario === "legacy") assert.equal(await modal.getByRole("button", { name: "Discuss a plan change" }).count(), 1);
      if (scenario === "free") assert.equal(await modal.getByRole("button", { name: "Upgrade to Agency Pro" }).count(), 1);
      await page.keyboard.press("Escape");
    }
    await page.goto(`${origin}/pricing`);
    await page.getByRole("heading", { name: /One clear view/ }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Monthly", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("main").innerText(), /1\.490\.000/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Pricing overflow at ${width}`);
    await page.screenshot({ path: `/tmp/monstera-pricing-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Annual", exact: true }).click();
    assert.match(await page.locator("article").first().innerText(), /14\.900\.000/);
    await page.getByLabel("Pricing currency").selectOption("USD");
    assert.match(await page.locator("article").first().innerText(), /\$64/);
    assert.equal(await page.getByRole("button", { name: "Contact sales for USD" }).count(), 1);
    await page.getByLabel("Pricing language").selectOption("vi");
    await page.getByLabel("Pricing currency").selectOption("VND");
    assert.equal(await page.getByRole("button", { name: "Theo năm", exact: true }).getAttribute("aria-pressed"), "true");
    assert.match(await page.locator("article").first().innerText(), /14\.900\.000/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Vietnamese pricing overflow at ${width}`);
    await page.close();
    console.log(`PASS: ${width}px billing states, review, monthly default, price parity, owner controls, Escape/focus, USD sales-only, no real payments.`);
  }
  assert.deepEqual(issues, [], "No browser runtime errors");
} finally {
  await browser.close();
}
