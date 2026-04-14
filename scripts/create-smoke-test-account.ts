/**
 * Creates (or resets) a credentials-only smoke-test user with email already verified
 * so login works without the OTP step.
 *
 * Usage (requires DATABASE_URL):
 *   npx tsx scripts/create-smoke-test-account.ts
 *
 * Optional env overrides:
 *   SMOKE_TEST_EMAIL   — default: smoke-test@monsteracloud.com
 *   SMOKE_TEST_PASSWORD — default: set below; override in production
 *
 * Run against the same Neon DB your app uses (local .env.local or `vercel env pull`).
 *
 * **Rewind for payment QA:** each run sets `plan` to **free** and clears **subscriptionId**
 * so you can re-test checkout after a successful Paddle webhook upgraded this user.
 * Use a private/incognito window and log in as this email (not your main Google account).
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_EMAIL = "smoke-test@monsteracloud.com";
const DEFAULT_PASSWORD = "SmokeTest_Monstera_2026!";

const WORKSPACE_NAME = "Smoke Test Workspace";
const WORKSPACE_SLUG = "smoke-test-workspace";

async function main() {
  const email = (process.env.SMOKE_TEST_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();
  const password = (process.env.SMOKE_TEST_PASSWORD || DEFAULT_PASSWORD).trim();

  if (!password || password.length < 8) {
    console.error("SMOKE_TEST_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production" && !process.env.SMOKE_TEST_PASSWORD) {
    console.warn(
      "[smoke-test] NODE_ENV=production but SMOKE_TEST_PASSWORD unset — using default password is risky. Set SMOKE_TEST_PASSWORD explicitly."
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  let userId: string;

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: existing.name ?? "Smoke Test",
        hashedPassword,
        emailVerified: new Date(),
        otp: null,
        otpExpires: null,
        plan: "free",
        subscriptionId: null,
      },
    });
    userId = existing.id;
    console.log(`✅ Updated existing user: ${email}`);
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        name: "Smoke Test",
        hashedPassword,
        emailVerified: new Date(),
        plan: "free",
        subscriptionId: null,
      },
    });
    userId = user.id;
    console.log(`✅ Created user: ${email}`);
  }

  const ws = await prisma.workspace.findFirst({
    where: { ownerId: userId, slug: WORKSPACE_SLUG },
  });

  if (!ws) {
    await prisma.workspace.create({
      data: {
        name: WORKSPACE_NAME,
        slug: WORKSPACE_SLUG,
        ownerId: userId,
        members: {
          create: { userId, role: "owner" },
        },
      },
    });
    console.log(`✅ Created workspace: ${WORKSPACE_SLUG}`);
  } else {
    console.log(`✅ Workspace already exists: ${WORKSPACE_SLUG}`);
  }

  console.log("\n── Smoke test login (email verification bypassed) ──");
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}`);
  console.log("   Use only for QA; rotate credentials if exposed.\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
