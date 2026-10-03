import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SETUP_SECTION_ANCHOR,
  SETUP_STATE_LABELS,
  clientSetupHref,
  deriveClientSetupState,
  isSetupFocusFragment,
  readinessRequestKey,
  type ChecklistDiscoveredInput,
  type ChecklistEvaluationInput,
  type DeriveClientSetupInput,
  type DiscoveryStateInput,
} from "./client-setup-checklist";
import { READINESS_MESSAGES } from "./report-readiness";

const WORKSPACE = "ws-setup-1";
const CLIENT = "client-setup-1";

function evaluationFixture(overrides: Partial<ChecklistEvaluationInput> = {}): ChecklistEvaluationInput {
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
    providers: [
      {
        connectionId: "conn-meta-1",
        provider: "meta_ads",
        status: "READY",
        health: "fresh",
        latestSuccessfulSyncAt: "2026-09-10T00:00:00.000Z",
        latestDataDate: "2026-09-10",
        freshness: "fresh",
        currencies: ["USD"],
        timezone: "Asia/Ho_Chi_Minh",
        blockers: [],
        warnings: [],
        evidence: {
          rowCount: 7,
          expectedDays: 7,
          accounts: [{ accountId: "act_1", health: "healthy", presentDays: 7, missingDates: [] }],
          syncs: [{ id: "s1", kind: "import", target: "act_1", at: "2026-09-10T00:00:00.000Z", status: "success" }],
        },
      },
    ],
    destination: { state: "verified", configuredCount: 1, required: ["google_sheets"], receipts: [{ id: "r1", destination: "google_sheets", retrievedAt: "2026-09-10T01:00:00.000Z", dataThroughDate: "2026-09-10", current: true }] },
    currencies: ["USD"],
    timezones: ["Asia/Ho_Chi_Minh"],
    ...overrides,
  };
}

function baseInput(overrides: Partial<DeriveClientSetupInput> = {}): DeriveClientSetupInput {
  return {
    workspaceId: WORKSPACE,
    clientId: CLIENT,
    clientName: "Setup Test Client",
    role: "admin",
    canEdit: true,
    requirements: { providers: [], destinations: [], configuredAt: null },
    canManageAssignments: true,
    discovery: { status: "ready", accounts: [] },
    configurationAccounts: [] as Array<{ connectionId: string; accountId: string; hasOverride: boolean }>,
    evaluation: null,
    ...overrides,
  };
}

