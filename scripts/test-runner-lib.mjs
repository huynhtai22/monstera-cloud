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

// Node 22.23.2 and tsx options that consume the following argv element. Keep
// this explicit: a value can legitimately look like a test filename.
const VALUE_OPTIONS = new Set([
  "-C",
  "-r",
  "--conditions",
  "--env-file",
  "--env-file-if-exists",
  "--experimental-loader",
  "--experimental-test-isolation",
  "--import",
  "--loader",
  "--require",
  "--test-concurrency",
  "--test-coverage-branches",
  "--test-coverage-exclude",
  "--test-coverage-functions",
  "--test-coverage-include",
  "--test-coverage-lines",
  "--test-name-pattern",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-shard",
  "--test-skip-pattern",
  "--test-timeout",
  "--tsconfig",
]);

const BOOLEAN_OPTIONS = new Set([
  "-h",
  "-v",
  "--enable-source-maps",
  "--experimental-test-coverage",
  "--experimental-test-module-mocks",
  "--help",
  "--no-cache",
  "--test",
  "--test-force-exit",
  "--test-only",
  "--test-update-snapshots",
  "--version",
  "--watch",
]);

function parseArguments(argv, available, cwd) {
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
      if (VALUE_OPTIONS.has(value)) {
        if (index + 1 >= argv.length) throw new Error(`Option ${value} requires a value`);
        flags.push(argv[++index]);
      } else if (!value.includes("=") && !BOOLEAN_OPTIONS.has(value) && index + 1 < argv.length && !argv[index + 1].startsWith("-")) {
        throw new Error(`Unknown option ${value} has an ambiguous separate value; use ${value}=...`);
      }
      continue;
    }
    const file = resolve(cwd, value);
    if (available.has(file)) {
      files.push(file);
    } else if (value.endsWith(".test.ts")) {
      throw new Error(`Test file is outside the established src test set: ${file}`);
    } else {
      throw new Error(`Unsupported test selector: ${value}`);
    }
  }
  return { flags, files };
}

/** Creates deterministic tsx invocations without spawning a process. */
export function createTestPlan(argv, discoveredTests, cwd = process.cwd()) {
  const available = new Set(discoveredTests.map((file) => resolve(file)));
  const { flags, files } = parseArguments(argv, available, cwd);
  if (flags.includes("--help") || flags.includes("-h")) {
    return [{ name: "help", args: flags }];
  }

  const selected = files.length
    ? [...new Set(files)].sort()
    : [...available].sort();

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
