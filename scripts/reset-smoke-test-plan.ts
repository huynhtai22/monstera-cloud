/**
 * Sets the smoke-test user's plan back to **free** and clears **subscriptionId**
 * so you can repeat Paddle / checkout tests without re-running the full smoke script.
 *
 * Usage (same DATABASE_URL as production when testing live):
 *   npm run reset-smoke-plan
 *
 * Env (optional):
 *   SMOKE_TEST_EMAIL — default: smoke-test@monsteracloud.com
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_EMAIL = "smoke-test@monsteracloud.com";

async function main() {
  const email = (process.env.SMOKE_TEST_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, plan: true, subscriptionId: true },
  });

  if (!user) {
    console.error(`No user found for ${email}. Run: npm run create-smoke-user`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { plan: "free", subscriptionId: null },
  });

  console.log(`✅ Rewound billing for ${email}`);
  console.log(`   (was plan=${user.plan}, subscriptionId=${user.subscriptionId ?? "null"}) → free`);
}

main()
  .catch((e) => {
    console.error("❌ Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
