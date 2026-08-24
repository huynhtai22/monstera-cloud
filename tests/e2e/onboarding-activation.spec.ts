import { expect, test } from "@playwright/test";
import prisma from "../../src/lib/prisma";

async function readIssuedOtp(email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { otp: true },
    });
    if (user?.otp && /^\d{6}$/.test(user.otp)) return user.otp;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Registration did not issue an OTP in the test database");
}

test.describe("onboarding activation", () => {
  test("a new user can register, verify, sign in, and receive a pilot workspace", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const suffix = `${testInfo.project.name}-${testInfo.parallelIndex}-${Date.now()}`.replace(/[^a-z0-9-]/gi, "");
    const email = `activation-${suffix}@example.test`;
    const password = "Activation2026!";
    let userId: string | undefined;
    let workspaceId: string | undefined;

    try {
      await page.goto("/register");
      await page.locator('input[name="name"]').fill("Activation Test");
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Create Account" }).click();
      await expect(page).toHaveURL(/\/verify/);

      const otp = await readIssuedOtp(email);
      for (const [index, digit] of [...otp].entries()) {
        await page.locator(`#otp-${index}`).fill(digit);
      }
      await page.getByRole("button", { name: "Verify Identity" }).click();
      await expect(page).toHaveURL(/\/login\?registered=true/);

      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Continue with Email" }).click();
      await expect(page).toHaveURL(/\/pricing/);

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, emailVerified: true },
      });
      expect(user?.emailVerified).not.toBeNull();
      userId = user?.id;

      const workspaces = await page.request.get("/api/workspaces");
      expect(workspaces.ok()).toBeTruthy();
      const workspaceList = (await workspaces.json()) as Array<{ id: string; plan: string; status: string }>;
      const activatedWorkspace = workspaceList.find((workspace) => workspace.plan === "pilot" && workspace.status === "PILOT");
      expect(activatedWorkspace).toBeTruthy();
      workspaceId = activatedWorkspace?.id;
    } finally {
      const createdUser = userId
        ? { id: userId }
        : await prisma.user.findUnique({ where: { email }, select: { id: true } });
      const createdWorkspace = workspaceId
        ? { id: workspaceId }
        : createdUser
          ? await prisma.workspace.findFirst({ where: { ownerId: createdUser.id }, select: { id: true } })
          : null;

      if (createdWorkspace) await prisma.workspace.delete({ where: { id: createdWorkspace.id } });
      if (createdUser) await prisma.user.delete({ where: { id: createdUser.id } });
    }
  });
});
