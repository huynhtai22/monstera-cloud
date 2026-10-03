import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("CI scopes the resilience database opt-in to Node tests only", () => {
  const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const jobEnv = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
  const nodeTests = workflow.slice(workflow.indexOf("      - name: Run Node tests"), workflow.indexOf("      - name: Production build"));
  const build = workflow.slice(workflow.indexOf("      - name: Production build"), workflow.indexOf("      - name: Install Playwright browser"));
  const browser = workflow.slice(workflow.indexOf("      - name: Full browser QA journeys"));
  assert.doesNotMatch(jobEnv, /CONNECTOR_RESILIENCE_TEST_DB/);
  assert.match(nodeTests, /CONNECTOR_RESILIENCE_TEST_DB: "1"/);
  assert.doesNotMatch(build, /CONNECTOR_RESILIENCE_TEST_DB/);
  assert.doesNotMatch(browser, /CONNECTOR_RESILIENCE_TEST_DB/);
});

test("CI scopes governed analyst feature flags to isolated E2E build and browser steps only", () => {
  const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  const deploy = readFileSync(resolve(process.cwd(), ".github/workflows/deploy.yml"), "utf8");
  const jobEnv = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
  const migrations = workflow.slice(workflow.indexOf("      - name: Validate and apply migrations"), workflow.indexOf("      - run: npm run typecheck"));
  const nodeTests = workflow.slice(workflow.indexOf("      - name: Run Node tests"), workflow.indexOf("      - name: Production build"));
  const build = workflow.slice(workflow.indexOf("      - name: Production build"), workflow.indexOf("      - name: Install Playwright browser"));
  const browser = workflow.slice(workflow.indexOf("      - name: Full browser QA journeys"), workflow.indexOf("      - run: npm audit"));
  const audit = workflow.slice(workflow.indexOf("      - run: npm audit"));

  // Not at broad job or workflow scope
  assert.doesNotMatch(jobEnv, /NEXT_PUBLIC_ENABLE_GOVERNED_ANALYST/);
  assert.doesNotMatch(jobEnv, /ENABLE_GOVERNED_ANALYST/);

  // Not present in migrations, unit tests, or audit
  assert.doesNotMatch(migrations, /ENABLE_GOVERNED_ANALYST/);
  assert.doesNotMatch(nodeTests, /ENABLE_GOVERNED_ANALYST/);
  assert.doesNotMatch(audit, /ENABLE_GOVERNED_ANALYST/);

  // Present strictly in the E2E build step and browser test step
  assert.match(build, /NEXT_PUBLIC_ENABLE_GOVERNED_ANALYST: "1"/);
  assert.doesNotMatch(build, /(?<!NEXT_PUBLIC_)ENABLE_GOVERNED_ANALYST/);
  assert.match(browser, /ENABLE_GOVERNED_ANALYST: "1"/);

  // Production deploy workflow must never carry either flag
  assert.doesNotMatch(deploy, /NEXT_PUBLIC_ENABLE_GOVERNED_ANALYST/);
  assert.doesNotMatch(deploy, /ENABLE_GOVERNED_ANALYST/);
});
