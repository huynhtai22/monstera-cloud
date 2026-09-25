import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { POST } from "@/app/api/ai/executive-brief/route";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { setReportingContextOverride } from "@/lib/ai/reporting-context";
import prisma from "@/lib/prisma";
import type { ReportingContext } from "./reporting-contracts";
import { createMockFreshnessJourney } from "./reporting-contracts";

describe("Server-Side Export Revalidation Route Handler (POST /api/ai/executive-brief)", () => {
  const baseContext: ReportingContext = {
    workspaceId: "ws_test_123",
    clientId: "client_test_456",
    clientName: "Acme Brand",
    plan: "professional",
    windows: {
      preset: "last_7d",
      current: { start: "2026-09-17", end: "2026-09-23" },
      prior: { start: "2026-09-10", end: "2026-09-16" },
      timezone: "Asia/Ho_Chi_Minh",
      timezoneSource: "verified",
      daysCount: 7,
    },
    readiness: {
      status: "READY",
      exportEligible: true,
      blockers: [],
      warnings: [],
      latestDataDate: "2026-09-23",
      currencies: ["VND"],
      timezone: "Asia/Ho_Chi_Minh",
      fingerprint: "fp_dataset_hash_abc123",
    },
    freshnessJourney: createMockFreshnessJourney(),
    completeness: {
      coverageStatus: "complete",
      sourceCount: 2,
      partialCount: 0,
      missingDays: 0,
      limitReached: false,
    },
    metrics: [
      {
        metricId: "spend",
        name: "Total Spend",
        currency: "VND",
        currentValue: 15000000,
        priorValue: 12000000,
        absoluteChange: 3000000,
        percentageChange: 0.25,
        status: "available",
        limitations: [],
      },
    ],
    channels: [
      {
        channel: "meta",
        currency: "VND",
        spend: 15000000,
        conversions: 120,
        conversionValue: 45000000,
        roas: 3.0,
        orders: null,
        orderRevenue: null,
        clicks: 3500,
        impressions: 120000,
      },
    ],
    observations: [
      {
        id: "obs_spend",
        type: "spend",
        text: "Spend increased by 25.0% compared to prior period.",
        evidenceRef: "spend",
      },
    ],
    evaluatedAt: "2026-09-24T12:00:00.000Z",
    fingerprint: "fp_dataset_hash_abc123",
  };

  const origWorkspace = (prisma as any).workspace;
  const origWorkspaceMember = (prisma as any).workspaceMember;
  const origWorkspaceAiPolicy = (prisma as any).workspaceAiPolicy;
  const origAgentJob = (prisma as any).agentJob;
  const origClient = (prisma as any).client;

  let mockedUserRole: string | null = "member";
  let mockedWorkspaceExists = true;

  beforeEach(() => {
    // Default mock setup: authenticated user with member role
    mockedUserRole = "member";
    mockedWorkspaceExists = true;

    setAuthSessionOverride(async () => ({
      user: { id: "user_test_123", email: "analyst@example.com" },
      expires: "2026-12-31T00:00:00.000Z",
    }));

    setReportingContextOverride(async () => baseContext);

    (prisma as any).workspace = {
      findUnique: async ({ where }: any) => {
        if (!mockedWorkspaceExists) {
          return null;
        }
        return { id: where?.id || "ws_test_123", ownerId: "user_owner_999" };
      },
    };

    (prisma as any).workspaceMember = {
      findFirst: async ({ where }: any) => {
        if (where?.workspaceId === "ws_foreign_tenant" || !mockedUserRole) {
          return null;
        }
        return { userId: where?.userId || "user_test_123", workspaceId: where?.workspaceId || "ws_test_123", role: mockedUserRole };
      },
      findUnique: async ({ where }: any) => {
        if (where?.workspaceId_userId?.workspaceId === "ws_foreign_tenant" || !mockedUserRole) {
          return null;
        }
        return { userId: where?.workspaceId_userId?.userId || "user_test_123", workspaceId: where?.workspaceId_userId?.workspaceId || "ws_test_123", role: mockedUserRole };
      },
    };

    (prisma as any).workspaceAiPolicy = {
      findUnique: async () => ({
        monthlySpendCapUsd: 25,
        monthlyTokenCap: 2_000_000,
        spendCapAction: "block",
      }),
      upsert: async () => ({
        monthlySpendCapUsd: 25,
        monthlyTokenCap: 2_000_000,
        spendCapAction: "block",
      }),
      create: async () => ({
        monthlySpendCapUsd: 25,
        monthlyTokenCap: 2_000_000,
        spendCapAction: "block",
      }),
    };

    (prisma as any).agentJob = {
      aggregate: async () => ({ _sum: { spendUsd: 0, totalTokens: 0 } }),
    };

    (prisma as any).client = {
      findFirst: async ({ where }: any) => {
        if (where?.id === "client_test_456" && where?.workspaceId === "ws_test_123") {
          return { id: "client_test_456", name: "Acme Brand" };
        }
        return null;
      },
    };
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    setReportingContextOverride(null);
    (prisma as any).workspace = origWorkspace;
    (prisma as any).workspaceMember = origWorkspaceMember;
    (prisma as any).workspaceAiPolicy = origWorkspaceAiPolicy;
    (prisma as any).agentJob = origAgentJob;
    (prisma as any).client = origClient;
  });

  function makeRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost/api/ai/executive-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("1. 401 unauthenticated: rejects request when no session exists with Cache-Control private, no-store", async () => {
    setAuthSessionOverride(async () => null);

    const req = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "preview",
    });
    const res = await POST(req);

    assert.equal(res.status, 401);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const json = await res.json();
    assert.equal(json.error, "Unauthorized");
  });

  it("2. 403 viewer role: rejects request when user has only viewer role", async () => {
    mockedUserRole = "viewer";

    const req = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "preview",
    });
    const res = await POST(req);

    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const json = await res.json();
    assert.match(json.error, /requires member role/);
  });

  it("3. Foreign workspace rejected: blocks user attempting to access a workspace they are not member of", async () => {
    const req = makeRequest({
      workspaceId: "ws_foreign_tenant",
      clientId: "client_test_456",
      action: "preview",
    });
    const res = await POST(req);

    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const json = await res.json();
    assert.match(json.error, /not a member of this workspace/i);
  });

  it("4. 400 invalid parameters: strictly validates action, format, language, dateRange, workspaceId, clientId", async () => {
    // Missing workspaceId
    const resMissingWs = await POST(makeRequest({ clientId: "client_test_456" }));
    assert.equal(resMissingWs.status, 400);
    assert.equal(resMissingWs.headers.get("Cache-Control"), "private, no-store");

    // All clients or unassigned target
    const resAllClients = await POST(
      makeRequest({ workspaceId: "ws_test_123", clientId: "all" }),
    );
    assert.equal(resAllClients.status, 400);

    // Invalid action
    const resBadAction = await POST(
      makeRequest({ workspaceId: "ws_test_123", clientId: "client_test_456", action: "download" }),
    );
    assert.equal(resBadAction.status, 400);

    // Invalid dateRange
    const resBadDate = await POST(
      makeRequest({ workspaceId: "ws_test_123", clientId: "client_test_456", dateRange: "last_90d" }),
    );
    assert.equal(resBadDate.status, 400);

    // Invalid language
    const resBadLang = await POST(
      makeRequest({ workspaceId: "ws_test_123", clientId: "client_test_456", language: "fr" }),
    );
    assert.equal(resBadLang.status, 400);

    // Invalid format
    const resBadFormat = await POST(
      makeRequest({
        workspaceId: "ws_test_123",
        clientId: "client_test_456",
        action: "export",
        expectedFingerprint: "fp_dataset_hash_abc123",
        format: "pdf",
      }),
    );
    assert.equal(resBadFormat.status, 400);
  });

  it("5. 409 stale fingerprint: rejects export when expectedFingerprint does not match current dataset fingerprint", async () => {
    const req = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: "fp_old_stale_from_earlier_preview",
      format: "markdown",
    });
    const res = await POST(req);

    assert.equal(res.status, 409);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const json = await res.json();
    assert.equal(json.stale, true);
    assert.equal(json.currentFingerprint, "fp_dataset_hash_abc123");
    assert.match(json.error, /Regeneration required/);
  });

  it("6. 403 non-exportable readiness: blocks export when dataset is not report-ready (status != READY)", async () => {
    setReportingContextOverride(async () => ({
      ...baseContext,
      readiness: {
        ...baseContext.readiness,
        status: "WARNING",
        exportEligible: false,
        blockers: ["TIMEZONE_UNKNOWN"],
      },
    }));

    const req = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: "fp_dataset_hash_abc123",
      format: "markdown",
    });
    const res = await POST(req);

    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const json = await res.json();
    assert.equal(json.exportEligible, false);
    assert.equal(json.status, "WARNING");
    assert.deepEqual(json.blockers, ["TIMEZONE_UNKNOWN"]);
    assert.match(json.error, /Export blocked/);
  });

  it("7. 200 valid export content: returns formatted verified export content on matched fingerprint and READY status", async () => {
    const req = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: "fp_dataset_hash_abc123",
      format: "markdown",
      language: "en",
    });
    const res = await POST(req);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.format, "markdown");
    assert.equal(json.fingerprint, "fp_dataset_hash_abc123");
    assert.equal(json.exportEligible, true);
    assert.ok(typeof json.content === "string");
    assert.match(json.content, /# Acme Brand — Executive Performance Brief/);
    assert.match(json.content, /\*\*Total Spend:\*\* VND 15,000,000/);

    // Also verify text format export
    const textReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: "fp_dataset_hash_abc123",
      format: "text",
      language: "en",
    });
    const textRes = await POST(textReq);
    assert.equal(textRes.status, 200);
    const textJson = await textRes.json();
    assert.equal(textJson.format, "text");
    assert.match(textJson.content, /==================================================/);
  });

  it("8. Cache-Control: private, no-store is verified on preview and export responses", async () => {
    const previewReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "preview",
    });
    const previewRes = await POST(previewReq);
    assert.equal(previewRes.status, 200);
    assert.equal(previewRes.headers.get("Cache-Control"), "private, no-store");

    const exportReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: "fp_dataset_hash_abc123",
      format: "print",
    });
    const exportRes = await POST(exportReq);
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.headers.get("Cache-Control"), "private, no-store");
  });

  it("9. Current-period mutation: invalidates brief export when current-period data changes (HTTP 409)", async () => {
    // Initial preview returns baseContext with initial fingerprint
    const previewFingerprint = baseContext.fingerprint;

    // Simulate current-period mutation on export revalidation
    setReportingContextOverride(async () => ({
      ...baseContext,
      readiness: {
        ...baseContext.readiness,
        fingerprint: "fp_current_period_mutated_789",
      },
      fingerprint: "fp_brief_mutated_due_to_current_period",
    }));

    const exportReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: previewFingerprint,
      format: "markdown",
    });
    const exportRes = await POST(exportReq);

    assert.equal(exportRes.status, 409);
    assert.equal(exportRes.headers.get("Cache-Control"), "private, no-store");
    const json = await exportRes.json();
    assert.equal(json.stale, true);
    assert.equal(json.currentFingerprint, "fp_brief_mutated_due_to_current_period");
    assert.match(json.error, /Regeneration required before export/);
  });

  it("10. Prior-period mutation: invalidates brief export when prior-period comparison data changes (HTTP 409)", async () => {
    // Initial preview returns baseContext with initial fingerprint
    const previewFingerprint = baseContext.fingerprint;

    // Simulate prior-period correction (e.g. late Shopee order sync for prior week)
    // Note: readiness.fingerprint (current window) stays the same, but the brief-level fingerprint changes
    setReportingContextOverride(async () => ({
      ...baseContext,
      readiness: {
        ...baseContext.readiness,
        fingerprint: baseContext.readiness.fingerprint, // Unchanged current-period destination receipt
      },
      fingerprint: "fp_brief_mutated_due_to_prior_period_correction",
    }));

    const exportReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: previewFingerprint,
      format: "markdown",
    });
    const exportRes = await POST(exportReq);

    assert.equal(exportRes.status, 409);
    assert.equal(exportRes.headers.get("Cache-Control"), "private, no-store");
    const json = await exportRes.json();
    assert.equal(json.stale, true);
    assert.equal(json.currentFingerprint, "fp_brief_mutated_due_to_prior_period_correction");
    assert.match(json.error, /Regeneration required before export/);
  });

  it("11. Scope mutation: invalidates brief export when client account assignments change (HTTP 409)", async () => {
    const previewFingerprint = baseContext.fingerprint;

    // Simulate account reassignment (e.g. ad account added or removed from client scope)
    setReportingContextOverride(async () => ({
      ...baseContext,
      fingerprint: "fp_brief_mutated_due_to_account_reassignment",
    }));

    const exportReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: previewFingerprint,
      format: "markdown",
    });
    const exportRes = await POST(exportReq);

    assert.equal(exportRes.status, 409);
    const json = await exportRes.json();
    assert.equal(json.stale, true);
    assert.equal(json.currentFingerprint, "fp_brief_mutated_due_to_account_reassignment");
  });

  it("12. Readiness destination receipt contract: readiness.fingerprint matches current dataset while brief fingerprint covers both periods", async () => {
    const previewReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "preview",
    });
    const previewRes = await POST(previewReq);
    assert.equal(previewRes.status, 200);
    const json = await previewRes.json();

    // Verify readiness.fingerprint is present for destination receipts (Sheets/Looker)
    assert.equal(json.brief.readiness.fingerprint, "fp_dataset_hash_abc123");
    // Verify brief-level fingerprint is returned for export revalidation
    assert.equal(json.fingerprint, "fp_dataset_hash_abc123");
  });

  it("13. Plan limit comparison unavailable: brief export includes disclosure and omits delta claims", async () => {
    setReportingContextOverride(async () => ({
      ...baseContext,
      windows: {
        ...baseContext.windows,
        comparisonAvailable: false,
        comparisonUnavailableReason: "Prior-period comparison requires access beyond 14-day history limit.",
      },
      metrics: [
        {
          metricId: "spend",
          name: "Total Spend",
          currency: "VND",
          currentValue: 15000000,
          priorValue: null,
          absoluteChange: null,
          percentageChange: null,
          status: "unavailable",
          limitations: ["Prior-period comparison requires access beyond 14-day history limit."],
        },
      ],
      fingerprint: "fp_plan_limited_comparison_unavailable",
    }));

    const exportReq = makeRequest({
      workspaceId: "ws_test_123",
      clientId: "client_test_456",
      action: "export",
      expectedFingerprint: "fp_plan_limited_comparison_unavailable",
      format: "markdown",
    });
    const exportRes = await POST(exportReq);
    assert.equal(exportRes.status, 200);
    const json = await exportRes.json();

    assert.equal(json.ok, true);
    // Verified export content does not contain delta percentage claims
    assert.doesNotMatch(json.content, /vs prior period/);
    assert.doesNotMatch(json.content, /\+25\.0%/);
    // Verified export includes the explicit plan limit disclosure
    assert.match(json.content, /Prior-period comparison: Unavailable/);
  });
});
