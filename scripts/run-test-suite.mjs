import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const sourceRoot = resolve("src");

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(file);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [file] : [];
  }));
  return files.flat();
}

function runTsx(args) {
  const executable = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { stdio: "inherit" });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`tsx exited with ${signal ?? code}`));
    });
  });
}

const tests = (await findTests(sourceRoot)).sort();
const postgresTests = tests.filter((file) => file.endsWith(".pg.integration.test.ts"));
const unitTests = tests.filter((file) => !file.endsWith(".pg.integration.test.ts"));

// The unit suite remains fully parallel. PostgreSQL integration files share one
// disposable service, so cap only that group to prevent fixture setup and
// interactive transactions from starving each other under file-level fan-out.
await runTsx(["--test", ...unitTests]);
await runTsx(["--test", "--test-concurrency=4", ...postgresTests]);
