import fs from "node:fs";
import path from "node:path";

/**
 * Discovers the newest migration directory in prisma/migrations, e.g.:
 * "20260903120000_payment_order_authoritative".
 *
 * In serverless production environments where the prisma/migrations folder
 * is not bundled into the lambda container, falls back to the build-time
 * environment variable RELEASE_SCHEMA_VERSION.
 */
export function resolveLatestMigrationVersion(migrationsDir?: string): string {
  const envVersion = process.env.RELEASE_SCHEMA_VERSION?.trim();
  if (envVersion && envVersion !== "development" && envVersion !== "unknown") {
    return envVersion;
  }

  const baseDir = migrationsDir || path.join(process.cwd(), "prisma", "migrations");
  try {
    if (fs.existsSync(baseDir)) {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      const migrationDirs = entries
        .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
        .map((entry) => entry.name)
        .sort();

      if (migrationDirs.length > 0) {
        return migrationDirs[migrationDirs.length - 1];
      }
    }
  } catch {
    // Filesystem read failure fallback
  }

  return envVersion || "unknown";
}
