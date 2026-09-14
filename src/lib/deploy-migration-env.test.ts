import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { validateMigrationEnv } from "../../scripts/validate-migration-env.mjs";

const DIRECT_URL =
  "postgresql://owner:supersecret42@ep-royal-grass-ad3yigl2.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const POOLED_URL =
  "postgresql://owner:supersecret42@ep-royal-grass-ad3yigl2-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const MALFORMED_DATABASE_URL =
  "postgresql://synthetic-runtime-user:synthetic-runtime-password@[not-an-ipv6/runtime-db?token=synthetic-query-token";

/** Builds a ProcessEnv containing only the crafted variables under test. */
function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

/** The credential-bearing fragments that must never reach workflow output. */
const SECRET_FRAGMENTS = [
  "supersecret42",
  "owner:",
  "sslmode=require",
  "/neondb",
  "synthetic-runtime-user",
  "synthetic-runtime-password",
  "/runtime-db",
  "synthetic-query-token",
];

function extractStep(workflow: string, stepName: string): string {
  const marker = `- name: ${stepName}`;
  const start = workflow.indexOf(marker);
  assert.ok(start !== -1, `workflow must contain step "${stepName}"`);
  const nextStep = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, nextStep === -1 ? undefined : nextStep);
}

function runValidator(vars: Record<string, string>) {
  return spawnSync(process.execPath, ["scripts/validate-migration-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...envWith(vars),
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
    },
  });
}

