import assert from "node:assert/strict";
import test from "node:test";
import { assertConnectorResilienceTestDatabase } from "@/lib/pg-test-discipline";

const safe = {
  CONNECTOR_RESILIENCE_TEST_DB: "1",
  DATABASE_URL: "postgresql://user:synthetic-password@127.0.0.1:55436/monstera_ci",
  NODE_ENV: "test",
} as NodeJS.ProcessEnv;

function assertRejectedWithoutCredentials(env: NodeJS.ProcessEnv): void {
  assert.throws(
    () => assertConnectorResilienceTestDatabase(env),
    (error: Error) => !error.message.includes("synthetic-password"),
  );
}

test("scheduler database discipline normalizes every production marker and preserves an exact opt-in", () => {
  const markers = ["VERCEL_ENV", "NODE_ENV", "ENVIRONMENT", "APP_ENV", "RAILWAY_ENVIRONMENT_NAME"] as const;
  const productionValues = ["production", "PrOdUcTiOn", " production ", " PrOdUcTiOn "];

  for (const marker of markers) {
    for (const value of productionValues) {
      assertRejectedWithoutCredentials({ ...safe, [marker]: value });
    }
  }
  for (const optIn of [undefined, "0", "false", " 1 ", "01", "true", "1 "]) {
    assertRejectedWithoutCredentials({ ...safe, CONNECTOR_RESILIENCE_TEST_DB: optIn });
  }
});

test("scheduler database discipline accepts only exact loopback hosts and the CI service", () => {
  assert.equal(assertConnectorResilienceTestDatabase(safe), safe.DATABASE_URL);
  assert.equal(
    assertConnectorResilienceTestDatabase({ ...safe, DATABASE_URL: "postgresql://user:synthetic-password@localhost:5432/monstera_ci" }),
    "postgresql://user:synthetic-password@localhost:5432/monstera_ci",
  );
  assert.equal(
    assertConnectorResilienceTestDatabase({ ...safe, DATABASE_URL: "postgresql://user:synthetic-password@[::1]:5432/monstera_ci" }),
    "postgresql://user:synthetic-password@[::1]:5432/monstera_ci",
  );
  assert.equal(
    assertConnectorResilienceTestDatabase({ ...safe, CI: "true", DATABASE_URL: "postgresql://user:synthetic-password@postgres:5432/monstera_ci" }),
    "postgresql://user:synthetic-password@postgres:5432/monstera_ci",
  );

  for (const databaseUrl of [
    "postgresql://user:synthetic-password@postgres:5432/monstera_ci",
    "postgresql://user:synthetic-password@[::2]:5432/monstera_ci",
    "postgresql://user:synthetic-password@[::ffff:192.0.2.1]:5432/monstera_ci",
    "postgresql://user:synthetic-password@localhost.example:5432/monstera_ci",
    "postgresql://user:synthetic-password@[fe80::1%25en0]:5432/monstera_ci",
    "postgresql://user:synthetic-password@[::1:5432/monstera_ci",
    "postgresql://user:synthetic-password@127.0.0.1:5432/postgres",
  ]) {
    assertRejectedWithoutCredentials({ ...safe, DATABASE_URL: databaseUrl });
  }
});

test("scheduler database discipline validates DATABASE_URL and DIRECT_URL before Prisma construction", () => {
  const directUrl = "postgresql://user:synthetic-password@localhost:5432/monstera_ci";
  assert.equal(
    assertConnectorResilienceTestDatabase({ ...safe, DIRECT_URL: directUrl }),
    safe.DATABASE_URL,
  );

  for (const env of [
    { ...safe, DIRECT_URL: "postgresql://user:synthetic-password@remote.example:5432/monstera_ci" },
    { ...safe, DIRECT_URL: "postgresql://user:synthetic-password@localhost:5432/monstera_test" },
    { ...safe, DATABASE_URL: "not a URL" },
    { ...safe, DIRECT_URL: "postgresql://user:synthetic-password@[::1" },
  ]) {
    assertRejectedWithoutCredentials(env);
  }
});
