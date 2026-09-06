/**
 * CI discipline: in CI the PostgreSQL service is REQUIRED. A silently skipped
 * PG suite in CI would green-light merges without concurrency/tenant coverage,
 * so an unreachable DB fails the suite instead of skipping.
 */
export function assertCiDatabaseReachable(): void {
  if (process.env.CI === "true") {
    throw new Error(
      "CI must provide a reachable PostgreSQL 16 service (DATABASE_URL). PG integration tests skipped=failed in CI."
    );
  }
}

/**
 * Fails in CI ONLY when DATABASE_URL is actually absent/mock; no-op when a
 * real URL is configured (the connect-failure path handles unreachable DBs),
 * and always a no-op locally.
 */
export function assertCiDatabaseReachableWhenMissing(): void {
  const url = process.env.DATABASE_URL;
  if (process.env.CI === "true" && (!url || url.includes("mock"))) {
    throw new Error(
      "CI must set a real PostgreSQL DATABASE_URL (got nothing or a mock). PG integration tests cannot silently skip in CI."
    );
  }
}

/**
 * Validates that DATABASE_URL points to an allowed local disposable database
 * and rejects production-like database identities. Throws if missing or invalid.
 */
export function assertAllowedTestDatabase(url: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!url || url.includes("mock")) {
    throw new Error(
      "DATABASE_URL must be provided for PostgreSQL integration tests. Tests cannot skip."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL is invalid: ${url}`);
  }
  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  const approvedDatabases = new Set(["monstera_ci", "monstera_e2e"]);
  const localRun = env.CLIENT_ASSIGNMENT_TEST_DB === "1";
  const ciRun = env.CI === "true";
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  const allowedHost = loopback || (ciRun && host === "postgres");
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.MONSTERA_ENV === "production";

  if (!localRun || production || !allowedHost || !approvedDatabases.has(database)) {
    throw new Error(
      `DATABASE_URL (${host}/${database}) is not an approved disposable test database.`
    );
  }
  return url;
}
