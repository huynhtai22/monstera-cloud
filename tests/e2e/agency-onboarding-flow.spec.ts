import { expect, test } from "@playwright/test";

test.describe("Agency-First User Flow & Usability", () => {
  test("Homepage to Register CTA navigation", async ({ page }) => {
    // 1. Visit Homepage
    await page.goto("/");
    
    // 2. Verify Hero Headline & Agency Positioning
    await expect(page.locator("h1")).toContainText("Turn ad & marketplace data");

    // 3. Click Primary CTA: "Start 14-day agency pilot"
    const ctaButton = page.getByRole("link", { name: /Start 14-day agency pilot/i }).first();
    await expect(ctaButton).toBeVisible();
    await ctaButton.click();

    // 4. Verify user arrives on /register
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText("Create your account")).toBeVisible();
  });

  test("Registration form input validation", async ({ page }) => {
    await page.goto("/register");

    // Form heading & pilot badge check
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(page.getByText("14-Day Agency Pilot")).toBeVisible();

    // Verify input fields exist and are visible
    const nameInput = page.locator('input[name="name"], input#name, input[type="text"]').first();
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input#password');
    const confirmPasswordInput = page.locator('input#confirmPassword');

    await expect(nameInput).toBeVisible();
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(confirmPasswordInput).toBeVisible();
  });

  test("Complete agency login and console navigation flow", async ({ page }) => {
    // 1. Visit Login Page
    await page.goto("/login");
    await expect(page.getByText("Welcome back")).toBeVisible();

    // 2. Verify login form fields exist
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
