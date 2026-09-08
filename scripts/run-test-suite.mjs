import { spawn } from "node:child_process";
import { createTestPlan, findTests, runPlan, applyChildOutcome } from "./test-runner-lib.mjs";

let activeChild = null;

function runTsx(args) {
  const executable = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return new Promise((resolveRun) => {
    const child = spawn(executable, args, { stdio: "inherit", detached: process.platform !== "win32" });
    activeChild = child;
    child.once("error", (error) => resolveRun({ code: 1, signal: null, error }));
    child.on("exit", (code, signal) => {
      if (activeChild === child) activeChild = null;
      resolveRun({ code, signal });
    });
  });
}

function forwardSignal(signal) {
  if (!activeChild?.pid) {
    process.removeListener(signal, forwardSignal);
    process.kill(process.pid, signal);
    return;
  }
  try {
    if (process.platform !== "win32") process.kill(-activeChild.pid, signal);
    else activeChild.kill(signal);
  } catch {
    activeChild.kill(signal);
  }
}

process.on("SIGINT", forwardSignal);
process.on("SIGTERM", forwardSignal);

try {
  const tests = (await findTests("src")).sort();
  const plan = createTestPlan(process.argv.slice(2), tests);
  const result = await runPlan(plan, runTsx);
  applyChildOutcome(result);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", forwardSignal);
  process.removeListener("SIGTERM", forwardSignal);
}
