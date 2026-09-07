import path from "node:path";
import fs from "node:fs";

export const FORBIDDEN_PRODUCTION_ENV_KEYS = [
  "VERCEL",
  "NEON_API_KEY",
  "META_ACCESS_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "TIKTOK_APP_SECRET",
  "SHOPEE_LIVE_PARTNER_KEY",
] as const;

export const ACTIVE_ENV_FILES = [
  ".env",
  ".env.local",
  ".env.test",
  ".env.test.local",
] as const;

export type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Validates the runtime portion of the isolated-E2E contract. It is deliberately
 * filesystem-free so server components can use it during a production-mode
 * `next build` / `next start`; the global setup adds its worktree .env check.
 */
export function assertIsolatedE2eRuntimeEnvironment(
  env: EnvMap = process.env,
  requireAppUrl = true,
): void {
  if (env.MONSTERA_E2E_ISOLATED !== "1" || env.CLIENT_ASSIGNMENT_TEST_DB !== "1") {
    throw new Error("E2E requires explicit isolation flags (MONSTERA_E2E_ISOLATED=1 and CLIENT_ASSIGNMENT_TEST_DB=1).");
  }

  assertNoProductionMarkers(env);
  validateLoopbackDatabaseUrl(env.DATABASE_URL, env);
  validateLoopbackAppUrls(env, requireAppUrl);
  validateE2eCommitSha(env);
}

/**
 * Returns whether browser integrations may be suppressed for an isolated E2E
 * execution. A missing flag means normal application behavior. Any supplied
 * flag is an opt-in request and must satisfy the full runtime isolation
 * contract; it must never silently change production integration behavior.
 */
export function shouldSuppressIntegrationsForIsolatedE2e(env: EnvMap = process.env): boolean {
  if (env.MONSTERA_E2E_ISOLATED === undefined || env.MONSTERA_E2E_ISOLATED === "") {
    return false;
  }

  assertIsolatedE2eRuntimeEnvironment(env, false);
  return true;
}

/**
 * Validates that DATABASE_URL points to an allowed disposable loopback database.
 * Rejects remote databases, Neon hosts, and any database name other than monstera_e2e.
 */
