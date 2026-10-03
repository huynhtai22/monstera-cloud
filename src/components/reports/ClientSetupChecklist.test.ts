import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ClientSetupChecklist } from "./ClientSetupChecklist";
import {
  clientSetupHref,
  deriveClientSetupState,
  type ClientSetupState,
} from "../../lib/client-setup-checklist";
import type { ChecklistEvaluationInput } from "../../lib/client-setup-checklist";

const WORKSPACE = "ws-setup-1";
const CLIENT = "client-setup-1";

function readyEvaluation(): ChecklistEvaluationInput {
  return {
    workspaceId: WORKSPACE,
    clientId: CLIENT,
    status: "READY",
    dataStatus: "READY",
    dataBlockers: [],
    dataWarnings: [],
    blockers: [],
    warnings: [],
    requiredProviders: ["meta_ads"],
    requiredProvidersBasis: "explicit",
    providers: [],
    destination: { state: "verified", configuredCount: 1, required: ["google_sheets"], receipts: [] },
    currencies: ["USD"],
    timezones: ["Asia/Ho_Chi_Minh"],
  };
}

function setupState(overrides: Record<string, unknown> = {}): ClientSetupState {
  const result = deriveClientSetupState({
    workspaceId: WORKSPACE,
    clientId: CLIENT,
    clientName: "Setup Test Client",
    role: "member",
    canEdit: false,
    canManageAssignments: true,
    requirements: { providers: [], destinations: [], configuredAt: null },
    discovery: { status: "ready", accounts: [] },
    configurationAccounts: [],
    evaluation: null,
    ...overrides,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture derivation failed");
  return result.state;
}

function render(state: ClientSetupState): string {
  return renderToStaticMarkup(h(ClientSetupChecklist, { state }));
}

describe("guided client setup checklist component", () => {
  it("contract 2: an admin receives the existing configuration controls", () => {
    const markup = render(setupState({ role: "admin", canEdit: true }));
    assert.ok(
      /Configure reporting evidence|Close reporting configuration/.test(markup),
      "admin must see the existing configuration control",
    );
  });

  it("contract 3: a member sees requirements but not admin mutation controls", () => {
    const markup = render(setupState({
      role: "member",
      canEdit: false,
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
    }));
    assert.ok(markup.includes("Meta Ads"), "member must see configured requirements");
    assert.ok(!markup.includes("Configure reporting evidence"), "member must not see admin configuration controls");
    assert.ok(!markup.includes("Save requirements"), "member must not see admin mutation controls");
    assert.ok(/owner or admin/i.test(markup), "member must learn an admin action is needed");
  });

  it("contract 4: a viewer receives no mutation controls", () => {
    const markup = render(setupState({ role: "viewer", canEdit: false }));
    assert.ok(!markup.includes("<button"), "viewer must receive no buttons");
    assert.ok(!markup.includes("<form"), "viewer must receive no forms");
    assert.ok(!markup.includes("Save"), "viewer must receive no save controls");
    assert.ok(markup.includes("/reports?clientId="), "viewer keeps a read-only report link");
  });

  it("contract 12: requirements_not_configured links to the exact client setup section", () => {
    const markup = render(setupState({ role: "admin", canEdit: true }));
    const expected = clientSetupHref(CLIENT);
    assert.equal(expected, `/clients?clientId=${CLIENT}#reporting-setup`);
    assert.ok(markup.includes(`href="${expected}"`), "checklist must link to the exact client setup section");
  });

  it("contract 13: no unsupported account picker is rendered for marketplace providers", () => {
    const markup = render(setupState({
      role: "member",
      canEdit: false,
      requirements: { providers: ["shopee", "lazada"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovered: [
        { provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["conn-shopee-1"] },
      ],
    }));
    assert.ok(!markup.includes("<select"), "no account picker dropdown may render");
    assert.ok(!markup.includes("account picker"), "no account picker copy may render");
    assert.ok(/connection/i.test(markup), "marketplace resolution through the connection must be explained");
  });

  it("contract 14: rendered checklist introduces no hard-coded business KPIs", () => {
    const markup = render(setupState({
      role: "admin",
      canEdit: true,
      requirements: { providers: ["meta_ads", "google_ads", "tiktok_business", "shopee", "lazada"], destinations: ["google_sheets", "looker_studio"], configuredAt: "2026-09-01T00:00:00.000Z" },
    }));
    assert.doesNotMatch(markup, /\b(spend|revenue|gmv|roas|pacing|cpl|mrr|conversion|conversions|leads?)\b/i);
  });

  it("contract 15: checklist uses semantic structure that names the client", () => {
    const markup = render(setupState({ role: "member", canEdit: false }));
    assert.ok(markup.includes("<section"), "checklist must render a section landmark");
    assert.ok(markup.includes("Setup Test Client"), "state must identify which client it belongs to");
    assert.ok(markup.includes("<h3") || markup.includes("<h4"), "checklist must use headings");
    assert.ok(markup.includes("<ul") || markup.includes("<ol"), "checklist must use lists");
    assert.ok(markup.includes("Waiting for admin"), "state must be text, not color alone");
  });

  it("contract 17: viewing the checklist triggers no network calls", () => {
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = () => {
      throw new Error("network call during checklist view");
    };
    try {
      const adminMarkup = render(setupState({ role: "admin", canEdit: true }));
      assert.ok(adminMarkup.includes("reporting-setup"));
      const memberMarkup = render(setupState({ role: "member", canEdit: false }));
      assert.ok(memberMarkup.includes("reporting-setup"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("guided setup marketplace wording and recovery focus", () => {
  const shopeeConfigured = {
    role: "admin",
    canEdit: true,
    requirements: { providers: ["shopee"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
    discovered: [{ provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["conn-shopee-1"] }],
  };

  it("marketplace row keeps account completeness and states Blueprint non-verification", () => {
    const markup = render(setupState(shopeeConfigured));
    assert.ok(markup.includes("Complete"), "account setup stays complete");
    assert.ok(
      markup.includes("Weekly Blueprint v1 does not currently verify this provider"),
      "row must state non-verification",
    );
    assert.ok(!markup.includes("<select"), "no marketplace account picker appears");
  });

  it("paid-media rows receive no unsupported qualifier", () => {
    const markup = render(setupState({
      role: "admin",
      canEdit: true,
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovered: [{ provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["c1"] }],
    }));
    assert.ok(!markup.includes("does not currently verify"), "ads rows must stay unqualified");
    assert.ok(markup.includes("Setup is sufficient to generate a Weekly Performance Blueprint."));
  });

  it("summary cannot imply verified-Blueprint readiness for required marketplace providers", () => {
    const markup = render(setupState(shopeeConfigured));
    assert.ok(!markup.includes("Setup is sufficient to generate a Weekly Performance Blueprint."));
    assert.ok(markup.includes("Weekly Blueprint v1 cannot verify the required marketplace provider"));
  });

  it("checklist target is programmatically focusable and names the client", () => {
    const markup = render(setupState({ role: "member", canEdit: false }));
    assert.ok(markup.includes('id="reporting-setup"'), "anchor target must exist");
    assert.ok(markup.includes('tabindex="-1"'), "anchor target must be programmatically focusable");
    assert.ok(markup.includes('aria-label="Reporting setup for Setup Test Client"'));
  });

  it("member and viewer behavior is unchanged by the focus work", () => {
    const memberMarkup = render(setupState({ role: "member", canEdit: false }));
    assert.ok(memberMarkup.includes("Waiting for admin"));
    assert.ok(!memberMarkup.includes("Configure reporting evidence"));
    const viewerMarkup = render(setupState({ role: "viewer", canEdit: false }));
    assert.ok(!viewerMarkup.includes("<button"));
    assert.ok(viewerMarkup.includes("/reports?clientId="));
  });
});

describe("guided setup remediation: actionable permissions and async discovery", () => {
  const memberMissingAssignment = {
    role: "member",
    canEdit: false,
    canManageAssignments: true,
    requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
    discovery: { status: "ready", accounts: [] },
  };

  it("remediation 1: member sees Action required with the Sources link for assignments", () => {
    const markup = render(setupState(memberMissingAssignment));
    assert.ok(markup.includes("Action required"), "assignment step must read actionable for members");
    assert.ok(markup.includes("/sources?"), "member keeps the authorized Sources recovery link");
    assert.ok(!markup.includes("Configure reporting evidence"), "member still gets no requirements controls");
  });

  it("remediation 3: member still waits for admin on requirements", () => {
    const markup = render(setupState({ role: "member", canEdit: false, canManageAssignments: true }));
    assert.ok(markup.includes("Waiting for admin"));
  });

  it("remediation 4: viewer receives no assignment or configuration mutation link", () => {
    const markup = render(setupState({
      role: "viewer",
      canEdit: false,
      canManageAssignments: false,
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [] },
    }));
    assert.ok(!markup.includes("/sources?"), "viewer must receive no assignment link");
    assert.ok(!markup.includes("Configure reporting evidence"), "viewer must receive no configuration control");
    assert.ok(markup.includes("/reports?clientId="), "viewer keeps the read-only report link");
  });

  it("remediation 7: loading discovery renders a checking state without provider rows", () => {
    const markup = render(setupState({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "loading", accounts: [] },
    }));
    assert.ok(markup.toLowerCase().includes("checking"), "loading state must be visible");
    assert.ok(!markup.includes("Missing assignments"), "no false missing-assignment verdict while loading");
    assert.ok(!markup.includes('aria-label="Meta Ads for'), "no provider rows until discovery succeeds");
  });

  it("remediation 8/9: discovery error renders retry guidance without missing assignments", () => {
    const markup = render(setupState({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "error", accounts: [] },
    }));
    assert.ok(!markup.includes("Missing assignments"), "error must not read as missing assignments");
    assert.match(markup, /unavailable|retry/i);
  });

  it("remediation 17: stale readiness renders rechecking copy in data sections", () => {
    const markup = render(setupState({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [] },
      evaluation: readyEvaluation(),
      evaluationStale: true,
    }));
    assert.match(markup, /recheck/i);
  });
});
