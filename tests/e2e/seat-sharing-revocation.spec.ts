import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

test.describe("Seat-sharing session revocation", () => {
  test.describe.configure({ mode: "serial" });
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${process.pid}`;
  const userId = `revoke-user-${suffix}`;
  const workspaceId = `revoke-ws-${suffix}`;
  const email = `${userId}@e2e.test`;
  const password = "RevokeJourney2026pw";

  test.beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email,
        name: "Revocation Journey",
        emailVerified: new Date(),
        hashedPassword: await bcrypt.hash(password, 10),
      },
    });
    await prisma.workspace.create({
      data: { id: workspaceId, slug: workspaceId, name: "Revocation Journey", ownerId: userId, plan: "free" },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId, userId, role: "owner" },
    });
  });

  test.afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function login(page: import("@playwright/test").Page) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await expect(page.locator("h1")).toContainText("Dashboard", { timeout: 20_000 });
  }

  test("login → revoke another browser → revoked browser receives 401", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const revokedContext = await browser.newContext();
    try {
      const ownerPage = await ownerContext.newPage();
      const revokedPage = await revokedContext.newPage();
      await login(ownerPage);
      const beforeSecondLogin = new Set(
        (await prisma.userSession.findMany({ where: { userId }, select: { jti: true } })).map((row) => row.jti),
      );
      await login(revokedPage);

      const secondLoginSessions = await prisma.userSession.findMany({
        where: { userId },
        select: { jti: true },
      });
      const target = secondLoginSessions.find((session) => !beforeSecondLogin.has(session.jti));
      expect(target?.jti).toBeTruthy();

      const revoke = await ownerPage.request.post("/api/auth/sessions/revoke", {
        data: { jti: target.jti },
      });
      expect(revoke.status()).toBe(200);

      const rejected = await revokedPage.request.get("/api/auth/sessions");
      expect(rejected.status()).toBe(401);
      await expect(rejected.json()).resolves.toMatchObject({ error: "Unauthorized" });

      await revokedPage.goto("/console", { waitUntil: "domcontentloaded" });
      await expect(revokedPage).toHaveURL(/\/login\?reason=session-revoked/, { timeout: 15_000 });
      await expect(revokedPage.getByText("This browser was signed out because the active-device allowance was exceeded"))
        .toBeVisible();
    } finally {
      await ownerContext.close();
      await revokedContext.close();
    }
  });
});