describe("secret-safe production migration environment", () => {
  it("runs the production migration through vercel env run", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const step = extractStep(workflow, "Apply database migrations");
    assert.match(
      step,
      /vercel env run --environment=production\b[^\n]*-- npm run db:migrate:prepare/,
      "migrations must execute inside vercel's secret-safe env run",
    );
  });

  it("no longer sources production credentials from the pulled env file", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    assert.ok(
      !workflow.includes(".env.production.local"),
      "the workflow must not read the pulled production env file at all",
    );
    assert.ok(!workflow.includes("set -a"), "the env-exporting source pattern must be gone");
    assert.ok(
      !workflow.includes('DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"'),
      "the silent DIRECT_URL fallback must be gone; validation fails closed instead",
    );
    assert.match(
      workflow,
      /vercel pull --yes --environment=production --token=/,
      "vercel pull is retained for project/build configuration only",
    );
  });

  it("keeps the migration command as npm run db:migrate:prepare", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const step = extractStep(workflow, "Apply database migrations");
    assert.match(step, /npm run db:migrate:prepare/);
  });

  it("runs the fail-closed validator before the migration command", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
    const step = extractStep(workflow, "Apply database migrations");
    const validateAt = step.indexOf("node scripts/validate-migration-env.mjs");
    const migrateAt = step.indexOf("npm run db:migrate:prepare");
    assert.ok(validateAt !== -1, "the validator must run inside the workflow step");
    assert.ok(migrateAt !== -1);
    assert.ok(validateAt < migrateAt, "validation must precede Prisma migration execution");
  });

  it("fails closed when DIRECT_URL is missing", () => {
    const result = validateMigrationEnv(envWith({ DATABASE_URL: DIRECT_URL }));
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("DIRECT_URL is missing")));
  });

  it("fails closed when DIRECT_URL has a malformed scheme", () => {
    const result = validateMigrationEnv(envWith({ DIRECT_URL: "nonsense-value", DATABASE_URL: DIRECT_URL }));
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("must start with the protocol")));
  });

  it("fails closed when DIRECT_URL is a pooled endpoint", () => {
    const result = validateMigrationEnv(envWith({ DIRECT_URL: POOLED_URL, DATABASE_URL: DIRECT_URL }));
    assert.equal(result.ok, false);
    const pooled = result.failures.find((f) => f.includes("pooled endpoint"));
    assert.ok(pooled, "the pooled-host failure must be reported");
    assert.match(pooled, /-pooler/, "the sanitized diagnostic names the offending host");
  });

  it("rejects pooled endpoints regardless of hostname case", () => {
    const upperCasePooled =
      "postgresql://owner:secret43@EP-ROYAL-GRASS-AD3YIGL2-POOLER.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const result = validateMigrationEnv(envWith({ DIRECT_URL: upperCasePooled, DATABASE_URL: DIRECT_URL }));
    assert.equal(
      result.ok,
      false,
      "an upper-case pooled hostname must still be rejected (DNS hostnames are case-insensitive)",
    );
    assert.ok(
      result.failures.some((f) => f.includes("pooled endpoint")),
      "the pooled-host failure must be reported for the case-variant host",
    );
  });

  it("does not let an @ in the query string affect hostname extraction", () => {
    const queryAtDirect =
      "postgresql://ep-royal-grass-ad3yigl2.c-2.us-east-1.aws.neon.tech/neondb?options=@x-pooler";
    const result = validateMigrationEnv(envWith({ DIRECT_URL: queryAtDirect, DATABASE_URL: DIRECT_URL }));
    assert.equal(
      result.ok,
      true,
      `a valid direct URL whose query contains @x-pooler must not be falsely rejected: ${JSON.stringify(result.failures)}`,
    );
  });

  it("fails closed when DATABASE_URL is missing or has an invalid scheme", () => {
    const missing = validateMigrationEnv(envWith({ DIRECT_URL: DIRECT_URL }));
    assert.equal(missing.ok, false);
    assert.ok(missing.failures.some((f) => f.includes("DATABASE_URL is missing")));

    const malformed = validateMigrationEnv(envWith({ DIRECT_URL: DIRECT_URL, DATABASE_URL: "not-a-url" }));
    assert.equal(malformed.ok, false);
    assert.ok(malformed.failures.some((f) => f.includes("DATABASE_URL must start with the protocol")));
  });

  it("fails closed when DATABASE_URL has a malformed authority", () => {
    const result = validateMigrationEnv(
      envWith({ DIRECT_URL: DIRECT_URL, DATABASE_URL: "postgresql://[" }),
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, ["DATABASE_URL is not a valid PostgreSQL connection URL"]);
  });

  it("rejects DATABASE_URL values without a hostname", () => {
    const result = validateMigrationEnv(
      envWith({ DIRECT_URL: DIRECT_URL, DATABASE_URL: "postgresql://" }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("not a valid PostgreSQL connection URL")));
  });

  it("rejects a malformed bracketed IPv6 DATABASE_URL authority", () => {
    const result = validateMigrationEnv(
      envWith({ DIRECT_URL: DIRECT_URL, DATABASE_URL: "postgresql://[2001:db8::1/database" }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("not a valid PostgreSQL connection URL")));
  });

  it("rejects invalid DATABASE_URL port syntax", () => {
    const result = validateMigrationEnv(
      envWith({
        DIRECT_URL: DIRECT_URL,
        DATABASE_URL: "postgresql://runtime.synthetic.test:not-a-port/database",
      }),
    );
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((f) => f.includes("not a valid PostgreSQL connection URL")));
  });

  it("accepts valid direct and IPv6 DATABASE_URL values", () => {
    const direct = validateMigrationEnv(envWith({ DIRECT_URL: DIRECT_URL, DATABASE_URL: DIRECT_URL }));
    const ipv6 = validateMigrationEnv(
      envWith({
        DIRECT_URL: DIRECT_URL,
        DATABASE_URL: "postgresql://runtime:synthetic@[2001:db8::1]:5432/database",
      }),
    );
    assert.equal(direct.ok, true);
    assert.equal(ipv6.ok, true);
  });

  it("accepts a pooled DATABASE_URL because runtime pooling is legitimate", () => {
    const result = validateMigrationEnv(envWith({ DIRECT_URL: DIRECT_URL, DATABASE_URL: POOLED_URL }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
  });

  it("exits nonzero before migrations when validation fails", () => {
    const pooled = runValidator({ DIRECT_URL: POOLED_URL, DATABASE_URL: DIRECT_URL });
    assert.equal(pooled.status, 1);
    const missing = runValidator({ DATABASE_URL: DIRECT_URL });
    assert.equal(missing.status, 1);
  });

  it("exits zero on a valid production environment", () => {
    const ok = runValidator({ DIRECT_URL: DIRECT_URL, DATABASE_URL: DIRECT_URL });
    assert.equal(ok.status, 0);
    assert.match(ok.stdout ?? "", /validated/);
  });

  it("never logs connection credentials or URL fragments", () => {
    const cases = [
      runValidator({ DIRECT_URL: POOLED_URL, DATABASE_URL: DIRECT_URL }),
      runValidator({ DIRECT_URL: "nonsense-value", DATABASE_URL: DIRECT_URL }),
      runValidator({ DIRECT_URL: DIRECT_URL, DATABASE_URL: MALFORMED_DATABASE_URL }),
      runValidator({ DIRECT_URL: DIRECT_URL, DATABASE_URL: DIRECT_URL }),
    ];
    for (const result of cases) {
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      for (const fragment of SECRET_FRAGMENTS) {
        assert.ok(!output.includes(fragment), `output must not contain "${fragment}"`);
      }
      assert.ok(!output.includes(POOLED_URL));
      assert.ok(!output.includes(DIRECT_URL));
    }
  });

  it("leaves the migration retry policy and lease recovery untouched", () => {
    const prepare = readFileSync(resolve(process.cwd(), "scripts/prepare-deploy-migrations.mjs"), "utf8");
    assert.match(prepare, /runMigrationDeployWithRetry\(/, "deploy must still use the retry wrapper");
    assert.match(prepare, /maxAttempts: 2/, "the P1002-only retry policy is unchanged");
    assert.ok(
      !prepare.includes("20260912120000"),
      "no automatic recovery may be added for the lease migration",
    );
    assert.ok(
      !prepare.includes("20260912115000"),
      "no special-casing of the recovery migration may be added",
    );
  });
});
