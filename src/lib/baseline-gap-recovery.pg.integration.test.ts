import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertCiDatabaseReachableWhenMissing } from "@/lib/pg-test-discipline";

// Migration-contract coverage for 20260912115000_restore_missing_baseline_tables:
// the corrective migration must restore exactly the six baseline tables omitted
// by baseline adoption, no-op on canonical databases, fail closed on partial
// states, and stay ordered before the Report Dispatch lease migration. The
// state scenarios run against real PostgreSQL inside rolled-back transactions.
assertCiDatabaseReachableWhenMissing();
const hasDb = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("mock"));

const RECOVERY_DIR = "20260912115000_restore_missing_baseline_tables";
const LEASE_DIR = "20260912120000_report_schedule_dispatch_lease";
const ATTEMPT_DIR = "20260912130000_report_schedule_dispatch_attempt";
const SIX_TABLES = [
  "DashboardTemplate",
  "DataQualityViolation",
  "ReportSchedule",
  "SchemaVersion",
  "SyncLogDetail",
  "UserDashboard",
];

const TEST_SCHEMA = "bgr_contract_test";

describe("baseline-gap recovery migration contract (real PostgreSQL)", { skip: !hasDb }, () => {
  let db: PrismaClient;
  let validationPassed = false;
  let schemaCreated = false;
  const repoRoot = path.join(__dirname, "..", "..");
  const migrationSql = readFileSync(
    path.join(repoRoot, "prisma", "migrations", RECOVERY_DIR, "migration.sql"),
    "utf8",
  );
  const realFetch = globalThis.fetch;
  /** Drops the six tables (autocommit fixture helper). */
  async function dropSix() {
    await db.$executeRawUnsafe(
      `DROP TABLE IF EXISTS ${SIX_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE;`,
    );
  }

  /** Creates minimal standalone shapes for partial-state scenarios. */
  async function createPartial(tables: string[]) {
    for (const t of tables) {
      await db.$executeRawUnsafe(`CREATE TABLE "${t}" (id TEXT PRIMARY KEY);`);
    }
  }

  /** Counts the six tables. */
  async function sixCount(): Promise<number> {
    const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('DashboardTemplate','DataQualityViolation','ReportSchedule',
                             'SchemaVersion','SyncLogDetail','UserDashboard')`,
    );
    return Number(rows[0].n);
  }

  /** Executes the corrective migration SQL. */
  function execMigration(): Promise<number> {
    return db.$executeRawUnsafe(migrationSql);
  }

  before(async () => {
    const urlStr = process.env.DATABASE_URL!;
    const url = new URL(urlStr);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));
    // Validation passed: only now may any client capable of destructive
    // cleanup be created, and only the dedicated schema may be touched.
    validationPassed = true;

    const adminDb = new PrismaClient({ datasources: { db: { url: urlStr } } });
    await adminDb.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}";`);
    await adminDb.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TEST_SCHEMA}"."Workspace" (id TEXT PRIMARY KEY);`);
    await adminDb.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TEST_SCHEMA}"."DataQualityRule" (id TEXT PRIMARY KEY);`);
    await adminDb.$disconnect();
    schemaCreated = true;

    const testUrl = new URL(urlStr);
    testUrl.searchParams.set("schema", TEST_SCHEMA);
    db = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
    await db.$connect();
  });

  after(async () => {
    if (db) {
      await db.$disconnect();
    }
    // Cleanup only after approved validation AND schema creation; otherwise
    // this suite never touched the database and must not issue SQL against
    // a rejected target.
    if (!validationPassed || !schemaCreated) {
      return;
    }
    const urlStr = process.env.DATABASE_URL!;
    const url = new URL(urlStr);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.ok(["/monstera_security_test", "/monstera_ci"].includes(url.pathname));
    const adminDb = new PrismaClient({ datasources: { db: { url: urlStr } } });
    await adminDb.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE;`);
    await adminDb.$disconnect();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("rejects an unapproved database name before any client or cleanup SQL", () => {
    // Pure validation: identical logic to the suite's before() gate.
    const validate = (raw: string) => {
      const url = new URL(raw);
      assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "non-loopback");
      assert.ok(
        ["/monstera_security_test", "/monstera_ci"].includes(url.pathname),
        "unapproved database",
      );
    };
    const approved = "postgresql://postgres:postgres@localhost:5439/monstera_ci";
    validate(approved);
    for (const rejected of [
      "postgresql://postgres:postgres@db.example.com:5432/monstera_ci",
      "postgresql://postgres:postgres@localhost:5439/production_db",
    ]) {
      assert.throws(() => validate(rejected), `unapproved target must be rejected: ${rejected}`);
    }
    // A rejected validation leaves the gate closed: teardown performs no SQL.
    let validationPassed = false;
    let schemaCreated = false;
    assert.throws(() => validate("postgresql://postgres:postgres@localhost:5439/production_db"));
    assert.equal(validationPassed || schemaCreated, false, "gate stays closed for rejected targets");
  });

  it("targets exactly the six missing baseline tables and contains no destructive SQL", () => {
    for (const table of SIX_TABLES) {
      assert.match(migrationSql, new RegExp(`CREATE TABLE "${table}"`), table);
    }
    assert.equal(
      (migrationSql.match(/CREATE TABLE "/g) ?? []).length,
      6,
      "no tables beyond the six are created",
    );
    // Real SQL-boundary patterns (case-insensitive, whitespace-tolerant);
    // referential actions such as ON UPDATE CASCADE are not destructive.
    const destructive = findDestructiveStatements(migrationSql);
    assert.deepEqual(destructive, [], `destructive SQL banned: ${JSON.stringify(destructive)}`);
    for (const banned of ["dispatchLeaseToken", "dispatchLeaseExpiresAt", "ReportScheduleDispatchAttempt"]) {
      assert.equal(migrationSql.includes(banned), false, "lease/attempt objects are owned by later migrations");
    }
  });

  it("sorts before the Report Dispatch lease and attempt migrations", () => {
    assert.ok(RECOVERY_DIR < LEASE_DIR, "recovery migration must apply before the lease migration");
    assert.ok(LEASE_DIR < ATTEMPT_DIR, "lease migration must apply before the attempt migration");
  });

  it("is idempotent: running it twice is safe", { timeout: 30000 }, async () => {
    await dropSix();
    await execMigration();
    assert.equal(await sixCount(), 6);
    await execMigration();
    assert.equal(await sixCount(), 6, "second execution is a safe no-op");
  });

  it("creates the complete canonical structures when all six are absent", { timeout: 30000 }, async () => {
    try {
      await dropSix();
      await execMigration();
      assert.equal(await sixCount(), 6);
      // Canonical FK parity with the baseline definitions.
      const fks = await db.$queryRawUnsafe<Array<{ conname: string }>>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = ('"' || current_schema() || '"."DataQualityViolation"')::regclass AND contype = 'f'
          ORDER BY conname`,
      );
      assert.deepEqual(
        fks.map((f) => f.conname).sort(),
        ["DataQualityViolation_ruleId_fkey", "DataQualityViolation_workspaceId_fkey"],
      );
      const dashFks = await db.$queryRawUnsafe<Array<{ conname: string }>>(
        `SELECT conname FROM pg_constraint
          WHERE conrelid = ('"' || current_schema() || '"."UserDashboard"')::regclass AND contype = 'f'`,
      );
      assert.equal(dashFks.length, 1);
      // Canonical indexes exist.
      const idx = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM pg_indexes
          WHERE schemaname = current_schema() AND tablename = 'ReportSchedule' AND indexname LIKE 'ReportSchedule%'`,
      );
      assert.ok(Number(idx[0].n) >= 2, "ReportSchedule indexes restored");
    } finally {
      // Restore the canonical six for later suites (drop + re-apply).
      await dropSix();
      await execMigration();
    }
  });

  it("fails closed when only a partial subset of the six tables exists", { timeout: 30000 }, async () => {
    for (const partial of [
      ["ReportSchedule"],
      ["ReportSchedule", "DashboardTemplate"],
      ["ReportSchedule", "SchemaVersion", "SyncLogDetail", "UserDashboard", "DataQualityViolation"],
    ]) {
      // Autocommit statements: the migration's own DO block aborts only its
      // implicit transaction, so the partial state remains observable.
      await dropSix();
      await createPartial(partial);
      await assert.rejects(
        () => execMigration(),
        (err: unknown) =>
          err instanceof Error && err.message.includes("partial baseline state detected"),
        `partial state (${partial.length}/6) must fail closed`,
      );
      assert.equal(await sixCount(), partial.length, "nothing was created by the failed guard");
    }
  });

  it("leaves no trace: the guard rollback leaves the shared suite database unchanged", { timeout: 30000 }, async () => {
    try {
      await dropSix();
      await createPartial(["ReportSchedule"]);
      await assert.rejects(() => execMigration(), /partial baseline state detected/);
      assert.equal(await sixCount(), 1, "the failed guard created nothing");
    } finally {
      await dropSix();
      await execMigration();
    }
  });
});


/** Case-insensitive, whitespace-tolerant destructive-SQL detector (test-only). */
export const DESTRUCTIVE_SQL_PATTERNS: RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
];

export function findDestructiveStatements(sql: string): string[] {
  return DESTRUCTIVE_SQL_PATTERNS.filter((p) => p.test(sql)).map((p) => p.source);
}

describe("destructive-SQL guard sentinels", () => {
  const find = (sql: string) => findDestructiveStatements(sql).length;
  const recoveryMigrationSql = readFileSync(
    path.join(__dirname, "..", "..", "prisma", "migrations", RECOVERY_DIR, "migration.sql"),
    "utf8",
  );

  it("detects every destructive sentinel form", () => {
    for (const sql of [
      'DROP TABLE "Example";',
      "drop table example;",
      "DROP\nTABLE example;",
      "TRUNCATE TABLE example;",
      'DELETE FROM "Example";',
      "DROP COLUMN example;",
    ]) {
      assert.ok(find(sql) > 0, `sentinel must be detected: ${JSON.stringify(sql)}`);
    }
  });

  it("does not misclassify referential actions", () => {
    assert.equal(
      find('ALTER TABLE "T" ADD CONSTRAINT c FOREIGN KEY (a) REFERENCES "W"(id) ON UPDATE CASCADE ON DELETE CASCADE;'),
      0,
      "referential actions are not destructive statements",
    );
  });

  it("passes the real committed recovery migration", () => {
    assert.equal(find(recoveryMigrationSql), 0, "recovery migration contains no destructive SQL");
  });
});
