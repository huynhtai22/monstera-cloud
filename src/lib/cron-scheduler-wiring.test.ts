import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const REPO_ROOT = path.join(__dirname, "..", "..");

/**
 * The retention cleanup route must be reachable by the deployment
 * scheduler using the existing authenticated cron pattern — never an
 * unauthenticated path.
 */
describe("cron scheduler wiring", () => {
  it("pilot-cron schedules the connector-artifacts cleanup", () => {
    const workflow = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "pilot-cron.yml"), "utf8");
    assert.ok(
      workflow.includes("/api/cron/connector-artifacts-cleanup"),
      "pilot-cron.yml must curl the cleanup route",
    );
  });

  it("the cleanup route requires the shared cron secret", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "src", "app", "api", "cron", "connector-artifacts-cleanup", "route.ts"),
      "utf8",
    );
    assert.ok(source.includes("requireCronSecret"), "cleanup route must gate on requireCronSecret");
  });
});
