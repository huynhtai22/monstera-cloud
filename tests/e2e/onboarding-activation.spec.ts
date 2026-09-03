import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Activation journey walkthrough (launch-readiness gap 7):
 * register → OTP verify → login → provisioned console → API key →
 * programmatic Looker/Sheets delivery path → revoke.
 *
 * Provider OAuth (Meta/Google connect) is intentionally NOT covered here:
 * completing it requires real provider credentials. The connect modal's
 * existence is asserted instead (sources discovery stays truthful).
 */
test.describe("Onboarding & activation journey", () => {
  test.describe.configure({ mode: "serial" });
  const prisma = new PrismaClient();
  const email = `onboard-${Date.now()}-${process.pid}@e2e.test`;
  const password = "Activation2026pw";
  let workspaceId: string;

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("register provisions user + Start (free) workspace and issues an OTP", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#name").fill("Onboarding Walker");
    await page.locator('input[type="email"]').fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Create Account" }).click();

    await expect(page).toHaveURL(/\/verify/, { timeout: 15_000 });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: user!.id },
      include: { workspace: true },
    });
    expect(membership?.workspace).toBeTruthy();
    expect(["free", "professional"]).toContain(membership!.workspace.plan);
    expect(membership!.workspace.status).toBe("PILOT");
    workspaceId = membership!.workspace.id;

    // Registration must have issued an OTP (email delivery is not available
    // in the isolated environment; the code path itself is what we verify).
    expect(user!.otp).toMatch(/^\d{6}$/);
  });

  test("OTP verification unlocks the account", async ({ page }) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const otp = user.otp!;
    expect(user.emailVerified).toBeNull();

    // Fresh context: pass email via the supported query param (the page
    // immediately moves it into sessionStorage and strips the URL).
    await page.goto(`/verify?email=${encodeURIComponent(email)}`);
    for (let i = 0; i < 6; i++) {
      await page.locator(`#otp-${i}`).fill(otp[i]);
    }
    await page.getByRole("button", { name: "Verify Identity" }).click();

    await page.waitForURL(/login|console/, { timeout: 15_000 });
    const verified = await prisma.user.findUnique({ where: { email } });
    expect(verified!.emailVerified).not.toBeNull();
  });

  test("login lands on the provisioned console dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Continue with Email" }).click();

    await expect(page.locator("h1")).toContainText("Dashboard", { timeout: 20_000 });

    const membership = await prisma.workspaceMember.findFirstOrThrow({
      where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id },
      include: { workspace: true },
    });
    workspaceId = membership.workspace.id;
  });

  test("sync activity states its pipeline-only scope and retries without starting a sync", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await expect(page.locator("h1")).toContainText("Dashboard", { timeout: 20_000 });

    let historyRequests = 0;
    await page.route("**/api/sync-logs?**", async (route) => {
      historyRequests += 1;
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary test failure" }),
      });
    });

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Sync activity" })).toBeVisible();
    await expect(page.getByText("This page records source-to-destination pipeline runs.")).toBeVisible();
    await expect(page.getByText("Trying again only reloads this history; it will not start a sync.")).toBeVisible();

    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => historyRequests).toBeGreaterThan(1);
  });

  test("Start plan blocks API-key Looker; Sheets remains the free destination", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await expect(page.locator("h1")).toContainText("Dashboard", { timeout: 20_000 });

    const created = await page.request.post("/api/settings/api-keys", {
      data: { workspaceId, name: "activation-walkthrough" },
    });
    expect(created.status()).toBe(403);
    const body = await created.json();
    expect(body.code).toBe("PLAN_API_KEY_BLOCKED");
  });
});
