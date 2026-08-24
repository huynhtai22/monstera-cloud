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
  let apiKeyPlain: string;
  let apiKeyId: string;
  let workspaceId: string;

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("register provisions user + pilot workspace and issues an OTP", async ({ page }) => {
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

  test("API key creation enables the Looker/Sheets delivery path, revocation closes it", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await expect(page.locator("h1")).toContainText("Dashboard", { timeout: 20_000 });

    // Create key through the real route handler (same call the settings UI makes).
    const created = await page.request.post("/api/settings/api-keys", {
      data: { workspaceId, name: "activation-walkthrough" },
    });
    expect([200, 201]).toContain(created.status());
    const body = await created.json();
    apiKeyId = body.id;
    apiKeyPlain = body.key ?? body.apiKey ?? body.fullKey;
    expect(apiKeyPlain).toBeTruthy();

    // Limiter-aware delivery checks: with a reachable limiter (production-like),
    // the fresh key must open the Looker/Sheets path (smoke C4/C5). Without one
    // (isolated CI/local), the middleware must fail CLOSED with 503
    // limiter_unavailable — which is itself a security guarantee worth asserting.
    const limiterConfigured =
      !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

    const ping = await page.request.get(`/api/looker-studio?ping=1`, {
      headers: { Authorization: `Bearer ${apiKeyPlain}` },
    });

    if (limiterConfigured) {
      expect(ping.status()).toBe(200);
      expect((await ping.json()).ok).toBe(true);

      // C5 shape: data probe returns a data array (empty warehouse is valid).
      const probe = await page.request.get(
        `/api/looker-studio?startDate=2026-01-01&endDate=2026-01-31`,
        { headers: { Authorization: `Bearer ${apiKeyPlain}` } },
      );
      expect(probe.status()).toBe(200);
      expect(Array.isArray((await probe.json()).data)).toBe(true);
    } else {
      expect(ping.status()).toBe(503);
    }

    // C6: revocation closes the door.
    const revoked = await page.request.delete(
      `/api/settings/api-keys?id=${apiKeyId}&workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    expect([200, 204]).toContain(revoked.status());
    if (!limiterConfigured) return;
    const afterRevoke = await page.request.get(`/api/looker-studio?ping=1`, {
      headers: { Authorization: `Bearer ${apiKeyPlain}` },
    });
    expect(afterRevoke.status()).toBe(401);
  });
});
