import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMailSimulationAllowed,
  assertNoProductionMarkers,
  assertSeedDatabaseDiscipline,
  validateLoopbackAppUrls,
  validateLoopbackDatabaseUrl,
} from "./e2e-env-guard";

const validE2eEnv: NodeJS.ProcessEnv = {
  MONSTERA_E2E_ISOLATED: "1",
  CLIENT_ASSIGNMENT_TEST_DB: "1",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
  NODE_ENV: "test",
};

test("assertMailSimulationAllowed permits exact approved local E2E configuration", () => {
  assert.doesNotThrow(() => assertMailSimulationAllowed(validE2eEnv));
});

test("assertMailSimulationAllowed allows NODE_ENV=production when isolation markers pass (next start compatibility)", () => {
  assert.doesNotThrow(() =>
    assertMailSimulationAllowed({
      ...validE2eEnv,
      NODE_ENV: "production",
    })
  );
});

test("assertMailSimulationAllowed fails closed when isolation flag alone is set", () => {
  assert.throws(
    () => assertMailSimulationAllowed({ MONSTERA_E2E_ISOLATED: "1" }),
    /Mail simulation requires CLIENT_ASSIGNMENT_TEST_DB=1/
  );
});

test("assertMailSimulationAllowed fails closed when MONSTERA_E2E_ISOLATED is not exactly '1'", () => {
  assert.throws(
    () => assertMailSimulationAllowed({ ...validE2eEnv, MONSTERA_E2E_ISOLATED: "true" }),
    /Mail simulation requires MONSTERA_E2E_ISOLATED=1/
  );
  assert.throws(
    () => assertMailSimulationAllowed({ ...validE2eEnv, MONSTERA_E2E_ISOLATED: "0" }),
    /Mail simulation requires MONSTERA_E2E_ISOLATED=1/
  );
});

test("assertMailSimulationAllowed fails closed when CLIENT_ASSIGNMENT_TEST_DB is missing or wrong", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        CLIENT_ASSIGNMENT_TEST_DB: undefined,
      }),
    /Mail simulation requires CLIENT_ASSIGNMENT_TEST_DB=1/
  );
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        CLIENT_ASSIGNMENT_TEST_DB: "0",
      }),
    /Mail simulation requires CLIENT_ASSIGNMENT_TEST_DB=1/
  );
});

test("assertMailSimulationAllowed fails closed when NODE_ENV=production and VERCEL_ENV=production", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
    /VERCEL_ENV=production/
  );
});

test("assertMailSimulationAllowed fails closed when VERCEL_ENV=preview", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        VERCEL_ENV: "preview",
      }),
    /VERCEL_ENV=preview/
  );
});

test("assertMailSimulationAllowed fails closed for production deployment markers", () => {
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
        assertMailSimulationAllowed({
          ...validE2eEnv,
          [marker]: "active_secret",
        }),
      new RegExp(`refuses production marker ${marker}`)
    );
  }
});

test("assertMailSimulationAllowed fails closed for remote or Neon databases", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        DATABASE_URL: "postgresql://user:pass@ep-cool-neon.us-east-2.aws.neon.tech/monstera_e2e",
      }),
    /requires loopback database host/
  );

  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/monstera_e2e?endpoint=ep-pooler.neon.tech",
      }),
    /refuses production database markers/
  );
});

test("assertMailSimulationAllowed fails closed for wrong local database name", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_ci",
      }),
    /database name to be exactly monstera_e2e/
  );
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_dev",
      }),
    /database name to be exactly monstera_e2e/
  );
});

test("assertMailSimulationAllowed fails closed for non-loopback application URL", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        NEXTAUTH_URL: "https://monsteracloud.com",
      }),
    /requires loopback application URL/
  );
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        PLAYWRIGHT_BASE_URL: "https://preview.monsteracloud.com",
      }),
    /requires loopback application URL/
  );
});

test("assertMailSimulationAllowed fails closed when application URL is missing", () => {
  assert.throws(
    () =>
      assertMailSimulationAllowed({
        ...validE2eEnv,
        NEXTAUTH_URL: undefined,
        PLAYWRIGHT_BASE_URL: undefined,
      }),
    /requires an explicit loopback application base URL/
  );
});

test("validateLoopbackDatabaseUrl permits CI postgres container host when CI=true", () => {
  assert.doesNotThrow(() =>
    validateLoopbackDatabaseUrl(
      "postgresql://postgres:postgres@postgres:5432/monstera_e2e",
      { CI: "true" }
    )
  );
});

test("validateLoopbackDatabaseUrl rejects postgres host when not in CI", () => {
  assert.throws(
    () =>
      validateLoopbackDatabaseUrl(
        "postgresql://postgres:postgres@postgres:5432/monstera_e2e",
        { CI: undefined }
      ),
    /requires loopback database host/
  );
});

test("assertNoProductionMarkers passes for clean environment and rejects production markers", () => {
  assert.doesNotThrow(() => assertNoProductionMarkers({ NODE_ENV: "test" }));
  assert.throws(() => assertNoProductionMarkers({ MONSTERA_ENV: "production" }), /MONSTERA_ENV=production/);
  assert.throws(() => assertNoProductionMarkers({ NEXT_PUBLIC_VERCEL_ENV: "production" }), /NEXT_PUBLIC_VERCEL_ENV=production/);
});

test("validateLoopbackAppUrls validates loopback host and rejects remote host", () => {
  assert.doesNotThrow(() => validateLoopbackAppUrls({ NEXTAUTH_URL: "http://127.0.0.1:3000" }));
  assert.doesNotThrow(() => validateLoopbackAppUrls({ PLAYWRIGHT_BASE_URL: "http://localhost:3000" }));
  assert.throws(() => validateLoopbackAppUrls({ NEXTAUTH_URL: "https://remote.example.com" }), /requires loopback application URL/);
});

test("assertSeedDatabaseDiscipline validates approved database URL", () => {
  const result = assertSeedDatabaseDiscipline(validE2eEnv);
  assert.equal(result, validE2eEnv.DATABASE_URL);
});

test("assertSeedDatabaseDiscipline fails closed when either isolation flag is missing or disabled", () => {
  assert.throws(
    () => assertSeedDatabaseDiscipline({ ...validE2eEnv, CLIENT_ASSIGNMENT_TEST_DB: undefined }),
    /requires explicit dual isolation opt-in/
  );
  assert.throws(
    () => assertSeedDatabaseDiscipline({ ...validE2eEnv, MONSTERA_E2E_ISOLATED: undefined }),
    /requires explicit dual isolation opt-in/
  );
  assert.throws(
    () => assertSeedDatabaseDiscipline({ ...validE2eEnv, MONSTERA_E2E_ISOLATED: "0" }),
    /requires explicit dual isolation opt-in/
  );
});
