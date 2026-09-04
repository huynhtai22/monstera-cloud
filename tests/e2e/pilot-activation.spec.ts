import { expect, test } from "@playwright/test";

test.describe("pilot activation console journey", () => {
  test("quickstart redirects to console and offer param is copy-only", async ({ page }) => {
    const response = await page.request.get("/quickstart", { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(response.status());
    const location = response.headers()["location"] || "";
    expect(location).toContain("/console");

    await page.goto("/register?offer=agency-pro-pilot");
    await expect(page.getByText("7-day Agency Pro pilot")).toBeVisible();
    await page.goto("/register");
    await expect(page.getByText("Create your account")).toBeVisible();
  });

  test("demo pilot-activation fixture renders all five states", async ({ page }) => {
    const response = await page.goto("/demo/ui/pilot-activation");
    // In production the demo is hidden behind notFound()
    if (response && response.status() === 404) {
      await expect(page.getByText("404")).toBeVisible();
      return;
    }
    await expect(page.getByRole("heading", { name: "Pilot activation states" })).toBeVisible();
    await expect(page.getByText("Not started")).toBeVisible();
    await expect(page.getByText("Importing")).toBeVisible();
    await expect(page.getByText("Blocked")).toBeVisible();
    await expect(page.getByText("Ready to review")).toBeVisible();
    await expect(page.getByText("Activated")).toBeVisible();
  });
});

test.describe("pilot activation guide dismissal and recovery", () => {
  test("dismissal persists per workspace and resume restores the guide", async ({ page, browser }) => {
    // Login as alice who has alpha-agency
    const csrfRes = await page.request.get("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    await page.request.post("/api/auth/callback/credentials", {
      form: { csrfToken, email: "alice@alpha-agency.test", password: "Pilot_Alpha_2026!", redirect: "false", json: "true", callbackUrl: "/console" },
    });
    await page.goto("/console");
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 15000 });

    // The guide should be visible initially for a fresh pilot workspace (if not dismissed)
    const dismissButton = page.getByRole("button", { name: "Dismiss" }).first();
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();
    // Should show "Setup guide hidden" with Resume button
    await expect(page.getByText("Setup guide hidden")).toBeVisible();
    const resumeButton = page.getByRole("button", { name: "Resume setup guide" });
    await expect(resumeButton).toBeVisible();
    // Dismissed state should survive a refresh
    await page.reload();
    await expect(page.getByText("Setup guide hidden")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume setup guide" })).toBeVisible();
    // Resume restores the guide and survives a second refresh
    await resumeButton.click();
    await expect(page.getByText("Pilot activation")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Pilot activation")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible({ timeout: 15000 });
  });
});
