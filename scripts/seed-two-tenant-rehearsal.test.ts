import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { assertSeedDatabaseDiscipline } from "./seed-two-tenant-rehearsal";

const validSeedEnv: NodeJS.ProcessEnv = {
  MONSTERA_E2E_ISOLATED: "1",
  CLIENT_ASSIGNMENT_TEST_DB: "1",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e",
  NODE_ENV: "test",
};

test("assertSeedDatabaseDiscipline accepts valid approved disposable loopback URL", () => {
  const result = assertSeedDatabaseDiscipline(validSeedEnv);
  assert.equal(result, validSeedEnv.DATABASE_URL);
});

test("assertSeedDatabaseDiscipline accepts when only MONSTERA_E2E_ISOLATED is set", () => {
  const result = assertSeedDatabaseDiscipline({
    ...validSeedEnv,
    CLIENT_ASSIGNMENT_TEST_DB: undefined,
  });
  assert.equal(result, validSeedEnv.DATABASE_URL);
});

test("assertSeedDatabaseDiscipline accepts when only CLIENT_ASSIGNMENT_TEST_DB is set", () => {
  const result = assertSeedDatabaseDiscipline({
    ...validSeedEnv,
    MONSTERA_E2E_ISOLATED: undefined,
  });
  assert.equal(result, validSeedEnv.DATABASE_URL);
});

test("assertSeedDatabaseDiscipline fails closed when DATABASE_URL is missing", () => {
  assert.throws(
    () => assertSeedDatabaseDiscipline({ ...validSeedEnv, DATABASE_URL: undefined }),
    /Seed rehearsal requires a valid DATABASE_URL/
  );
  assert.throws(
    () => assertSeedDatabaseDiscipline({ ...validSeedEnv, DATABASE_URL: "" }),
    /Seed rehearsal requires a valid DATABASE_URL/
  );
  assert.throws(
    () => assertSeedDatabaseDiscipline({ ...validSeedEnv, DATABASE_URL: "mock" }),
    /Seed rehearsal requires a valid DATABASE_URL/
  );
});

test("assertSeedDatabaseDiscipline fails closed for remote or Neon database URLs", () => {
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        ...validSeedEnv,
        DATABASE_URL: "postgresql://user:pass@ep-cool.neon.tech/monstera_e2e",
      }),
    /requires loopback database host/
  );
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        ...validSeedEnv,
        DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/monstera_e2e?endpoint=ep-pooler.neon.tech",
      }),
    /refuses production database markers/
  );
});

test("assertSeedDatabaseDiscipline fails closed for wrong database name", () => {
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        ...validSeedEnv,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_dev",
      }),
    /database name to be exactly monstera_e2e/
  );
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        ...validSeedEnv,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      }),
    /database name to be exactly monstera_e2e/
  );
});

test("assertSeedDatabaseDiscipline fails closed when production markers are active", () => {
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        ...validSeedEnv,
        VERCEL_ENV: "production",
      }),
    /VERCEL_ENV=production/
  );
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        ...validSeedEnv,
        VERCEL_ENV: "preview",
      }),
    /VERCEL_ENV=preview/
  );
  for (const marker of [
    "VERCEL",
    "NEON_API_KEY",
    "META_ACCESS_TOKEN",
    "GOOGLE_CLIENT_SECRET",
    "TIKTOK_APP_SECRET",
    "SHOPEE_LIVE_PARTNER_KEY",
  ]) {
    assert.throws(
      () =>
        assertSeedDatabaseDiscipline({
          ...validSeedEnv,
          [marker]: "secret",
        }),
      new RegExp(`refuses production marker ${marker}`)
    );
  }
});

test("assertSeedDatabaseDiscipline fails closed when opt-in flags are missing", () => {
  assert.throws(
    () =>
      assertSeedDatabaseDiscipline({
        DATABASE_URL: validSeedEnv.DATABASE_URL,
      }),
    /requires explicit opt-in flag/
  );
});

test("direct CLI invocation fails closed before database connection when configuration is invalid", () => {
  const root = path.join(__dirname, "..");
  assert.throws(
    () => {
      execFileSync("npx", ["tsx", "scripts/seed-two-tenant-rehearsal.ts"], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
        } as NodeJS.ProcessEnv,
        stdio: "pipe",
      });
    },
    (err: any) => {
      assert.equal(err.status, 1);
      const stderr = err.stderr?.toString() || "";
      assert.match(stderr, /Seed rehearsal requires a valid DATABASE_URL/);
      return true;
    }
  );
});
