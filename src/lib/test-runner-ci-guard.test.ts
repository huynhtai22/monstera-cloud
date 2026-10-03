import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPostgresTestSuiteConfigured } from "../../scripts/test-runner-lib.mjs";

const requiredTests = [
  "src/lib/connection-lifecycle.pg.integration.test.ts",
  "src/lib/meta-sync-lock.pg.integration.test.ts",
  "src/lib/sync-outcome-fencing.pg.integration.test.ts",
  "src/lib/sync-lease-fencing-completion.pg.integration.test.ts",
  "src/lib/connector-resilience/scheduler-postgres.pg.integration.test.ts",
];

const validEnv = {
  REQUIRE_POSTGRES_TESTS: "1",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/monstera_ci",
  DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_ci",
};

function validPlan(files = requiredTests) {
  return [{ name: "postgres", args: ["--test", ...files] }];
}

describe("CI PostgreSQL integration test gate", () => {
  it("accepts the isolated database and planned lease/concurrency suites", () => {
    assert.doesNotThrow(() => assertPostgresTestSuiteConfigured(validEnv, requiredTests, validPlan()));
  });

  it("is inactive outside the explicitly guarded CI test step", () => {
    assert.doesNotThrow(() => assertPostgresTestSuiteConfigured({}, [], []));
  });

  it("fails when either CI database URL is missing or unsafe", () => {
    assert.throws(
      () => assertPostgresTestSuiteConfigured({ ...validEnv, DIRECT_URL: undefined }, requiredTests, validPlan()),
      /DIRECT_URL to point to the isolated monstera_ci PostgreSQL database/,
    );
    assert.throws(
      () => assertPostgresTestSuiteConfigured({ ...validEnv, DATABASE_URL: "postgresql://db.example/monstera_ci" }, requiredTests, validPlan()),
      /DATABASE_URL to point to the isolated monstera_ci PostgreSQL database/,
    );
    assert.throws(
      () => assertPostgresTestSuiteConfigured({ ...validEnv, DATABASE_URL: "https://localhost/monstera_ci" }, requiredTests, validPlan()),
      /DATABASE_URL to point to the isolated monstera_ci PostgreSQL database/,
    );
  });

  it("fails if required lease/concurrency suites are missing or filtered from the plan", () => {
    assert.throws(
      () => assertPostgresTestSuiteConfigured(validEnv, requiredTests.slice(1), validPlan(requiredTests.slice(1))),
      /connection-lifecycle\.pg\.integration\.test\.ts/,
    );
    assert.throws(
      () => assertPostgresTestSuiteConfigured(validEnv, requiredTests, [{ name: "non-postgres", args: [...requiredTests] }]),
      /sync-lease-fencing-completion\.pg\.integration\.test\.ts/,
    );
  });
});
