import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReportReadiness, type SourceEvidence } from "./report-readiness";

const now = new Date("2026-09-04T12:00:00Z");
const window = { start: "2026-09-01", end: "2026-09-03" };

function healthySource(): SourceEvidence {
  return {
    connectionId: "source-1",
    provider: "meta_ads",
    connectionStatus: "connected",
    lastError: null,
    lastSyncAt: now.toISOString(),
    latestDataDate: window.end,
    timezone: "Asia/Ho_Chi_Minh",
    accounts: [{ accountId: "acc-a", status: "healthy", lastSuccessAt: now.toISOString() }],
    contexts: [
      {
        accountId: "acc-a",
        providerTimezone: "Asia/Ho_Chi_Minh",
        providerCurrency: "VND",
        providerObservedAt: now.toISOString(),
        overrideTimezone: null,
        overrideCurrency: null,
        overrideAt: null,
      },
    ],
    days: [1, 2, 3].map((day) => ({ accountId: "acc-a", date: `2026-09-0${day}`, currency: "VND", rows: 10 })),
    syncs: [],
  };
}

describe("Report Lifecycle v1 failing-first contracts", () => {
  it("defect 1: complete data with an unverified destination currently cannot reach 'Ready to review'", () => {
    const evaluation = evaluateReportReadiness({
      workspaceId: "ws-1",
      clientId: "client-1",
      now,
      window,
      sources: [healthySource()],
      requiredProviders: ["meta_ads"],
      requiredProvidersBasis: "explicit",
      destination: { state: "unverified", configuredCount: 1, required: ["google_sheets"] },
    });

    // Current baseline behavior: status is WARNING because DESTINATION_UNVERIFIED is in warnings
    assert.equal(evaluation.status, "WARNING", "baseline status is WARNING due to unverified destination");

    // Defect contract: dataStatus should be READY, decoupling data readiness from destination verification
    // This assertion FAILS on base branch because dataStatus does not exist yet.
    const decoupled = evaluation as unknown as { dataStatus?: string };
    assert.equal(
      decoupled.dataStatus,
      "READY",
      "Expected dataStatus to be READY independent of unverified destination delivery",
    );
  });

  it("defect 2: no durable human approval exists for an exact snapshot", async () => {
    // Defect contract: report approval module and function must exist to durably record human approval
    // This FAILS on base branch because report-approval.ts does not exist yet.
    let approvalModule: unknown = null;
    try {
      approvalModule = await import("./report-approval");
    } catch {
      approvalModule = null;
    }
    assert.ok(
      approvalModule !== null && typeof (approvalModule as Record<string, unknown>).approveReportSnapshot === "function",
      "Expected approveReportSnapshot function to exist in ./report-approval",
    );
  });

  it("defect 3: approval and delivery cannot currently be represented independently in lifecycle states", async () => {
    // Defect contract: deriveReportLifecycleState must distinguish:
    // - "Not ready to review"
    // - "Ready to review"
    // - "Approved — ready to send"
    // - "Delivered"
    // - "Approval outdated"
    // This FAILS on base branch because report-lifecycle.ts does not exist yet.
    let lifecycleModule: unknown = null;
    try {
      lifecycleModule = await import("./report-lifecycle");
    } catch {
      lifecycleModule = null;
    }
    assert.ok(
      lifecycleModule !== null && typeof (lifecycleModule as Record<string, unknown>).deriveReportLifecycleState === "function",
      "Expected deriveReportLifecycleState to exist and separate approval from delivery",
    );
  });
});
