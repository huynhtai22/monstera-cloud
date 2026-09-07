import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertIsolatedE2eEnvironment,
  assertMailSimulationAllowed,
  assertNoProductionMarkers,
  assertSeedDatabaseDiscipline,
  shouldSuppressIntegrationsForIsolatedE2e,
  validateE2eCommitSha,
  validateLoopbackAppUrls,
  validateLoopbackDatabaseUrl,
} from "./e2e-env-guard";
import { computeVerificationStatus } from "./report-blueprint";

const validE2eEnv: NodeJS.ProcessEnv = {
  MONSTERA_E2E_ISOLATED: "1",
  CLIENT_ASSIGNMENT_TEST_DB: "1",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/monstera_e2e",
  GIT_COMMIT_SHA: "154ca55b2afe27345d170fccfc4e773df3939310",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
  NODE_ENV: "test",
};

test("assertMailSimulationAllowed permits exact approved local E2E configuration", () => {
  assert.doesNotThrow(() => assertMailSimulationAllowed(validE2eEnv));
});

test("integration suppression is enabled only by a complete isolated E2E runtime configuration", () => {
  assert.equal(shouldSuppressIntegrationsForIsolatedE2e(validE2eEnv), true);
  assert.equal(shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, NODE_ENV: "production" }), true);
  assert.equal(shouldSuppressIntegrationsForIsolatedE2e({ NODE_ENV: "production" }), false);
});

test("integration suppression fails closed for an incomplete or deployment-like isolation request", () => {
  assert.throws(
    () => shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, CLIENT_ASSIGNMENT_TEST_DB: undefined }),
    /requires explicit isolation flags/
  );
  assert.throws(
    () => shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, VERCEL_ENV: "production" }),
    /VERCEL_ENV=production/
  );
  assert.throws(
    () => shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, DATABASE_URL: "postgresql:\/\/x:x@remote.example\/monstera_e2e" }),
    /requires loopback database host/
  );
  assert.throws(
    () => shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, NEXTAUTH_URL: "https:\/\/preview.example" }),
    /requires loopback application URL/
  );
  assert.throws(
    () => shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, GIT_COMMIT_SHA: "short" }),
    /requires a full 40-character hexadecimal Git commit SHA/
  );
  assert.throws(
    () => shouldSuppressIntegrationsForIsolatedE2e({ ...validE2eEnv, GIT_COMMIT_SHA: undefined, VERCEL_GIT_COMMIT_SHA: undefined }),
    /requires an explicitly supplied real Git commit SHA/
  );
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

test("validateE2eCommitSha fails closed when both VERCEL_GIT_COMMIT_SHA and GIT_COMMIT_SHA are missing", () => {
  assert.throws(
    () => validateE2eCommitSha({}),
    /E2E requires an explicitly supplied real Git commit SHA/
  );
  assert.throws(
    () => validateE2eCommitSha({ GIT_COMMIT_SHA: "", VERCEL_GIT_COMMIT_SHA: "" }),
    /E2E requires an explicitly supplied real Git commit SHA/
  );
  assert.throws(
    () => validateE2eCommitSha({ GIT_COMMIT_SHA: "   ", VERCEL_GIT_COMMIT_SHA: "   " }),
    /E2E requires an explicitly supplied real Git commit SHA/
  );
});

test("assertIsolatedE2eEnvironment validates required Git commit SHA", () => {
  assert.throws(
    () => assertIsolatedE2eEnvironment({ ...validE2eEnv, GIT_COMMIT_SHA: undefined }, "/definitely-empty"),
    /E2E requires an explicitly supplied real Git commit SHA/
  );
  assert.throws(
    () => assertIsolatedE2eEnvironment({ ...validE2eEnv, GIT_COMMIT_SHA: "short" }, "/definitely-empty"),
    /E2E requires a full 40-character hexadecimal Git commit SHA/
  );
  assert.doesNotThrow(
    () => assertIsolatedE2eEnvironment(validE2eEnv, "/definitely-empty")
  );
});

test("validateE2eCommitSha fails closed for placeholder text", () => {
  assert.throws(
    () => validateE2eCommitSha({ GIT_COMMIT_SHA: "e2e-isolated-git-commit-sha" }),
    /E2E requires a full 40-character hexadecimal Git commit SHA/
  );
});

test("validateE2eCommitSha fails closed for short SHA", () => {
  assert.throws(
    () => validateE2eCommitSha({ GIT_COMMIT_SHA: "154ca55" }),
    /E2E requires a full 40-character hexadecimal Git commit SHA/
  );
});

test("validateE2eCommitSha fails closed for non-hexadecimal 40-character text", () => {
  assert.throws(
    () => validateE2eCommitSha({ GIT_COMMIT_SHA: "154ca55b2afe27345d170fccfc4e773df393931z" }),
    /E2E requires a full 40-character hexadecimal Git commit SHA/
  );
  assert.throws(
    () => validateE2eCommitSha({ GIT_COMMIT_SHA: "g".repeat(40) }),
    /E2E requires a full 40-character hexadecimal Git commit SHA/
  );
});

