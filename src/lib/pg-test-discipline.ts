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

/** Strict, feature-scoped discipline for destructive resilience scheduler tests. */
export function assertConnectorResilienceTestDatabase(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONNECTOR_RESILIENCE_TEST_DB !== "1") {
    throw new Error("Connector resilience PostgreSQL tests require CONNECTOR_RESILIENCE_TEST_DB=1.");
  }
  const production = [env.VERCEL_ENV, env.NODE_ENV, env.ENVIRONMENT, env.APP_ENV, env.RAILWAY_ENVIRONMENT_NAME]
    .some((value) => value?.toLowerCase() === "production");
  if (production) throw new Error("Connector resilience PostgreSQL tests refuse production environment markers.");

  const url = env.DATABASE_URL;
  if (!url) throw new Error("Connector resilience PostgreSQL tests require DATABASE_URL.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("Connector resilience PostgreSQL tests received an invalid DATABASE_URL."); }
  const host = parsed.hostname.toLowerCase();
  const database = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const ciService = env.CI === "true" && host === "postgres";
  if ((!loopback && !ciService) || database !== "monstera_ci") {
    throw new Error("Connector resilience PostgreSQL tests require an approved loopback monstera_ci database.");
  }
  if (env.DIRECT_URL && env.DIRECT_URL !== url) {
    let direct: URL;
    try { direct = new URL(env.DIRECT_URL); } catch { throw new Error("Connector resilience PostgreSQL tests received an invalid DIRECT_URL."); }
    const directHost = direct.hostname.toLowerCase();
    const directDatabase = decodeURIComponent(direct.pathname).replace(/^\//, "");
    if (!((directHost === "localhost" || directHost === "127.0.0.1" || directHost === "::1") || (env.CI === "true" && directHost === "postgres")) || directDatabase !== "monstera_ci") {
      throw new Error("Connector resilience PostgreSQL tests require an approved loopback monstera_ci DIRECT_URL.");
    }
  }
  return url;
}
