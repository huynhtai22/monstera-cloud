/**
 * A Prisma P1002 is retried only when its diagnostic explicitly identifies the
 * migration advisory lock. All other migration, connection, and drift errors
 * remain terminal so a retry cannot conceal a real release problem.
 */
export function isPrismaAdvisoryLockTimeout(output) {
  const text = String(output ?? "");
  return /\bP1002\b/i.test(text) && /(?:SELECT\s+)?pg_advisory_lock\s*\(/i.test(text);
}

export async function runMigrationDeployWithRetry(run, options = {}) {
  const maxAttempts = options.maxAttempts ?? 2;
  const delayMs = options.delayMs ?? 5_000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let result;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await run();
    if (result.status === 0) return result;

    const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
    if (attempt === maxAttempts || !isPrismaAdvisoryLockTimeout(output)) return result;

    console.warn(
      `Prisma migration advisory lock timed out (P1002); retrying once in ${delayMs}ms after the active deployment releases it.`,
    );
    await sleep(delayMs);
  }

  return result;
}