export function validateLoopbackDatabaseUrl(urlStr: string | undefined, env: EnvMap = process.env): URL {
  if (!urlStr || urlStr.trim() === "" || urlStr.includes("mock")) {
    throw new Error("E2E isolation requires a valid DATABASE_URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`E2E isolation: DATABASE_URL is invalid: ${urlStr}`);
  }

  const host = parsed.hostname.toLowerCase();
  const isCi = env.CI === "true" || env.CI === "1";
  const allowedHosts = new Set(["127.0.0.1", "localhost", ...(isCi ? ["postgres"] : [])]);

  if (!allowedHosts.has(host)) {
    throw new Error(`E2E isolation requires loopback database host (127.0.0.1, localhost, or CI postgres), got: ${host}`);
  }

  const dbName = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  if (dbName !== "monstera_e2e") {
    throw new Error(`E2E isolation requires database name to be exactly monstera_e2e, got: ${dbName}`);
  }

  if (
    host.includes("neon.tech") ||
    urlStr.includes("neon.tech") ||
    urlStr.includes("pooler") ||
    urlStr.includes("aws") ||
    urlStr.includes("supabase") ||
    urlStr.includes("rds")
  ) {
    throw new Error("E2E isolation refuses production database markers in DATABASE_URL.");
  }

  return parsed;
}

/**
 * Validates that all provided application/test URLs are loopback.
 * Rejects any non-loopback host (e.g. production or staging domains).
 */
export function validateLoopbackAppUrls(env: EnvMap, requirePresent = true): void {
  const candidates = [
    env.NEXTAUTH_URL,
    env.PLAYWRIGHT_BASE_URL,
    env.APP_URL,
    env.NEXT_PUBLIC_APP_URL,
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    if (requirePresent) {
      throw new Error(
        "E2E isolation requires an explicit loopback application base URL (e.g. NEXTAUTH_URL or PLAYWRIGHT_BASE_URL)."
      );
    }
    return;
  }

  for (const candidate of candidates) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`E2E isolation refuses invalid application URL: ${candidate}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`E2E isolation requires loopback application URL (127.0.0.1 or localhost), got host: ${host}`);
    }
  }
}

/**
 * Validates that no deployment or production markers are active.
 * Rejects VERCEL_ENV=production, VERCEL_ENV=preview, and active provider secrets.
 */
export function assertNoProductionMarkers(env: EnvMap): void {
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    throw new Error(`E2E isolation refuses VERCEL_ENV=${env.VERCEL_ENV}.`);
  }
  if (env.NEXT_PUBLIC_VERCEL_ENV === "production" || env.NEXT_PUBLIC_VERCEL_ENV === "preview") {
    throw new Error(`E2E isolation refuses NEXT_PUBLIC_VERCEL_ENV=${env.NEXT_PUBLIC_VERCEL_ENV}.`);
  }
  if (env.MONSTERA_ENV === "production") {
    throw new Error("E2E isolation refuses MONSTERA_ENV=production.");
  }
  for (const key of FORBIDDEN_PRODUCTION_ENV_KEYS) {
    if (env[key]) {
      throw new Error(`E2E isolation refuses production marker ${key}.`);
    }
  }
}

/**
 * Guard for simulated mail delivery (OTP).
 * When MONSTERA_E2E_ISOLATED is absent, normal mail sending proceeds.
 * When MONSTERA_E2E_ISOLATED is present, all conditions must pass or it throws.
 */
export function assertMailSimulationAllowed(env: EnvMap = process.env): void {
  if (env.MONSTERA_E2E_ISOLATED !== "1") {
    throw new Error("Mail simulation requires MONSTERA_E2E_ISOLATED=1.");
  }
  if (env.CLIENT_ASSIGNMENT_TEST_DB !== "1") {
    throw new Error("Mail simulation requires CLIENT_ASSIGNMENT_TEST_DB=1.");
  }

  assertNoProductionMarkers(env);
  validateLoopbackDatabaseUrl(env.DATABASE_URL, env);
  validateLoopbackAppUrls(env, true);
}

export const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * Validates that an explicitly supplied Git commit SHA is present in the environment
 * via VERCEL_GIT_COMMIT_SHA or GIT_COMMIT_SHA, following the application's established
 * precedence (VERCEL_GIT_COMMIT_SHA takes precedence over GIT_COMMIT_SHA).
 *
 * Rejects missing values, placeholder strings, short SHAs, and non-hexadecimal strings.
 * Returns the normalized 40-character lowercase hexadecimal SHA.
 */
export function validateE2eCommitSha(env: EnvMap = process.env): string {
  const vercelSha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  const gitSha = env.GIT_COMMIT_SHA?.trim();

  // Established precedence: VERCEL_GIT_COMMIT_SHA ?? GIT_COMMIT_SHA
  const candidate = (vercelSha && vercelSha !== "")
    ? vercelSha
    : (gitSha && gitSha !== "")
      ? gitSha
      : undefined;

  if (!candidate) {
    throw new Error(
      "E2E requires an explicitly supplied real Git commit SHA (set VERCEL_GIT_COMMIT_SHA or GIT_COMMIT_SHA)."
    );
  }

  if (candidate.length !== 40 || !FULL_GIT_SHA_PATTERN.test(candidate)) {
    throw new Error(
      `E2E requires a full 40-character hexadecimal Git commit SHA, got: ${candidate}`
    );
  }

  return candidate.toLowerCase();
}

/**
 * Guard for global E2E test setup.
 * Rejects active .env files in worktree on security grounds because Next.js
 * automatically loads .env and .env.local regardless of webServer.env allowlists.
 */
export function assertIsolatedE2eEnvironment(
  env: EnvMap = process.env,
  root = path.join(__dirname, "../..")
): void {
  assertIsolatedE2eRuntimeEnvironment(env);

  // Security guard: Next.js automatically loads `.env` and `.env.local` from the server
  // working directory regardless of Playwright webServer.env allowlists. To prevent
  // accidental production credential or database leaks, we strictly refuse execution
  // if any active environment file exists in the worktree. Only .env.example is permitted.
  for (const file of ACTIVE_ENV_FILES) {
    if (fs.existsSync(path.join(root, file))) {
      throw new Error(`E2E refuses active local ${file} file in execution worktree.`);
    }
  }

}

/**
 * Guard for two-tenant rehearsal database seeding.
 * Fails closed before constructing PrismaClient or performing any database operation.
 */
export function assertSeedDatabaseDiscipline(env: EnvMap = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === "" || url.includes("mock")) {
    throw new Error("Seed rehearsal requires a valid DATABASE_URL.");
  }
  if (env.MONSTERA_E2E_ISOLATED !== "1" || env.CLIENT_ASSIGNMENT_TEST_DB !== "1") {
    throw new Error(
      "Seed rehearsal requires explicit dual isolation opt-in (MONSTERA_E2E_ISOLATED=1 and CLIENT_ASSIGNMENT_TEST_DB=1)."
    );
  }

  assertNoProductionMarkers(env);
  validateLoopbackDatabaseUrl(url, env);

  return url;
}
