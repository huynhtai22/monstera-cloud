import { PrismaClient } from "@prisma/client";

/**
 * TEST-ONLY cross-process serialization for the fleet-scanning report-schedule
 * PostgreSQL suites (deadline, occurrence, dispatch-lease, baseline-gap
 * recovery). These suites scan the whole `ReportSchedule` table and would
 * otherwise claim each other's due fixtures under the test runner's parallel
 * file execution.
 *
 * Mechanism: a dedicated PrismaClient restricted to a single physical
 * connection (`connection_limit=1`, idle reaping disabled via
 * `connection_idle_timeout=0`, `pool_timeout=0`) holds a session-level
 * advisory lock for the entire suite. The same physical backend is verified
 * before every fleet test via `pg_backend_pid()` plus the advisory-lock row
 * on that exact PID, so a reaped or lost session fails the suite loudly
 * instead of silently unlocking the fleet.
 *
 * The lock is acquired in `before`, released in `after`, and must never be
 * used outside test code.
 */
export const FLEET_LOCK_KEY = "report-schedules-pg-suite";

export class FleetSuiteLock {
  private readonly client: PrismaClient;
  private backendPid = 0;
  private connected = false;

  private constructor(databaseUrl: string) {
    const url = new URL(databaseUrl);
    url.searchParams.set("connection_limit", "1");
    // Never reap the lock-holding connection: a closed session silently
    // releases the advisory lock and re-opens the fleet to other suites.
    url.searchParams.set("connection_idle_timeout", "0");
    url.searchParams.set("pool_timeout", "0");
    this.client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  }

  /** Loopback-only, disposable-database guard shared by every fleet suite. */
  static assertApprovedSuiteDatabase(databaseUrl: string): void {
    const url = new URL(databaseUrl);
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error(
        `fleet suite lock: DATABASE_URL must be loopback-only (got ${url.hostname})`,
      );
    }
    if (!["/monstera_security_test", "/monstera_ci"].includes(url.pathname)) {
      throw new Error(
        `fleet suite lock: DATABASE_URL must target an approved disposable test database (got ${url.pathname})`,
      );
    }
  }

  static async create(databaseUrl: string): Promise<FleetSuiteLock> {
    FleetSuiteLock.assertApprovedSuiteDatabase(databaseUrl);
    const lock = new FleetSuiteLock(databaseUrl);
    await lock.client.$connect();
    lock.connected = true;
    const rows = await lock.client.$queryRawUnsafe<Array<{ pid: number }>>(
      "SELECT pg_backend_pid() AS pid",
    );
    lock.backendPid = Number(rows[0].pid);
    return lock;
  }

  /** Session-scoped advisory lock; held until `release()`. */
  async acquire(): Promise<void> {
    await this.client.$executeRawUnsafe(
      `SELECT pg_advisory_lock(hashtext($1))`,
      FLEET_LOCK_KEY,
    );
    await this.assertHeld();
  }

  /**
   * Fails closed unless this lock client is still the same live backend and
   * still owns the advisory lock. Runs before every fleet test so a lost
   * session surfaces before any seeding or route invocation.
   */
  async assertHeld(): Promise<void> {
    if (!this.connected) {
      throw new Error("fleet suite lock: dedicated connection is closed");
    }
    const rows = await this.client.$queryRawUnsafe<Array<{ pid: number; held: bigint }>>(
      `SELECT pg_backend_pid() AS pid,
              (SELECT count(*) FROM pg_locks
                WHERE locktype = 'advisory' AND pid = pg_backend_pid()) AS held
       FROM (SELECT 1) x`,
    );
    const row = rows[0];
    if (Number(row.pid) !== this.backendPid) {
      throw new Error(
        `fleet suite lock: backend PID changed (${this.backendPid} -> ${row.pid}); the lock session was lost`,
      );
    }
    if (Number(row.held) < 1) {
      throw new Error(
        `fleet suite lock: advisory lock (key "${FLEET_LOCK_KEY}") is not held on backend ${row.pid}`,
      );
    }
  }

  /** Recorded backend PID of the dedicated lock connection. */
  backendPidForAssertions(): number {
    return this.backendPid;
  }

  async release(): Promise<void> {
    await this.client.$executeRawUnsafe(
      `SELECT pg_advisory_unlock(hashtext($1))`,
      FLEET_LOCK_KEY,
    );
  }

  async close(): Promise<void> {
    this.connected = false;
    await this.client.$disconnect();
  }

  /** Release + close in one teardown call. */
  async releaseAndClose(): Promise<void> {
    try {
      await this.release();
    } finally {
      await this.close();
    }
  }
}

/**
 * Convenience wrapper for the common suite lifecycle: create + connect +
 * acquire in one call, with `releaseSuiteFleetLock` as the matching teardown.
 * Returns the recorded backend PID for assertions.
 */
export async function acquireSuiteFleetLock(
  databaseUrl: string,
): Promise<{ lock: FleetSuiteLock; backendPid: number }> {
  const lock = await FleetSuiteLock.create(databaseUrl);
  try {
    await lock.acquire();
    return { lock, backendPid: lock.backendPidForAssertions() };
  } catch (err) {
    await lock.close();
    throw err;
  }
}
