import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SETUP_SECTION_ANCHOR,
  SETUP_STATE_LABELS,
  clientSetupHref,
  deriveClientSetupState,
  type ChecklistDiscoveredInput,
  type ChecklistEvaluationInput,
  type DeriveClientSetupInput,
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
    discovered: [] as ChecklistDiscoveredInput[],
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
      discovered: [],
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
      discovered: [{ provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["conn-meta-1"] }],
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
      discovered: [{ provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["conn-shopee-1"] }],
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
      discovered: [
        { provider: "meta_ads", accountId: "act_1", assignedClientId: CLIENT, connectionIds: ["c1"] },
        { provider: "shopee", accountId: "shop-1", assignedClientId: CLIENT, connectionIds: ["c2"] },
      ],
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
