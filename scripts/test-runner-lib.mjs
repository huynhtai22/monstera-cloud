import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(file);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [file] : [];
  }));
  return files.flat();
}

function parseArguments(argv) {
  const flags = [];
  const files = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (!positionalOnly && value === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && value.startsWith("-")) {
      flags.push(value);
      const next = argv[index + 1];
      // Node options that take a separate value are not exhaustively stable
      // across releases. Preserve any following non-option, non-test value so
      // it cannot be mistaken for an explicit file selector.
      if (!value.includes("=") && next && !next.startsWith("-") && !next.endsWith(".test.ts")) {
        const flagValue = argv[++index];
        flags.push(flagValue);
      }
      continue;
    }
    if (!value.endsWith(".test.ts")) {
      throw new Error(`Unsupported test selector: ${value}`);
    }
    files.push(value);
  }
  return { flags, files };
}

/** Creates deterministic tsx invocations without spawning a process. */
export function createTestPlan(argv, discoveredTests, cwd = process.cwd()) {
  const { flags, files } = parseArguments(argv);
  if (flags.includes("--help") || flags.includes("-h")) {
    return [{ name: "help", args: flags }];
  }

  const available = new Set(discoveredTests.map((file) => resolve(file)));
  const selected = files.length
    ? [...new Set(files.map((file) => resolve(cwd, file)))].sort()
    : [...available].sort();
  for (const file of selected) {
    if (!available.has(file)) throw new Error(`Test file is outside the established src test set: ${file}`);
  }

  const nonPostgres = selected.filter((file) => !file.endsWith(".pg.integration.test.ts"));
  const postgres = selected.filter((file) => file.endsWith(".pg.integration.test.ts"));
  const plan = [];
  if (nonPostgres.length) plan.push({ name: "non-postgres", args: ["--test", ...flags, ...nonPostgres] });
  if (postgres.length) plan.push({ name: "postgres", args: ["--test", "--test-concurrency=4", ...flags, ...postgres] });
  return plan;
}

/** Runs phases in order and stops immediately after the first unsuccessful child. */
export async function runPlan(plan, execute) {
  for (const phase of plan) {
    const result = await execute(phase.args, phase.name);
    if (result.code !== 0 || result.signal) return result;
  }
  return { code: 0, signal: null };
}

export function signalFallback(signal) {
  return ({ SIGINT: 130, SIGTERM: 143 })[signal] ?? 1;
}

/** Applies a child outcome to the parent without converting statuses to generic 1. */
export function applyChildOutcome(result, runtime) {
  runtime ??= process;
  if (result.code !== null && result.code !== undefined) {
    runtime.exitCode = result.code;
    return;
  }
  if (!result.signal) {
    runtime.exitCode = 1;
    return;
  }
  if (runtime.platform !== "win32" && typeof runtime.kill === "function") {
    runtime.kill(runtime.pid, result.signal);
    return;
  }
  runtime.stderr?.write?.(`Test child ended with ${result.signal}; using exit ${signalFallback(result.signal)} on this platform.\n`);
  runtime.exitCode = signalFallback(result.signal);
}
