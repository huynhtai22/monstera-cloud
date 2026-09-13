import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PROTOCOL_PATTERN = /^postgres(?:ql)?:\/\//;

/**
 * Extracts the hostname from a scheme-valid connection URL without ever
 * retaining or returning userinfo, path or query string. Returns null when
 * the remainder cannot be parsed.
 */
export function safeHost(url) {
  const withoutProtocol = url.replace(PROTOCOL_PATTERN, "");
  const withoutUserInfo = withoutProtocol.includes("@")
    ? withoutProtocol.slice(withoutProtocol.indexOf("@") + 1)
    : withoutProtocol;
  const hostMatch = withoutUserInfo.match(/^[^/:?#]+/);
  return hostMatch ? hostMatch[0] : null;
}

/**
 * Fail-closed validation of the production migration connection environment.
 * Runs inside `vercel env run --environment=production`, which injects Vercel
 * secret variables directly into this process; nothing is written to disk.
 *
 * Rules:
 * - DIRECT_URL is mandatory for migrations and must be scheme-valid and a
 *   direct (non-pooled) host — the pooled endpoint is not acceptable for
 *   Prisma migration sessions.
 * - DATABASE_URL is mandatory because it remains the application runtime
 *   connection; it must be scheme-valid (pooling is fine for runtime).
 *
 * Diagnostics are sanitized: never the URL, username, password, database
 * path or query string — only the hostname where it was safely extractable.
 */
export function validateMigrationEnv(env = process.env) {
  const failures = [];
  const directUrl = (env.DIRECT_URL ?? "").trim();
  const databaseUrl = (env.DATABASE_URL ?? "").trim();

  if (!directUrl) {
    failures.push(
      "DIRECT_URL is missing; production migrations require an explicit direct (non-pooled) connection",
    );
  } else if (!PROTOCOL_PATTERN.test(directUrl)) {
    failures.push("DIRECT_URL must start with the protocol postgresql:// or postgres://");
  } else {
    const host = safeHost(directUrl);
    if (host === null) {
      failures.push("DIRECT_URL is not a valid connection URL");
    } else if (host.includes("-pooler")) {
      failures.push(
        `DIRECT_URL host '${host}' is a pooled endpoint; migrations must use the direct endpoint`,
      );
    }
  }

  if (!databaseUrl) {
    failures.push("DATABASE_URL is missing; it remains the application runtime connection");
  } else if (!PROTOCOL_PATTERN.test(databaseUrl)) {
    failures.push("DATABASE_URL must start with the protocol postgresql:// or postgres://");
  }

  return { ok: failures.length === 0, failures };
}

function main() {
  const result = validateMigrationEnv(process.env);
  for (const failure of result.failures) {
    console.error(`migration-env: ${failure}`);
  }
  if (result.ok) {
    console.log(
      "migration-env: DIRECT_URL and DATABASE_URL validated (scheme ok; DIRECT_URL is a direct, non-pooled host)",
    );
  }
  process.exit(result.ok ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main();
}
