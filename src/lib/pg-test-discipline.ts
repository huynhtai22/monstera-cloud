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
export function assertAllowedTestDatabase(url: string | undefined): string {
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
  const pathname = parsed.pathname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "postgres" || host === "0.0.0.0";
  const isDisposableDb =
    pathname.includes("test") ||
    pathname.includes("ci") ||
    pathname.includes("disposable") ||
    pathname.includes("monstera_") ||
    pathname.includes("local");

  if (!isLocal || !isDisposableDb) {
    throw new Error(
      `DATABASE_URL (${host}${pathname}) is not an allowed disposable test database. Production-like database identities rejected.`
    );
  }
  return url;
}
