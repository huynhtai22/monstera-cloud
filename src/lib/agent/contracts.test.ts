import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkProfileSchema, CreateRunSchema, MessageSchema, AgentError } from "./contracts";
import { assertTaskTransition } from "./tasks";
import { agentErrorResponse, agentJson, agentUserId } from "./http";

describe("agent persistence contracts", () => {
  it("supports all six work categories and a deliberate skip without role fields", () => {
    for (const category of ["BUSINESS_OWNER", "GROWTH_MARKETER", "AGENCY_CONSULTANT", "ECOMMERCE_SELLER", "OPERATIONS_ANALYST", "OTHER", null]) assert.equal(WorkProfileSchema.parse({ category }).category, category);
    assert.equal(WorkProfileSchema.safeParse({ category: "OTHER", platformRole: "OPERATOR" }).success, false);
    assert.equal(WorkProfileSchema.safeParse({ category: null, context: "x".repeat(501) }).success, false);
  });
  it("rejects unsupported run kinds, injected states and oversized messages", () => {
    assert.equal(CreateRunSchema.safeParse({ kind: "onboarding", workspaceId: "w", status: "completed" }).success, false);
    assert.equal(CreateRunSchema.safeParse({ kind: "budget_write", workspaceId: "w" }).success, false);
    assert.equal(MessageSchema.safeParse({ messageId: "m", text: "x".repeat(4001), expectedVersion: 0 }).success, false);
  });
  it("rejects skipped execution stages and changes to ready tasks", () => {
    assertTaskTransition("waiting_authorization", "needs_attention");
    assertTaskTransition("importing", "verifying");
    assert.throws(() => assertTaskTransition("waiting_authorization", "ready"), /Cannot move/);
    assert.throws(() => assertTaskTransition("ready", "importing"), /Cannot move/);
  });
  it("hides internal errors and returns actionable version conflicts", async () => {
    const internal = agentErrorResponse(new Error("secret database information"));
    assert.equal(internal.status, 500);
    assert.equal((await internal.text()).includes("secret"), false);
    const stale = agentErrorResponse(new AgentError("stale_version", "Refresh", 409, 7));
    assert.deepEqual(await stale.json(), { code: "stale_version", message: "Refresh", retryable: true, currentVersion: 7 });
    await assert.rejects(() => agentJson(new Request("http://localhost", { method: "POST", body: "{" })), /Invalid JSON/);
  });
  it("keeps new routes disabled by default, including in development", async () => {
    const previous = process.env.ENABLE_AGENT_ONBOARDING;
    try { delete process.env.ENABLE_AGENT_ONBOARDING; await assert.rejects(agentUserId, (e: unknown) => e instanceof AgentError && e.status === 404); }
    finally { if (previous === undefined) delete process.env.ENABLE_AGENT_ONBOARDING; else process.env.ENABLE_AGENT_ONBOARDING = previous; }
  });
});