describe("guided client setup checklist state derivation", () => {
  it("contract 1: a client with no configured requirements shows Action required", () => {
    const result = deriveClientSetupState(baseInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.sections.requirements.state, "action-required");
    assert.equal(SETUP_STATE_LABELS["action-required"], "Action required");
    assert.equal(result.state.requirementsConfigured, false);
    assert.equal(result.state.generationBlocked, true);
  });

  it("contract 12: requirements_not_configured recovery links to the exact client setup section", () => {
    assert.equal(SETUP_SECTION_ANCHOR, "reporting-setup");
    assert.equal(clientSetupHref(CLIENT), `/clients?clientId=${CLIENT}#reporting-setup`);
    const result = deriveClientSetupState(baseInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.recoveryHref, `/clients?clientId=${CLIENT}#reporting-setup`);
    assert.equal(result.state.sections.requirements.recovery?.href, `/clients?clientId=${CLIENT}#reporting-setup`);
  });

  it("contract 5 + 16: configured required providers appear and unblock generation", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads", "google_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.requirementsConfigured, true);
    assert.equal(result.state.generationBlocked, false);
    assert.equal(result.state.sections.requirements.state, "complete");
    const labels = result.state.providers.map((p) => p.label).sort();
    assert.deepEqual(labels, ["Google Ads", "Meta Ads"]);
  });

  it("contract 6: missing required-provider assignments are identified", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta);
    assert.equal(meta.state, "action-required");
    assert.ok(meta.recovery?.href.includes("/sources"));
    assert.equal(result.state.sections.accounts.state, "action-required");
  });

  it("contract 7: completed account assignments appear complete", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [{ provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["conn-meta-1"] }] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta);
    assert.equal(meta.state, "complete");
    assert.equal(result.state.sections.accounts.state, "complete");
  });

  it("contract 8: unknown currency produces the existing actionable readiness message", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      evaluation: evaluationFixture({
        status: "UNKNOWN",
        dataStatus: "UNKNOWN",
        dataWarnings: [{ code: "CURRENCY_UNKNOWN", provider: "meta_ads" }],
        warnings: [{ code: "CURRENCY_UNKNOWN", provider: "meta_ads" }],
        currencies: [],
      }),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.sections.context.state, "action-required");
    assert.ok(result.state.sections.context.summary.includes(READINESS_MESSAGES.CURRENCY_UNKNOWN));
  });

  it("contract 9: unknown timezone produces the existing actionable readiness message", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      evaluation: evaluationFixture({
        status: "UNKNOWN",
        dataStatus: "UNKNOWN",
        dataWarnings: [{ code: "TIMEZONE_UNKNOWN", provider: "meta_ads" }],
        warnings: [{ code: "TIMEZONE_UNKNOWN", provider: "meta_ads" }],
        timezones: [],
      }),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.sections.context.state, "action-required");
    assert.ok(result.state.sections.context.summary.includes(READINESS_MESSAGES.TIMEZONE_UNKNOWN));
  });

  it("contract 10: destination-only warnings do not mark data configuration incomplete", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      evaluation: evaluationFixture({
        status: "WARNING",
        dataStatus: "READY",
        warnings: [{ code: "DESTINATION_UNVERIFIED" }],
        destination: { state: "unverified", configuredCount: 0, required: ["google_sheets"], receipts: [] },
      }),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.dataStatus, "READY");
    assert.equal(result.state.sections.data.state, "complete");
    assert.equal(result.state.sections.readiness.state, "complete");
  });

  it("contract 11: optional destination configuration is visibly optional", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads"], destinations: [], configuredAt: null },
      evaluation: null,
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.sections.delivery.state, "optional");
    assert.equal(SETUP_STATE_LABELS.optional, "Optional");
  });

  it("contract 13: a Shopee connection resolves without an account picker", () => {
    const result = deriveClientSetupState(baseInput({
      role: "member",
      canEdit: false,
      requirements: { providers: ["shopee"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [{ provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["conn-shopee-1"] }] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const shopee = result.state.providers.find((p) => p.provider === "shopee");
    assert.ok(shopee);
    assert.equal(shopee.discovery, "credential-resolved");
    assert.ok(shopee.detail.toLowerCase().includes("connection"));
  });

  it("contract 14: the checklist introduces no hard-coded business KPIs", () => {
    const configured = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads", "shopee", "google_ads", "tiktok_business", "lazada"], destinations: ["google_sheets", "looker_studio"], configuredAt: "2026-09-01T00:00:00.000Z" },
      evaluation: evaluationFixture({ requiredProviders: ["meta_ads", "shopee", "google_ads", "tiktok_business", "lazada"] }),
      discovery: { status: "ready", accounts: [
        { provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["c1"] },
        { provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["c2"] },
      ] },
    }));
    assert.equal(configured.ok, true);
    if (!configured.ok) return;
    const text = JSON.stringify(configured.state);
    assert.match(text, /Meta Ads/);
    assert.doesNotMatch(text, /\b(spend|revenue|gmv|roas|pacing|cpl|mrr|conversion|conversions|leads?)\b/i);
  });

  it("contract 15: cross-workspace client data is never rendered", () => {
    const result = deriveClientSetupState(baseInput({
      evaluation: evaluationFixture({ workspaceId: "ws-rival", clientId: "client-rival" }),
    }));
    assert.equal(result.ok, false);
  });

  it("contract 17: deriving checklist state performs no network calls", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = () => {
      throw new Error("network call during derivation");
    };
    try {
      const result = deriveClientSetupState(baseInput({
        requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
        evaluation: evaluationFixture(),
      }));
      assert.equal(result.ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("guided setup marketplace truthfulness and recovery focus", () => {
  const configuredShopee = {
    requirements: { providers: ["shopee"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
    discovery: { status: "ready" as const, accounts: [{ provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["conn-shopee-1"] }] },
  };

  it("truthfulness 1: a required Shopee connection stays complete for account setup", () => {
    const result = deriveClientSetupState(baseInput(configuredShopee));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const shopee = result.state.providers.find((p) => p.provider === "shopee");
    assert.ok(shopee);
    assert.equal(shopee.state, "complete");
    assert.equal(shopee.blueprintSupported, false);
  });

  it("truthfulness 2: the Shopee row states Blueprint v1 does not verify the provider", () => {
    const result = deriveClientSetupState(baseInput(configuredShopee));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const shopee = result.state.providers.find((p) => p.provider === "shopee");
    assert.ok(shopee);
    assert.ok(shopee.detail.includes("connection credentials"), "credential resolution must stay explained");
    assert.ok(
      shopee.detail.includes("Weekly Blueprint v1 does not currently verify this provider"),
      "non-verification must be stated on the row",
    );
  });

  it("truthfulness 3: required Lazada behaves equivalently", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["lazada"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [{ provider: "lazada", accountId: "seller-1", assignedClientId: CLIENT, connectionIds: ["conn-lazada-1"] }] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const lazada = result.state.providers.find((p) => p.provider === "lazada");
    assert.ok(lazada);
    assert.equal(lazada.state, "complete");
    assert.equal(lazada.blueprintSupported, false);
    assert.ok(lazada.detail.includes("Weekly Blueprint v1 does not currently verify this provider"));
  });

  it("truthfulness 4: Meta, Google and TikTok receive no unsupported qualifier", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["meta_ads", "google_ads", "tiktok_business"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [
        { provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["c1"] },
        { provider: "google_ads", accountId: "1112223333", assignedClientId: CLIENT, connectionIds: ["c2"] },
        { provider: "tiktok_business", accountId: "adv-1", assignedClientId: CLIENT, connectionIds: ["c3"] },
      ] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const provider of result.state.providers) {
      assert.equal(provider.blueprintSupported, true);
      assert.ok(!provider.detail.includes("does not currently verify"), `${provider.provider} must not be qualified`);
    }
    assert.deepEqual(result.state.unsupportedRequiredProviders, []);
  });

  it("truthfulness 5: unsupported marketplace requirements are exposed without blocking generation", () => {
    const result = deriveClientSetupState(baseInput(configuredShopee));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.generationBlocked, false);
    assert.deepEqual(result.state.unsupportedRequiredProviders, ["shopee"]);
  });

  it("truthfulness 6: an unassigned Shopee row keeps Sources recovery plus the verification note", () => {
    const result = deriveClientSetupState(baseInput({
      role: "member",
      canEdit: false,
      canManageAssignments: true,
      requirements: { providers: ["shopee"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const shopee = result.state.providers.find((p) => p.provider === "shopee");
    assert.ok(shopee);
    assert.equal(shopee.state, "action-required");
    assert.ok(shopee.detail.includes("Weekly Blueprint v1 does not currently verify this provider"));
    assert.ok(shopee.recovery?.href.includes("/sources"));
  });

  it("focus 1: only the exact checklist fragment requests focus", () => {
    assert.equal(isSetupFocusFragment("#reporting-setup"), true);
    assert.equal(isSetupFocusFragment(""), false);
    assert.equal(isSetupFocusFragment(null), false);
    assert.equal(isSetupFocusFragment(undefined), false);
    assert.equal(isSetupFocusFragment("#other-section"), false);
    assert.equal(isSetupFocusFragment("reporting-setup"), false);
  });
});

describe("guided setup remediation: permissions, discovery states, stale readiness, request keys", () => {
  const readyDiscovery = (accounts: ChecklistDiscoveredInput[] = []): DiscoveryStateInput => ({ status: "ready", accounts });
  const configuredMeta = {
    requirements: { providers: ["meta_ads"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
  };

  it("remediation 1: member with missing assignment receives an actionable assignment state", () => {
    const result = deriveClientSetupState(baseInput({
      role: "member",
      canEdit: false,
      canManageAssignments: true,
      ...configuredMeta,
      discovery: readyDiscovery([]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta);
    assert.equal(meta.state, "action-required");
    assert.equal(result.state.sections.accounts.state, "action-required");
  });

  it("remediation 2: member receives the authorized Sources link for assignments", () => {
    const result = deriveClientSetupState(baseInput({
      role: "member",
      canEdit: false,
      canManageAssignments: true,
      ...configuredMeta,
      discovery: readyDiscovery([]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta?.recovery?.href.includes("/sources"));
    assert.ok(meta?.recovery?.href.includes(CLIENT));
  });

  it("remediation 3: member still receives Waiting for admin for requirement editing", () => {
    const result = deriveClientSetupState(baseInput({
      role: "member",
      canEdit: false,
      canManageAssignments: true,
      requirements: { providers: [], destinations: [], configuredAt: null },
      discovery: readyDiscovery([]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.sections.requirements.state, "waiting-for-admin");
  });

  it("remediation 4: viewer without assignment permission waits for admin", () => {
    const result = deriveClientSetupState(baseInput({
      role: "viewer",
      canEdit: false,
      canManageAssignments: false,
      ...configuredMeta,
      discovery: readyDiscovery([]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta);
    assert.equal(meta.state, "waiting-for-admin");
    assert.equal(result.state.sections.accounts.state, "waiting-for-admin");
  });

  it("remediation 5: admin behavior is unchanged by the permission split", () => {
    const result = deriveClientSetupState(baseInput({
      role: "admin",
      canEdit: true,
      canManageAssignments: true,
      ...configuredMeta,
      discovery: readyDiscovery([]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.sections.requirements.state, "complete");
    assert.equal(result.state.sections.accounts.state, "action-required");
    const unconfigured = deriveClientSetupState(baseInput({
      role: "admin",
      canEdit: true,
      canManageAssignments: true,
      discovery: readyDiscovery([]),
    }));
    assert.equal(unconfigured.ok, true);
    if (!unconfigured.ok) return;
    assert.equal(unconfigured.state.sections.requirements.state, "action-required");
  });

  it("remediation 7: loading discovery shows no missing assignments", () => {
    const result = deriveClientSetupState(baseInput({
      ...configuredMeta,
      discovery: { status: "loading", accounts: [] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.providers.length, 0);
    assert.equal(result.state.sections.accounts.state, "needs-attention");
    assert.ok(result.state.sections.accounts.summary.toLowerCase().includes("checking"));
    assert.ok(!result.state.sections.accounts.summary.toLowerCase().includes("missing"));
  });

  it("remediation 8: discovery error shows no missing assignments", () => {
    const result = deriveClientSetupState(baseInput({
      ...configuredMeta,
      discovery: { status: "error", accounts: [] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.providers.length, 0);
    assert.equal(result.state.sections.accounts.state, "needs-attention");
    assert.ok(!result.state.sections.accounts.summary.toLowerCase().includes("missing"));
  });

  it("remediation 9: discovery error displays retry guidance", () => {
    const result = deriveClientSetupState(baseInput({
      ...configuredMeta,
      discovery: { status: "error", accounts: [] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.state.sections.accounts.summary, /unavailable|retry/i);
  });

  it("remediation 10: successful empty ads discovery shows the correct empty state", () => {
    const result = deriveClientSetupState(baseInput({
      ...configuredMeta,
      discovery: readyDiscovery([]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta);
    assert.equal(meta.state, "action-required");
    assert.ok(meta.detail.includes("No Meta Ads connection or assigned account was found"));
  });

  it("remediation 11: marketplace rows stay credential-resolved without a picker", () => {
    const result = deriveClientSetupState(baseInput({
      requirements: { providers: ["shopee"], destinations: ["google_sheets"], configuredAt: "2026-09-01T00:00:00.000Z" },
      discovery: { status: "ready", accounts: [{ provider: "shopee", accountId: "shop-1", assignedClientId: "other-client", connectionIds: ["c9"] }] },
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const shopee = result.state.providers.find((p) => p.provider === "shopee");
    assert.ok(shopee);
    assert.equal(shopee.discovery, "credential-resolved");
    assert.ok(shopee.detail.includes("connection credentials"));
  });

  it("remediation 12: client switch cannot retain prior discovery results", () => {
    const result = deriveClientSetupState(baseInput({
      clientId: "client-b",
      clientName: "Client B",
      ...configuredMeta,
      discovery: readyDiscovery([{ provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["c1"] }]),
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = result.state.providers.find((p) => p.provider === "meta_ads");
    assert.ok(meta);
    assert.equal(meta.state, "action-required");
    assert.ok(!meta.detail.includes("1 assigned account"));
  });

  it("remediation 13: late client-A response cannot populate client B", () => {
    const result = deriveClientSetupState(baseInput({
      workspaceId: WORKSPACE,
      clientId: "client-b",
      clientName: "Client B",
      ...configuredMeta,
      discovery: readyDiscovery([{ provider: "meta_ads", accountId: "act_9", assignedClientId: "client-b", connectionIds: ["c9"] }]),
      evaluation: evaluationFixture({ workspaceId: WORKSPACE, clientId: CLIENT }),
    }));
    assert.equal(result.ok, false);
  });

  it("remediation 17: stale readiness is presented as rechecking, never current", () => {
    const result = deriveClientSetupState(baseInput({
      ...configuredMeta,
      discovery: readyDiscovery([{ provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["c1"] }]),
      evaluation: evaluationFixture(),
      evaluationStale: true,
    }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const section of [result.state.sections.data, result.state.sections.context, result.state.sections.readiness]) {
      assert.equal(section.state, "needs-attention");
      assert.match(section.summary, /recheck/i);
    }
  });

  it("remediation 20: selected client plus absent dates fetches readiness with dates omitted", () => {
    const key = readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT });
    assert.equal(key, `/api/reports/readiness?${new URLSearchParams({ workspaceId: WORKSPACE, clientId: CLIENT })}`);
    assert.ok(!key.includes("start="));
  });

  it("remediation 21: explicit date pair fetches that exact window", () => {
    const key = readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT, windowStart: "2026-09-01", windowEnd: "2026-09-07" });
    assert.ok(key?.includes("start=2026-09-01"));
    assert.ok(key?.includes("end=2026-09-07"));
  });

  it("remediation 22: partial date pair fails safe without a malformed request", () => {
    assert.equal(readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT, windowStart: "2026-09-01" }), null);
    assert.equal(readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT, windowEnd: "2026-09-07" }), null);
    assert.equal(readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT, windowStart: "not-a-date", windowEnd: "2026-09-07" }), null);
    assert.equal(readinessRequestKey({ workspaceId: "", clientId: CLIENT }), null);
  });

  it("remediation 26: default and explicit-window cache keys cannot collide", () => {
    const implicit = readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT });
    const explicit = readinessRequestKey({ workspaceId: WORKSPACE, clientId: CLIENT, windowStart: "2026-09-01", windowEnd: "2026-09-07" });
    assert.ok(implicit);
    assert.ok(explicit);
    assert.notEqual(implicit, explicit);
  });
});
