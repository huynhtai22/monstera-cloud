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

const CONNECTOR_RESILIENCE_PRODUCTION_MARKERS = [
  "VERCEL_ENV",
  "NODE_ENV",
  "ENVIRONMENT",
  "APP_ENV",
  "RAILWAY_ENVIRONMENT_NAME",
] as const;

function normalizedMarkerValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function normalizedConnectorResilienceHost(hostname: string): string {
  const host = hostname.toLowerCase();
  // WHATWG URL preserves brackets around IPv6 hostnames. Accept only the one
  // valid loopback representation rather than applying substring matching.
  return host === "[::1]" ? "::1" : host;
}

function assertConnectorResilienceDatabaseUrl(
  value: unknown,
  label: "DATABASE_URL" | "DIRECT_URL",
  env: NodeJS.ProcessEnv,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Connector resilience PostgreSQL tests require ${label}.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Connector resilience PostgreSQL tests received an invalid ${label}.`);
  }

  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname).replace(/^\//, "");
  } catch {
    throw new Error(`Connector resilience PostgreSQL tests received an invalid ${label}.`);
  }

  const host = normalizedConnectorResilienceHost(parsed.hostname);
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const ciService = env.CI === "true" && host === "postgres";
  if ((!loopback && !ciService) || database !== "monstera_ci") {
    throw new Error(`Connector resilience PostgreSQL tests require an approved loopback monstera_ci ${label}.`);
  }

  return value;
}

/** Strict, feature-scoped discipline for destructive resilience scheduler tests. */
export function assertConnectorResilienceTestDatabase(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONNECTOR_RESILIENCE_TEST_DB !== "1") {
    throw new Error("Connector resilience PostgreSQL tests require CONNECTOR_RESILIENCE_TEST_DB=1.");
  }

  const production = CONNECTOR_RESILIENCE_PRODUCTION_MARKERS.some(
    (marker) => normalizedMarkerValue(env[marker]) === "production",
  );
  if (production) throw new Error("Connector resilience PostgreSQL tests refuse production environment markers.");

  const url = assertConnectorResilienceDatabaseUrl(env.DATABASE_URL, "DATABASE_URL", env);
  // The scheduler supplies DATABASE_URL directly to PrismaClient. DIRECT_URL is
  // not its effective datasource here, but is validated before construction so
  // an unsafe configured direct connection can never be silently tolerated.
  if (env.DIRECT_URL !== undefined && env.DIRECT_URL !== "") {
    assertConnectorResilienceDatabaseUrl(env.DIRECT_URL, "DIRECT_URL", env);
  }
  return url;
}
