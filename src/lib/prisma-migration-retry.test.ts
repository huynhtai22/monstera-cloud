import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  isPrismaAdvisoryLockTimeout,
  runMigrationDeployWithRetry,
} from "../../scripts/prisma-migration-retry.mjs";

describe("production Prisma migration lock handling", () => {
  it("recognizes only the P1002 advisory-lock timeout", () => {
    assert.equal(
      isPrismaAdvisoryLockTimeout("Error: P1002 Timed out waiting for SELECT pg_advisory_lock(72707369)"),
      true,
    );
    assert.equal(isPrismaAdvisoryLockTimeout("Error: P1002 database connection timed out"), false);
    assert.equal(isPrismaAdvisoryLockTimeout("Error: P3018 migration failed"), false);
  });

  it("retries the advisory-lock timeout once and returns success", async () => {
    let attempts = 0;
    let sleeps = 0;
    const result = await runMigrationDeployWithRetry(
      () => {
        attempts += 1;
        return attempts === 1
          ? { status: 1, stderr: "P1002 SELECT pg_advisory_lock(72707369)" }
          : { status: 0, stdout: "Applied" };
      },
      { delayMs: 0, sleep: async () => { sleeps += 1; } },
    );
    assert.equal(result.status, 0);
    assert.equal(attempts, 2);
    assert.equal(sleeps, 1);
  });

  it("does not retry ordinary migration failures", async () => {
    let attempts = 0;
    const result = await runMigrationDeployWithRetry(
      () => {
        attempts += 1;
        return { status: 1, stderr: "P3018 migration failed because relation is missing" };
      },
      { delayMs: 0, sleep: async () => undefined },
    );
    assert.equal(result.status, 1);
    assert.equal(attempts, 1);
  });

  it("serializes production migration/deployment workflow runs", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    assert.match(workflow, /concurrency:\s*\n\s+group: monstera-production-schema-and-deploy/);
    assert.match(workflow, /cancel-in-progress: false/);
  });
});
