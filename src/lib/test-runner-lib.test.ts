import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { applyChildOutcome, createTestPlan, runPlan } from "../../scripts/test-runner-lib.mjs";

const nonPostgres = resolve("src/lib/example.test.ts");
const postgres = resolve("src/lib/example.pg.integration.test.ts");
const tests = [postgres, nonPostgres];

describe("test runner planning and child-status semantics", () => {
  it("creates the normal parallel then bounded-PostgreSQL phases", () => {
    assert.deepEqual(createTestPlan([], tests), [
      { name: "non-postgres", args: ["--test", nonPostgres] },
      { name: "postgres", args: ["--test", "--test-concurrency=4", postgres] },
    ]);
  });

  it("runs explicit non-PostgreSQL and PostgreSQL files exactly once in their own phases", () => {
    assert.deepEqual(createTestPlan([nonPostgres, postgres], tests), [
      { name: "non-postgres", args: ["--test", nonPostgres] },
      { name: "postgres", args: ["--test", "--test-concurrency=4", postgres] },
    ]);
  });

  it("runs one explicit non-PostgreSQL file only in the non-PostgreSQL phase", () => {
    assert.deepEqual(createTestPlan([nonPostgres], tests), [
      { name: "non-postgres", args: ["--test", nonPostgres] },
    ]);
  });

  it("runs one explicit PostgreSQL file only in the bounded PostgreSQL phase", () => {
    assert.deepEqual(createTestPlan([postgres], tests), [
      { name: "postgres", args: ["--test", "--test-concurrency=4", postgres] },
    ]);
  });

  it("forwards flags and their values without treating values as test paths", () => {
    assert.deepEqual(createTestPlan(["--test-name-pattern", "freshness", nonPostgres], tests), [
      { name: "non-postgres", args: ["--test", "--test-name-pattern", "freshness", nonPostgres] },
    ]);
    assert.deepEqual(createTestPlan(["--test-reporter", "spec", nonPostgres], tests), [
      { name: "non-postgres", args: ["--test", "--test-reporter", "spec", nonPostgres] },
    ]);
  });

  it("uses help directly instead of starting either test phase", () => {
    assert.deepEqual(createTestPlan(["--help"], tests), [{ name: "help", args: ["--help"] }]);
  });

  it("rejects explicit files outside the established source test set", () => {
    assert.throws(() => createTestPlan(["src/elsewhere.test.ts"], tests), /outside the established src test set/);
  });

  it("keeps a path containing spaces as one argv element", () => {
    const spaced = resolve("src/lib/space dir/example.test.ts");
    const [phase] = createTestPlan([spaced], [spaced]);
    assert.equal(phase.args.at(-1), spaced);
  });

  it("stops after a failed first phase", async () => {
    const calls: string[] = [];
    const result = await runPlan(createTestPlan([], tests), async (_args: string[], name: string) => {
      calls.push(name);
      return { code: 7, signal: null };
    });
    assert.deepEqual(calls, ["non-postgres"]);
    assert.deepEqual(result, { code: 7, signal: null });
  });

  it("preserves numeric exit codes and signal termination semantics", () => {
    const failed: { exitCode?: number; platform: string } = { platform: "linux" };
    applyChildOutcome({ code: 7, signal: null }, failed);
    assert.equal(failed.exitCode, 7);

    const signalled: { exitCode?: number; platform: string; pid: number; kill: (pid: number, signal: string) => void } = {
      platform: "linux", pid: 123, kill(pid, signal) { assert.equal(pid, 123); assert.equal(signal, "SIGTERM"); },
    };
    applyChildOutcome({ code: null, signal: "SIGTERM" }, signalled);
    assert.equal(signalled.exitCode, undefined);
  });
});
