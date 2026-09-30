import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAgentWorkspaceEnabled, isAgentWorkspaceEnabled } from "./rollout";

test("production onboarding is restricted to the explicit workspace cohort", () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { flag: env.ENABLE_AGENT_ONBOARDING, cohort: env.AGENT_ONBOARDING_WORKSPACE_IDS, nodeEnv: env.NODE_ENV };
  try {
    env.NODE_ENV = "production";
    env.ENABLE_AGENT_ONBOARDING = "1";
    delete env.AGENT_ONBOARDING_WORKSPACE_IDS;
    assert.equal(isAgentWorkspaceEnabled("pilot"), false);
    env.AGENT_ONBOARDING_WORKSPACE_IDS = " pilot , second ";
    assert.equal(isAgentWorkspaceEnabled("pilot"), true);
    assert.equal(isAgentWorkspaceEnabled("second"), true);
    assert.equal(isAgentWorkspaceEnabled("other"), false);
    assert.throws(() => assertAgentWorkspaceEnabled("other"), { code: "not_found", status: 404 });
    env.ENABLE_AGENT_ONBOARDING = "0";
    assert.equal(isAgentWorkspaceEnabled("pilot"), false);
    env.NODE_ENV = "test";
    env.ENABLE_AGENT_ONBOARDING = "1";
    delete env.AGENT_ONBOARDING_WORKSPACE_IDS;
    assert.equal(isAgentWorkspaceEnabled("fixture"), true);
  } finally {
    for (const [key, value] of [["ENABLE_AGENT_ONBOARDING", before.flag], ["AGENT_ONBOARDING_WORKSPACE_IDS", before.cohort], ["NODE_ENV", before.nodeEnv]] as const) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});
