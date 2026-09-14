import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReportReadiness, type SourceEvidence } from "./report-readiness";
import { deriveReportLifecycleState, type ReportApprovalSummary } from "./report-lifecycle";
import { approveReportSnapshot } from "./report-approval";

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

function sampleApproval(overrides: Partial<ReportApprovalSummary> = {}): ReportApprovalSummary {
  return {
    id: "app-1",
    snapshotId: "snap-1",
    generationKey: "gen-key-1",
    sequence: 1,
    datasetFingerprint: "fp-1",
    dependencyHash: "dep-hash-1",
    approvedByUserId: "user-1",
    approvedByUserName: "Operator A",
    approvedByUserEmail: "operator@example.com",
    approvedAt: "2026-09-04T12:30:00.000Z",
    notes: null,
    ...overrides,
  };
}

describe("Report Lifecycle v1 contracts", () => {
  describe("Defect resolutions", () => {
    it("defect 1 resolved: complete data with an unverified destination reaches dataStatus READY", () => {
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

      // Overall status retains backward-compatible WARNING
      assert.equal(evaluation.status, "WARNING", "overall status preserves DESTINATION_UNVERIFIED warning");
      // Decoupled dataStatus is cleanly READY
      assert.equal(evaluation.dataStatus, "READY", "dataStatus is READY independently of destination delivery");
      assert.equal(evaluation.dataBlockers.length, 0, "zero data blockers");
      assert.equal(evaluation.dataWarnings.length, 0, "zero data warnings");
    });

    it("defect 2 resolved: durable human approval module and function exist", () => {
      assert.equal(typeof approveReportSnapshot, "function", "approveReportSnapshot is defined and exported");
    });

    it("defect 3 resolved: deriveReportLifecycleState exists and derives all 5 states independently", () => {
      assert.equal(typeof deriveReportLifecycleState, "function", "deriveReportLifecycleState is defined and exported");
    });
  });

  describe("Lifecycle state derivation semantics", () => {
    const currentSnapshot = {
      id: "snap-1",
      generationKey: "gen-key-1",
      sequence: 1,
      dependencyHash: "dep-hash-1",
      freshness: { freshness: "CURRENT" as const },
    };

    it("1. Complete, healthy data with no approval becomes 'Ready to review' without a delivery receipt", () => {
      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot,
        activeApproval: null,
        latestReportApproval: null,
        destinationVerified: false,
      });
      assert.equal(state, "Ready to review");
    });

    it("1b. Complete data before initial snapshot generation is also 'Ready to review'", () => {
      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot: null,
        activeApproval: null,
        latestReportApproval: null,
        destinationVerified: false,
      });
      assert.equal(state, "Ready to review");
    });

    it("2. Incomplete or unhealthy data yields 'Not ready to review' regardless of snapshot or approval", () => {
      for (const badStatus of ["NOT_READY", "WARNING", "UNKNOWN"] as const) {
        const state = deriveReportLifecycleState({
          dataStatus: badStatus,
          currentSnapshot,
          activeApproval: sampleApproval(),
          latestReportApproval: sampleApproval(),
          destinationVerified: true,
        });
        assert.equal(state, "Not ready to review", `Expected ${badStatus} data to be 'Not ready to review'`);
      }
    });

    it("3. Approved snapshot with unverified destination yields 'Approved — ready to send'", () => {
      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot,
        activeApproval: sampleApproval(),
        latestReportApproval: sampleApproval(),
        destinationVerified: false,
      });
      assert.equal(state, "Approved — ready to send");
    });

    it("4. Approved snapshot with verified destination yields 'Delivered'", () => {
      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot,
        activeApproval: sampleApproval(),
        latestReportApproval: sampleApproval(),
        destinationVerified: true,
      });
      assert.equal(state, "Delivered");
    });

    it("5. Delivery receipt without human approval NEVER yields 'Delivered' or 'Approved'", () => {
      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot,
        activeApproval: null,
        latestReportApproval: null,
        destinationVerified: true, // Destination proof exists, but NO operator approved
      });
      assert.equal(
        state,
        "Ready to review",
        "A delivery receipt alone must never imply human approval",
      );
    });

    it("6. Historical approval with a newer snapshot sequence yields 'Approval outdated'", () => {
      // Historical approval was sequence 1, current snapshot is sequence 2
      const newerSnapshot = {
        id: "snap-2",
        generationKey: "gen-key-1",
        sequence: 2,
        dependencyHash: "dep-hash-2",
        freshness: { freshness: "CURRENT" as const },
      };
      const olderApproval = sampleApproval({
        snapshotId: "snap-1",
        sequence: 1,
        dependencyHash: "dep-hash-1",
      });

      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot: newerSnapshot,
        activeApproval: null, // No approval for snap-2
        latestReportApproval: olderApproval,
        destinationVerified: false,
      });
      assert.equal(state, "Approval outdated");
    });

    it("7. Changed dependencyHash on current snapshot yields 'Approval outdated'", () => {
      const approvalWithOldHash = sampleApproval({
        dependencyHash: "dep-hash-original",
      });
      const snapshotWithChangedHash = {
        ...currentSnapshot,
        dependencyHash: "dep-hash-modified",
      };

      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot: snapshotWithChangedHash,
        activeApproval: approvalWithOldHash,
        latestReportApproval: approvalWithOldHash,
        destinationVerified: false,
      });
      assert.equal(state, "Approval outdated");
    });

    it("8. Snapshot marked STALE against current data yields 'Approval outdated'", () => {
      const staleSnapshot = {
        ...currentSnapshot,
        freshness: { freshness: "STALE" as const },
      };

      const state = deriveReportLifecycleState({
        dataStatus: "READY",
        currentSnapshot: staleSnapshot,
        activeApproval: sampleApproval(),
        latestReportApproval: sampleApproval(),
        destinationVerified: true,
      });
      assert.equal(state, "Approval outdated");
    });
  });
});
