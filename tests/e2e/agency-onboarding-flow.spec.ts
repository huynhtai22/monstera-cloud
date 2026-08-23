import { expect, test } from "@playwright/test";

test.describe("Agency-First User Flow & Usability", () => {
  test("Homepage to Register CTA navigation", async ({ page }) => {
    // 1. Visit Homepage
    await page.goto("/");

    // 2. Verify Hero Headline (dark-first redesign, MarketingHomePage copy)
    await expect(page.locator("h1")).toContainText("Your ad data, cleaned");

    // 3. Click Primary CTA: "Start free"
    const ctaButton = page.getByRole("link", { name: /Start free/i }).first();
    await expect(ctaButton).toBeVisible();
    await ctaButton.click();

    // 4. Verify user arrives on /register
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText("Create your account")).toBeVisible();
  });

  test("Registration form input validation", async ({ page }) => {
    await page.goto("/register");

    // Form heading check
    await expect(page.getByText("Create your account")).toBeVisible();

    // Verify input fields exist and are visible (name/email/password; no confirm field)
    const nameInput = page.locator('input#name');
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input#password');

    await expect(nameInput).toBeVisible();
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("Complete agency login and console navigation flow", async ({ page }) => {
    // 1. Visit Login Page
    await page.goto("/login");
    await expect(page.getByText("Log in to Monstera Cloud")).toBeVisible();

    // 2. Verify login form fields exist (email + password + submit)
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // 3. Google OAuth remains offered on the redesigned page
    await expect(page.getByText("Continue with Google")).toBeVisible();
  });
});
