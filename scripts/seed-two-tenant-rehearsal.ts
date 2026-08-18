/**
 * Seeds a clean two-tenant environment for manual browser acceptance rehearsal.
 *
 * Sets up:
 *  - Tenant A (Alpha Agency / slug: alpha-agency)
 *      - Owner:  alice@alpha-agency.test (Password: Pilot_Alpha_2026!)
 *      - Viewer: charlie@alpha-agency.test (Password: Pilot_Alpha_2026!)
 *      - Sample Meta Ads connection + CampaignMetric rows
 *  - Tenant B (Beta Media / slug: beta-media)
 *      - Owner:  bob@beta-media.test (Password: Pilot_Beta_2026!)
 *      - Sample Google Ads connection + CampaignMetric rows
 *
 * Usage (requires DATABASE_URL):
 *   npx tsx scripts/seed-two-tenant-rehearsal.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD_A = "Pilot_Alpha_2026!";
const PASSWORD_B = "Pilot_Beta_2026!";

async function main() {
  console.log("🌱 Seeding Two-Tenant Acceptance Rehearsal Environment...\n");

  const [hashedPasswordA, hashedPasswordB] = await Promise.all([
    bcrypt.hash(PASSWORD_A, 12),
    bcrypt.hash(PASSWORD_B, 12),
  ]);

  // 1. Create or update users
  const alice = await prisma.user.upsert({
    where: { email: "alice@alpha-agency.test" },
    update: { hashedPassword: hashedPasswordA, emailVerified: new Date(), plan: "pilot" },
    create: {
      email: "alice@alpha-agency.test",
      name: "Alice Owner (Alpha)",
      hashedPassword: hashedPasswordA,
      emailVerified: new Date(),
      plan: "pilot",
    },
  });

  const charlie = await prisma.user.upsert({
    where: { email: "charlie@alpha-agency.test" },
    update: { hashedPassword: hashedPasswordA, emailVerified: new Date(), plan: "pilot" },
    create: {
      email: "charlie@alpha-agency.test",
      name: "Charlie Viewer (Alpha)",
      hashedPassword: hashedPasswordA,
      emailVerified: new Date(),
      plan: "pilot",
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: "bob@beta-media.test" },
    update: { hashedPassword: hashedPasswordB, emailVerified: new Date(), plan: "pilot" },
    create: {
      email: "bob@beta-media.test",
      name: "Bob Owner (Beta)",
      hashedPassword: hashedPasswordB,
      emailVerified: new Date(),
      plan: "pilot",
    },
  });

  // 2. Create or update workspaces
  const wsA = await prisma.workspace.upsert({
    where: { slug: "alpha-agency" },
    update: { ownerId: alice.id, name: "Alpha Agency", plan: "pilot" },
    create: {
      slug: "alpha-agency",
      name: "Alpha Agency",
      ownerId: alice.id,
      plan: "pilot",
    },
  });

  const wsB = await prisma.workspace.upsert({
    where: { slug: "beta-media" },
    update: { ownerId: bob.id, name: "Beta Media", plan: "pilot" },
    create: {
      slug: "beta-media",
      name: "Beta Media",
      ownerId: bob.id,
      plan: "pilot",
    },
  });

  // 3. Ensure memberships
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: wsA.id, userId: alice.id } },
    update: { role: "owner" },
    create: { workspaceId: wsA.id, userId: alice.id, role: "owner" },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: wsA.id, userId: charlie.id } },
    update: { role: "viewer" },
    create: { workspaceId: wsA.id, userId: charlie.id, role: "viewer" },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: wsB.id, userId: bob.id } },
    update: { role: "owner" },
    create: { workspaceId: wsB.id, userId: bob.id, role: "owner" },
  });

  // 4. Seed sample connections for Alpha Agency
  const alphaMeta = await prisma.connection.upsert({
    where: {
      workspaceId_provider_remoteAccountId: {
        workspaceId: wsA.id,
        provider: "meta_ads",
        remoteAccountId: "act_alpha_meta_1001",
      },
    },
    update: {
      name: "Alpha Meta Ads Main",
      type: "source",
      credentials: "enc:v1:rehearsal_encrypted_payload",
      status: "connected",
      lastSyncAt: new Date(),
    },
    create: {
      workspaceId: wsA.id,
      name: "Alpha Meta Ads Main",
      type: "source",
      provider: "meta_ads",
      credentials: "enc:v1:rehearsal_encrypted_payload",
      remoteAccountId: "act_alpha_meta_1001",
      status: "connected",
      lastSyncAt: new Date(),
    },
  });

  // 5. Seed sample connections for Beta Media
  const betaGoogle = await prisma.connection.upsert({
    where: {
      workspaceId_provider_remoteAccountId: {
        workspaceId: wsB.id,
        provider: "google_ads",
        remoteAccountId: "customers/beta_gads_2002",
      },
    },
    update: {
      name: "Beta Google Ads Primary",
      type: "source",
      credentials: "enc:v1:rehearsal_encrypted_payload",
      status: "connected",
      lastSyncAt: new Date(),
    },
    create: {
      workspaceId: wsB.id,
      name: "Beta Google Ads Primary",
      type: "source",
      provider: "google_ads",
      credentials: "enc:v1:rehearsal_encrypted_payload",
      remoteAccountId: "customers/beta_gads_2002",
      status: "connected",
      lastSyncAt: new Date(),
    },
  });

  // 6. Seed sample CampaignMetrics for Alpha
  await prisma.campaignMetric.createMany({
    data: [
      {
        workspaceId: wsA.id,
        connectionId: alphaMeta.id,
        platform: "meta_ads",
        accountId: "act_alpha_meta_1001",
        accountName: "Alpha Meta Account",
        campaignId: "cmp_alpha_1",
        campaignName: "Alpha Summer Campaign",
        date: new Date("2026-08-01"),
        impressions: 15400,
        clicks: 820,
        spend: 450.5,
        conversions: 35,
        revenue: 1420.0,
      },
      {
        workspaceId: wsA.id,
        connectionId: alphaMeta.id,
        platform: "meta_ads",
        accountId: "act_alpha_meta_1001",
        accountName: "Alpha Meta Account",
        campaignId: "cmp_alpha_2",
        campaignName: "Alpha Retargeting",
        date: new Date("2026-08-02"),
        impressions: 8900,
        clicks: 430,
        spend: 210.0,
        conversions: 18,
        revenue: 890.0,
      },
    ],
    skipDuplicates: true,
  });

  // 7. Seed sample CampaignMetrics for Beta
  await prisma.campaignMetric.createMany({
    data: [
      {
        workspaceId: wsB.id,
        connectionId: betaGoogle.id,
        platform: "google_ads",
        accountId: "customers/beta_gads_2002",
        accountName: "Beta Google Ads Account",
        campaignId: "cmp_beta_1",
        campaignName: "Beta Search LeadGen",
        date: new Date("2026-08-01"),
        impressions: 42000,
        clicks: 2100,
        spend: 1250.0,
        conversions: 94,
        revenue: 4800.0,
      },
    ],
    skipDuplicates: true,
  });

  console.log("✅ Seeded Tenant A (Alpha Agency):");
  console.log("   • Workspace: Alpha Agency (slug: alpha-agency)");
  console.log("   • Owner:     alice@alpha-agency.test  / Password: " + PASSWORD_A);
  console.log("   • Viewer:    charlie@alpha-agency.test / Password: " + PASSWORD_A);
  console.log("   • Connection ID: " + alphaMeta.id);
  console.log("\n✅ Seeded Tenant B (Beta Media):");
  console.log("   • Workspace: Beta Media (slug: beta-media)");
  console.log("   • Owner:     bob@beta-media.test    / Password: " + PASSWORD_B);
  console.log("   • Connection ID: " + betaGoogle.id);
  console.log("\nTwo-tenant acceptance rehearsal data ready!");
}

main()
  .catch((e) => {
    console.error("❌ Error seeding rehearsal data:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
