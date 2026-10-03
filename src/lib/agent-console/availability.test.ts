import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAgentConsoleMonitoringAvailable,
  isAgentConsoleMonitoringRuntimeAvailable,
} from "./availability";

describe("agent console monitoring availability", () => {
  it("requires both the monitoring capability and its scheduled worker", () => {
    assert.equal(isAgentConsoleMonitoringAvailable("ws-a", { ENABLE_AGENT_CONSOLE_MONITORING: "1", ENABLE_AGENT_CONSOLE_WORKER: "1" }), true);
    assert.equal(isAgentConsoleMonitoringAvailable("ws-a", { ENABLE_AGENT_CONSOLE_MONITORING: "1", ENABLE_AGENT_CONSOLE_WORKER: "0" }), false);
    assert.equal(isAgentConsoleMonitoringAvailable("ws-a", { ENABLE_AGENT_CONSOLE_MONITORING: "0", ENABLE_AGENT_CONSOLE_WORKER: "1" }), false);
    assert.equal(isAgentConsoleMonitoringAvailable("ws-a", {}), false);
  });

  it("requires a production cohort and rejects workspaces outside it", () => {
    const enabled = {
      NODE_ENV: "production",
      ENABLE_AGENT_CONSOLE_MONITORING: "1",
      ENABLE_AGENT_CONSOLE_WORKER: "1",
    };
    assert.equal(isAgentConsoleMonitoringRuntimeAvailable(enabled), false);
    assert.equal(isAgentConsoleMonitoringAvailable("ws-a", enabled), false);
    assert.equal(isAgentConsoleMonitoringAvailable("ws-a", {
      ...enabled,
      AGENT_CONSOLE_WORKSPACE_IDS: "ws-a, ws-b",
    }), true);
    assert.equal(isAgentConsoleMonitoringAvailable("ws-c", {
      ...enabled,
      AGENT_CONSOLE_WORKSPACE_IDS: "ws-a, ws-b",
    }), false);
  });
});
