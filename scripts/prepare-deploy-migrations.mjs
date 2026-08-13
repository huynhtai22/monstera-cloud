import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const BASELINE = "20260401000000_baseline";
const PILOT_MIGRATION = "20260813090000_agency_pilot_tenancy";
const REQUIRED_BASELINE_TABLES = [
  "User",
  "Workspace",
  "WorkspaceMember",
  "Connection",
  "Pipeline",
  "CampaignMetric",
];

function runPrisma(args) {
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["prisma", ...args], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error("DATABASE_URL is required for deployment migrations");
}

const prisma = new PrismaClient();
let existingTables;
let baselineApplied = false;
let failedPilotMigration = false;

try {
  existingTables = await prisma.$queryRawUnsafe(`
    SELECT "table_name" AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const tableNames = new Set(existingTables.map((row) => row.tableName));

  if (tableNames.has("_prisma_migrations")) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT EXISTS(
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      ) AS "applied"`,
      BASELINE,
    );
    baselineApplied = rows[0]?.applied === true;

    const failedRows = await prisma.$queryRawUnsafe(
      `SELECT EXISTS(
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL
      ) AS "failed"`,
      PILOT_MIGRATION,
    );
    failedPilotMigration = failedRows[0]?.failed === true;
  }

  if (tableNames.has("Workspace") && !baselineApplied) {
    const missing = REQUIRED_BASELINE_TABLES.filter((table) => !tableNames.has(table));
    if (missing.length) {
      throw new Error(
        `Refusing to adopt the migration baseline because required tables are missing: ${missing.join(", ")}`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}

const tableNames = new Set(existingTables.map((row) => row.tableName));
if (tableNames.has("Workspace") && !baselineApplied) {
  console.log(`Existing schema detected; marking ${BASELINE} as applied.`);
  runPrisma(["migrate", "resolve", "--applied", BASELINE]);
}

if (failedPilotMigration) {
  console.log(`Recovering the interrupted ${PILOT_MIGRATION} migration.`);
  runPrisma(["migrate", "resolve", "--rolled-back", PILOT_MIGRATION]);
}

runPrisma(["migrate", "deploy"]);