test("validateE2eCommitSha passes for valid 40-character GIT_COMMIT_SHA", () => {
  const sha = "154ca55b2afe27345d170fccfc4e773df3939310";
  assert.equal(validateE2eCommitSha({ GIT_COMMIT_SHA: sha }), sha);
  // Normalizes uppercase to lowercase
  assert.equal(validateE2eCommitSha({ GIT_COMMIT_SHA: sha.toUpperCase() }), sha);
});

test("validateE2eCommitSha passes for valid VERCEL_GIT_COMMIT_SHA according to established precedence", () => {
  const vercelSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const gitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  // VERCEL_GIT_COMMIT_SHA takes precedence over GIT_COMMIT_SHA
  assert.equal(
    validateE2eCommitSha({ VERCEL_GIT_COMMIT_SHA: vercelSha, GIT_COMMIT_SHA: gitSha }),
    vercelSha
  );
  // When VERCEL_GIT_COMMIT_SHA is alone
  assert.equal(validateE2eCommitSha({ VERCEL_GIT_COMMIT_SHA: vercelSha }), vercelSha);
  // When VERCEL_GIT_COMMIT_SHA is empty, falls back to GIT_COMMIT_SHA
  assert.equal(
    validateE2eCommitSha({ VERCEL_GIT_COMMIT_SHA: "", GIT_COMMIT_SHA: gitSha }),
    gitSha
  );
});

test("validateE2eCommitSha fails if VERCEL_GIT_COMMIT_SHA is set to invalid value rather than falling back", () => {
  const gitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.throws(
    () => validateE2eCommitSha({ VERCEL_GIT_COMMIT_SHA: "short", GIT_COMMIT_SHA: gitSha }),
    /E2E requires a full 40-character hexadecimal Git commit SHA, got: short/
  );
});

test("playwright.config.ts fails closed before web-server startup when SHA is missing", () => {
  const root = path.join(__dirname, "../..");
  assert.throws(
    () => {
      execFileSync("npx", ["tsx", "-e", 'import("./playwright.config")'], {
        cwd: root,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_COMMIT_SHA: undefined,
          VERCEL_GIT_COMMIT_SHA: undefined,
        },
      });
    },
    (err: any) => {
      const output = (err.stderr?.toString() || "") + (err.stdout?.toString() || "");
      return output.includes("E2E requires an explicitly supplied real Git commit SHA");
    }
  );
});

test("playwright.config.ts passes exact validated SHA into webServer.env", () => {
  const root = path.join(__dirname, "../..");
  const testSha = "154ca55b2afe27345d170fccfc4e773df3939310";
  const result = execFileSync("npx", ["tsx", "-e", `
    import config from "./playwright.config";
    console.log(JSON.stringify({
      passedSha: (config.webServer as any)?.env?.GIT_COMMIT_SHA
    }));
  `], {
    cwd: root,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_COMMIT_SHA: testSha,
      VERCEL_GIT_COMMIT_SHA: undefined,
    },
  });
  const parsed = JSON.parse(result.toString().trim().split("\n").at(-1) || "{}");
  assert.equal(parsed.passedSha, testSha);
});

test("source code audit: no fallback string 'e2e-isolated-git-commit-sha' exists in source", () => {
  const root = path.join(__dirname, "../..");
  const filesToCheck = [
    path.join(root, "playwright.config.ts"),
    path.join(root, "src/lib/e2e-env-guard.ts"),
    path.join(root, "src/lib/report-blueprint.ts"),
  ];
  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, "utf-8");
    assert.equal(
      content.includes("e2e-isolated-git-commit-sha"),
      false,
      `File ${filePath} contains forbidden fallback string`
    );
  }
});

test("blueprint returns generator_version_unrecorded when application genuinely has no commit SHA", () => {
  const envWithoutSha: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_COMMIT_SHA: undefined,
    VERCEL_GIT_COMMIT_SHA: undefined,
  };
  const recorded = Boolean(envWithoutSha.VERCEL_GIT_COMMIT_SHA ?? envWithoutSha.GIT_COMMIT_SHA);
  assert.equal(recorded, false);

  const verificationResult = computeVerificationStatus({
    readinessStatus: "READY",
    requiredProvidersBasis: "explicit",
    requiredProviders: ["google_ads"],
    includedProviders: ["google_ads"],
    hasMetricData: true,
    aggregationCompatible: true,
    grainUnsupportedProviders: [],
    unsupportedProviders: [],
    accountScopeAmbiguous: [],
    currencyVerified: true,
    windowComplete: true,
    timezoneVerified: true,
    destinationsRequired: ["google_sheets"],
    destinationsVerified: true,
    datasetLimited: false,
    generatorVersionRecorded: recorded,
    dependencyHashMatches: true,
  });

  assert.equal(verificationResult.status, "NOT_VERIFIED");
  assert.ok(verificationResult.reasons.includes("generator_version_unrecorded"));
});
