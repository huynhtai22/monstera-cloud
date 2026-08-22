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
