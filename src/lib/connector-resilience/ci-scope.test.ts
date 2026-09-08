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
