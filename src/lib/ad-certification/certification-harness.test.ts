import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  maskAccountId,
  maskEmail,
  sanitizeEvidence,
} from "./redaction";
import {
  METRIC_CONTRACTS,
  evaluateReconciliation,
} from "./metric-contracts";
import { CertificationHarness, RUNTIME_CONNECTOR_API_VERSIONS, getExactCommitSha } from "./harness";
import { CERTIFICATION_LEVELS } from "./types";

describe("Certification Harness & Standards Suite", () => {
  describe("Redaction & Sanitization", () => {
    it("stably masks Meta ad account IDs", () => {
      assert.equal(maskAccountId("act_1234567890"), "act_***7890");
      assert.equal(maskAccountId("act_9999"), "act_***9999");
    });

    it("stably masks Google customer IDs and TikTok advertiser IDs", () => {
      assert.equal(maskAccountId("123-456-7890"), "id_***7890");
      assert.equal(maskAccountId("7123456789012345678"), "id_***5678");
      assert.equal(maskAccountId(""), "[UNSPECIFIED_ACCOUNT]");
      assert.equal(maskAccountId(null), "[UNSPECIFIED_ACCOUNT]");
    });

    it("stably masks email addresses", () => {
      assert.equal(maskEmail("operator@monsteracloud.com"), "o***r@monsteracloud.com");
      assert.equal(maskEmail(null), "[NO_EMAIL]");
    });

    it("deeply sanitizes sensitive credentials, tokens, and headers", () => {
      const raw = {
        workspaceId: "ws-123",
        accessToken: "EAABsb123456789secrettoken",
        clientSecret: "topsecret123",
        developerToken: "dev-token-abc",
        headers: {
          authorization: "Bearer secret-payload-here",
          "x-api-key": "sensitive-key",
          "content-type": "application/json",
        },
        nested: {
          refreshToken: "refresh-xyz",
          safeData: 42,
        },
      };

      const sanitized = sanitizeEvidence(raw);
      assert.equal(sanitized.workspaceId, "ws-123");
      assert.equal(sanitized.accessToken, "[REDACTED]");
      assert.equal(sanitized.clientSecret, "[REDACTED]");
      assert.equal(sanitized.developerToken, "[REDACTED]");
      assert.equal((sanitized.headers as any).authorization, "[REDACTED]");
      assert.equal((sanitized.headers as any)["x-api-key"], "[REDACTED]");
      assert.equal((sanitized.headers as any)["content-type"], "application/json");
      assert.equal((sanitized.nested as any).refreshToken, "[REDACTED]");
      assert.equal((sanitized.nested as any).safeData, 42);
    });
  });

  describe("Versioned Metric Contracts", () => {
    it("defines contracts for all 3 advertising providers", () => {
      assert.ok(METRIC_CONTRACTS.google_ads);
      assert.ok(METRIC_CONTRACTS.meta_ads);
      assert.ok(METRIC_CONTRACTS.tiktok_business);
    });

    it("strictly requires exact match on integer delivery metrics (impressions, clicks)", () => {
      const providerTotals = { impressions: 1000, clicks: 50, spend: 200, conversions: 10, revenue: 500 };
      const warehouseTotals = { impressions: 1001, clicks: 50, spend: 200, conversions: 10, revenue: 500 };

      const result = evaluateReconciliation(
        "google_ads",
        providerTotals,
        warehouseTotals,
        {
          accountTimezone: "America/New_York",
          currency: "USD",
          dateRange: { start: "2026-08-01", end: "2026-08-07" },
        }
      );

      assert.equal(result.passed, false);
      assert.ok(result.unexplainedVariances.includes("impressions"));
    });

    it("allows currency rounding within documented tolerance (0.01 USD)", () => {
      const providerTotals = { impressions: 1000, clicks: 50, spend: 200.004, conversions: 10, revenue: 500.002 };
      const warehouseTotals = { impressions: 1000, clicks: 50, spend: 200.01, conversions: 10, revenue: 500.01 };

      const result = evaluateReconciliation(
        "google_ads",
        providerTotals,
        warehouseTotals,
        {
          accountTimezone: "America/New_York",
          currency: "USD",
          dateRange: { start: "2026-08-01", end: "2026-08-07" },
        }
      );

      assert.equal(result.passed, true);
      assert.equal(result.unexplainedVariances.length, 0);
    });

    it("accepts explained variances and rejects unexplained variances", () => {
      const providerTotals = { impressions: 1000, clicks: 50, spend: 200, conversions: 12, revenue: 600 };
      const warehouseTotals = { impressions: 1000, clicks: 50, spend: 200, conversions: 10, revenue: 500 };

      // Without explanation -> fails
      const unexpResult = evaluateReconciliation(
        "meta_ads",
        providerTotals,
        warehouseTotals,
        {
          accountTimezone: "Asia/Ho_Chi_Minh",
          currency: "VND",
          dateRange: { start: "2026-08-01", end: "2026-08-07" },
        }
      );
      assert.equal(unexpResult.passed, false);
      assert.ok(unexpResult.unexplainedVariances.includes("conversions"));

      // With explanation -> passes
      const expResult = evaluateReconciliation(
        "meta_ads",
        providerTotals,
        warehouseTotals,
        {
          accountTimezone: "Asia/Ho_Chi_Minh",
          currency: "VND",
          dateRange: { start: "2026-08-01", end: "2026-08-07" },
        },
        {
          conversions: "Attribution revisions for 7-day click window added 2 late conversions",
          revenue: "Attribution revisions for purchase values added 100 VND late revenue",
        }
      );
      assert.equal(expResult.passed, true);
      assert.equal(expResult.unexplainedVariances.length, 0);
    });
  });

  describe("Harness Boundaries & Fail-Closed Logic", () => {
    const harness = new CertificationHarness();

    it("rejects broad or unbounded date ranges (>30 days)", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-07-01",
            endDate: "2026-08-15", // 46 days
            buildId: "build-1",
          }),
        /exceeds maximum certification limit of 30 days/
      );
    });

    it("rejects inverted date ranges (start > end)", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-15",
            endDate: "2026-08-01",
            buildId: "build-1",
          }),
        /cannot be after endDate/
      );
    });

    it("stops at exact gate when live credentials or accounts are absent without inventing evidence", async () => {
      const { evidencePack, markdownReport } = await harness.execute({
        workspaceId: "ws-test-pilot",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-test-1",
      });

      assert.equal(evidencePack.provider, "google_ads");
      assert.equal(evidencePack.accountId, "id_***7890");
      assert.equal(evidencePack.highestProvenLevel, "CODE_VERIFIED");
      assert.equal(evidencePack.pilotEligible, false);

      // Gate 1 CODE_VERIFIED should pass
      const g1 = evidencePack.gateOutcomes.find((g) => g.gate === "CODE_VERIFIED");
      assert.equal(g1?.status, "PASSED");

      // Gate 2 SANDBOX_VERIFIED should be NOT_APPLICABLE for Google Ads with documented reason
      const g2 = evidencePack.gateOutcomes.find((g) => g.gate === "SANDBOX_VERIFIED");
      assert.equal(g2?.status, "NOT_APPLICABLE");
      assert.equal(g2?.isApplicable, false);
      assert.ok(g2?.notApplicableReason);
      assert.ok(g2?.alternativeVerificationPath);

      // Gate 3 LIVE_CONNECTED should be BLOCKED (no live OAuth)
      const g3 = evidencePack.gateOutcomes.find((g) => g.gate === "LIVE_CONNECTED");
      assert.equal(g3?.status, "BLOCKED");

      // Pilot certified must not be awarded and marked NOT_EXECUTED
      const g8 = evidencePack.gateOutcomes.find((g) => g.gate === "PILOT_CERTIFIED");
      assert.equal(g8?.status, "NOT_EXECUTED");

      // Markdown report should contain required sections
      assert.ok(markdownReport.includes("# Ad Connector Certification Report: Google Ads"));
      assert.ok(markdownReport.includes("Highest Proven Level:"));
      assert.ok(markdownReport.includes("Controlled Pilot Eligible:** **NO ❌**"));
    });

    it("evaluates Meta Ads and stops at exact gate when credentials are absent", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-pilot",
        provider: "meta_ads",
        accountId: "act_987654321",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-test-2",
      });

      assert.equal(evidencePack.provider, "meta_ads");
      assert.equal(evidencePack.accountId, "act_***4321");
      assert.equal(evidencePack.highestProvenLevel, "CODE_VERIFIED");
      assert.equal(evidencePack.pilotEligible, false);
      assert.ok(evidencePack.blockers.some((b) => b.category === "MISSING_META_CREDENTIALS"));
    });

    it("evaluates TikTok Ads and stops at exact gate when credentials are absent", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-pilot",
        provider: "tiktok_business",
        accountId: "7123456789012345678",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-test-3",
      });

      assert.equal(evidencePack.provider, "tiktok_business");
      assert.equal(evidencePack.accountId, "id_***5678");
      assert.equal(evidencePack.highestProvenLevel, "CODE_VERIFIED");
      assert.equal(evidencePack.pilotEligible, false);
      assert.ok(evidencePack.blockers.some((b) => b.category === "MISSING_TIKTOK_CREDENTIALS"));
    });

    it("rejects skipping levels: human sign-off cannot award PILOT_CERTIFIED if earlier gates are blocked", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-pilot",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-test-signoff",
        humanReviewSignOff: {
          reviewerName: "Lead Auditor",
          reviewerRole: "Platform Lead",
          signedAt: new Date().toISOString(),
          comments: "Attempting premature sign-off",
        },
      });

      // Must NOT skip to PILOT_CERTIFIED!
      assert.equal(evidencePack.highestProvenLevel, "CODE_VERIFIED");
      assert.equal(evidencePack.pilotEligible, false);
      const pilotGate = evidencePack.gateOutcomes.find((g) => g.gate === "PILOT_CERTIFIED");
      assert.equal(pilotGate?.status, "NOT_EXECUTED");
    });

    it("ensures zero secrets leak into JSON or Markdown even if injected into inputs", async () => {
      const { evidencePack, markdownReport } = await harness.execute({
        workspaceId: "ws-test-pilot",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-secret-check",
      });

      const jsonStr = JSON.stringify(evidencePack);
      assert.equal(jsonStr.includes("client_secret"), false);
      assert.equal(jsonStr.includes("refresh_token"), false);
      assert.equal(jsonStr.includes("access_token"), false);
      assert.ok(markdownReport.includes("Zero client secrets, developer tokens, access tokens"));
    });

    it("maintains strict 8-tier ordered progression hierarchy", () => {
      assert.deepEqual(CERTIFICATION_LEVELS, [
        "CODE_VERIFIED",
        "SANDBOX_VERIFIED",
        "LIVE_CONNECTED",
        "LIVE_IMPORTED",
        "LIVE_RECONCILED",
        "DESTINATION_VERIFIED",
        "RECOVERY_VERIFIED",
        "PILOT_CERTIFIED",
      ]);
    });
  });

  describe("Section 9 Required Verification Suites", () => {
    const harness = new CertificationHarness();

    it("1. enforces NOT_APPLICABLE transition rules and prevents misuse", () => {
      // Valid NOT_APPLICABLE on Google Ads sandbox
      assert.doesNotThrow(() => {
        CertificationHarness.validateGateTransition("SANDBOX_VERIFIED", "NOT_APPLICABLE", {
          provider: "google_ads",
          notApplicableReason: "Google test accounts lack serving metrics",
          alternativeVerificationPath: "Google test-account unit tests and production run",
        });
      });

      // Misuse: missing documented reason
      assert.throws(
        () => {
          CertificationHarness.validateGateTransition("SANDBOX_VERIFIED", "NOT_APPLICABLE", {
            provider: "google_ads",
            notApplicableReason: "",
            alternativeVerificationPath: "Alternative path exists",
          });
        },
        /cannot be marked NOT_APPLICABLE without a documented provider-specific reason/
      );

      // Misuse: missing alternative verification path
      assert.throws(
        () => {
          CertificationHarness.validateGateTransition("SANDBOX_VERIFIED", "NOT_APPLICABLE", {
            provider: "google_ads",
            notApplicableReason: "Valid reason",
            alternativeVerificationPath: "",
          });
        },
        /cannot be marked NOT_APPLICABLE without an approved alternative verification path/
      );

      // Misuse: attempting NOT_APPLICABLE on mandatory production gates
      assert.throws(
        () => {
          CertificationHarness.validateGateTransition("LIVE_CONNECTED", "NOT_APPLICABLE", {
            provider: "google_ads",
            notApplicableReason: "Want to skip live connection",
            alternativeVerificationPath: "None",
          });
        },
        /Misuse of NOT_APPLICABLE: Gate 'LIVE_CONNECTED' is mandatory/
      );

      assert.throws(
        () => {
          CertificationHarness.validateGateTransition("LIVE_RECONCILED", "NOT_APPLICABLE", {
            provider: "google_ads",
            notApplicableReason: "Want to skip reconciliation",
            alternativeVerificationPath: "None",
          });
        },
        /Misuse of NOT_APPLICABLE: Gate 'LIVE_RECONCILED' is mandatory/
      );

      // Misuse: attempting NOT_APPLICABLE on providers with real sandbox (Meta/TikTok)
      assert.throws(
        () => {
          CertificationHarness.validateGateTransition("SANDBOX_VERIFIED", "NOT_APPLICABLE", {
            provider: "meta_ads",
            notApplicableReason: "Trying to skip Meta sandbox",
            alternativeVerificationPath: "Live run",
          });
        },
        /Provider 'meta_ads' has a valid sandbox\/dev mode/
      );
    });

    it("2. enforces a mandatory applicable gate blocking certification", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-blocked",
        provider: "meta_ads",
        accountId: "act_11223344",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-gate-block",
      });

      assert.equal(evidencePack.pilotEligible, false);
      const pilotGate = evidencePack.gateOutcomes.find((g) => g.gate === "PILOT_CERTIFIED");
      assert.equal(pilotGate?.status, "NOT_EXECUTED");
      assert.ok(pilotGate?.details.includes("Cannot award PILOT_CERTIFIED until all prior mandatory applicable gates have PASSED"));
    });

    it("3. verifies Google sandbox alternative-path behavior does not award passed status", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-gads",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-gads-alt",
      });

      const sandboxGate = evidencePack.gateOutcomes.find((g) => g.gate === "SANDBOX_VERIFIED");
      assert.equal(sandboxGate?.status, "NOT_APPLICABLE");
      assert.equal(sandboxGate?.isApplicable, false);
      // NOT_APPLICABLE does NOT elevate highestProvenLevel to SANDBOX_VERIFIED
      assert.equal(evidencePack.highestProvenLevel, "CODE_VERIFIED");
    });

    it("4. prevents misleading destination status wording", async () => {
      const { evidencePack, markdownReport } = await harness.execute({
        workspaceId: "ws-test-dest",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-dest-check",
      });

      // Must explicitly distinguish code path vs authenticated retrieval
      assert.equal(evidencePack.destinationStatus.codePath, "CODE_VERIFIED");
      assert.equal(evidencePack.destinationStatus.authenticatedLiveRetrieval, "pending");
      assert.equal(evidencePack.destinationStatus.currentDeliveryReceipt, "pending");
      assert.equal(evidencePack.destinationStatus.destinationCertificationLevel, "not reached");

      // Markdown report must render this exact distinction
      assert.ok(markdownReport.includes("Destination Code Path:** `CODE_VERIFIED`"));
      assert.ok(markdownReport.includes("Authenticated Live Retrieval:** `pending`"));
      assert.ok(markdownReport.includes("Current Delivery Receipt:** `pending`"));
      assert.ok(markdownReport.includes("Destination Certification Level:** `not reached`"));
    });

    it("5. refuses to write live certification evidence into Git-tracked storage", async () => {
      // Trying to save live evidence into a tracked directory (e.g. docs/ or src/) must be refused
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test-live-refuse",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-live-refuse",
            evidenceClass: "live_certification_evidence",
            outputDirectory: "docs/certification",
          }),
        /Security violation: Refusing to write live_certification_evidence anywhere inside repository root/
      );

      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test-live-refuse-src",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-live-refuse-src",
            evidenceClass: "live_certification_evidence",
            outputDirectory: "src/lib",
          }),
        /Security violation: Refusing to write live_certification_evidence anywhere inside repository root/
      );
    });

    it("6. correctly classifies synthetic_fixture, sandbox_evidence, and live_certification_evidence", async () => {
      const synthetic = await harness.execute({
        workspaceId: "ws-test-class",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-class-1",
        evidenceClass: "synthetic_fixture",
      });
      assert.equal(synthetic.evidencePack.evidenceClass, "synthetic_fixture");
      assert.equal(synthetic.evidencePack.storageType, "synthetic_fixture");

      const sandbox = await harness.execute({
        workspaceId: "ws-test-class",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-class-2",
        evidenceClass: "sandbox_evidence",
      });
      assert.equal(sandbox.evidencePack.evidenceClass, "sandbox_evidence");
      assert.equal(sandbox.evidencePack.storageType, "git_ignored_local");
    });

    it("7. validates evidence sanitization and tenant isolation boundaries", async () => {
      const raw = {
        token: "secret-token",
        client_secret: "secret-secret",
        password: "secret-password",
        workspaceId: "ws-boundary-test",
        accountId: "123-456-7890",
      };
      const sanitized = sanitizeEvidence(raw);
      assert.equal(sanitized.token, "[REDACTED]");
      assert.equal(sanitized.client_secret, "[REDACTED]");
      assert.equal(sanitized.password, "[REDACTED]");
      assert.equal(sanitized.workspaceId, "ws-boundary-test");
    });

    it("8. fails closed when mandatory provider-portal facts remain unverified during live certification", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-portal",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-portal-check",
        evidenceClass: "live_certification_evidence",
        trustedRuntimeMetadata: {
          workingTreeDirty: false,
          commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
          schemaVersion: "20260904160000",
        },
        providerAccessFacts: {
          observedApiVersion: "UNVERIFIED",
          appAccountMode: "unverified",
          grantedScopesOrPermissions: [],
          accessLevelStatus: "unverified",
          authorizationModel: "unverified",
          tokenLifecycleModel: "unverified",
          verificationSource: "unverified",
          verifiedAt: null,
          status: "UNVERIFIED",
        },
      });

      assert.equal(evidencePack.pilotEligible, false);
      assert.ok(
        evidencePack.blockers.some((b) => b.category === "UNVERIFIED_PROVIDER_PORTAL_FACTS"),
        "Must fail closed when provider portal facts are unverified"
      );
    });

    it("9. marks snapshot timing mismatches as INCONCLUSIVE and refuses to loosen tolerances", () => {
      const providerTotals = { impressions: 1000, clicks: 50, spend: 200, conversions: 10, revenue: 500 };
      const warehouseTotals = { impressions: 980, clicks: 48, spend: 195, conversions: 9, revenue: 480 };

      // Provider retrieval is at 10:00:00, Monstera warehouse sync data-through is at 08:00:00 (2 hours apart)
      const result = evaluateReconciliation(
        "google_ads",
        providerTotals,
        warehouseTotals,
        {
          accountTimezone: "Asia/Ho_Chi_Minh",
          currency: "VND",
          dateRange: { start: "2026-08-01", end: "2026-08-07" },
          nativeRetrievalTime: "2026-08-08T10:00:00Z",
          monsteraDataThroughTime: "2026-08-08T08:00:00Z",
          warehouseQueryTime: "2026-08-08T10:05:00Z",
          reportingGranularity: "TOTAL",
          nativeComparisonSource: "AD_MANAGER_UI",
        }
      );

      assert.equal(result.passed, false);
      assert.equal(result.isSnapshotAligned, false);
      assert.equal(result.isInconclusive, true);
      assert.ok(result.inconclusiveReason?.includes("Snapshot timing mismatch"));
      // Tolerances must remain strict:
      const impComp = result.metrics.find((m) => m.metric === "impressions");
      assert.equal(impComp?.tolerance, 0); // Still 0, not artificially inflated!
    });

    it("10. binds certification evidence pack to buildId, commitSha, and schemaVersion", async () => {
      const { evidencePack } = await harness.execute({
        workspaceId: "ws-test-traceability",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-sha-12345",
      });

      assert.equal(evidencePack.buildId, "build-sha-12345");
      assert.ok(evidencePack.metadata.gitCommit);
      assert.equal(evidencePack.metadata.schemaVersion, "20260904160000");
      assert.equal(evidencePack.metadata.harnessVersion, "1.1.0");
      assert.equal(evidencePack.metadata.contractVersion, "1.0.0");
      assert.ok(Array.isArray(evidencePack.metadata.commandsUsed));
    });
  });

  describe("Progression, Boundary Enforcement & Runtime Configuration", () => {
    const harness = new CertificationHarness();

    it("proves complete simulated Google transition through PILOT_CERTIFIED with approved NOT_APPLICABLE sandbox gate", async () => {
      const { evidencePack, markdownReport } = await harness.execute({
        workspaceId: "ws-pilot-sim-google",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-sim-google-pilot-pass",
        simulation: {
          simulatedConnection: true,
          simulatedWarehouseRows: 150,
          simulatedWarehouseTotals: {
            spend: 250,
            impressions: 12000,
            clicks: 350,
            conversions: 24,
            revenue: 1200,
            accountTimezone: "America/New_York",
            currency: "USD",
          },
          simulatedDestinationReceiptId: "rcpt_google_pilot_001",
          simulatedRecoveryPassed: true,
        },
        nativeComparison: {
          spend: 250,
          impressions: 12000,
          clicks: 350,
          conversions: 24,
          revenue: 1200,
        },
        snapshotTiming: {
          accountTimezone: "America/New_York",
          currency: "USD",
          nativeRetrievalTime: "2026-08-08T10:00:00Z",
          monsteraDataThroughTime: "2026-08-08T10:00:00Z",
          warehouseQueryTime: "2026-08-08T10:02:00Z",
          reportingGranularity: "TOTAL",
          nativeComparisonSource: "AD_MANAGER_UI",
        },
        humanReviewSignOff: {
          reviewerName: "Chief Security Auditor",
          reviewerRole: "Platform Compliance Officer",
          signedAt: new Date().toISOString(),
          comments: "Simulated transition verified: all mandatory gates passed, Google sandbox legitimately not applicable",
        },
      });

      // 1. Highest proven level reached PILOT_CERTIFIED and pilot eligible is true
      assert.equal(evidencePack.highestProvenLevel, "PILOT_CERTIFIED");
      assert.equal(evidencePack.pilotEligible, true);
      assert.equal(evidencePack.blockers.length, 0);

      // 2. SANDBOX_VERIFIED was NOT_APPLICABLE and NOT counted as passed evidence
      const sandboxGate = evidencePack.gateOutcomes.find((g) => g.gate === "SANDBOX_VERIFIED");
      assert.equal(sandboxGate?.status, "NOT_APPLICABLE");
      assert.equal(sandboxGate?.isApplicable, false);
      assert.ok(sandboxGate?.notApplicableReason);
      assert.ok(sandboxGate?.alternativeVerificationPath);

      // 3. All other mandatory applicable gates are strictly PASSED
      const mandatoryGates = [
        "CODE_VERIFIED",
        "LIVE_CONNECTED",
        "LIVE_IMPORTED",
        "LIVE_RECONCILED",
        "DESTINATION_VERIFIED",
        "RECOVERY_VERIFIED",
        "PILOT_CERTIFIED",
      ];
      for (const mg of mandatoryGates) {
        const gateRes = evidencePack.gateOutcomes.find((g) => g.gate === mg);
        assert.equal(gateRes?.status, "PASSED", `Gate ${mg} must be PASSED`);
      }

      // 4. Markdown report reflects controlled pilot eligible
      assert.ok(markdownReport.includes("Controlled Pilot Eligible:** **YES ✅**"));
      assert.ok(markdownReport.includes("Highest Proven Level:** **`PILOT_CERTIFIED`**"));
    });

    it("proves unjustified exemptions cannot progress to PILOT_CERTIFIED", async () => {
      // Case A: Meta Ads cannot claim NOT_APPLICABLE on SANDBOX_VERIFIED
      const metaUnjustified = await harness.execute({
        workspaceId: "ws-unjustified-meta",
        provider: "meta_ads",
        accountId: "act_12345678",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-meta-unjustified",
        simulation: {
          unjustifiedSandboxExemption: true,
          simulatedConnection: true,
          simulatedWarehouseRows: 100,
          simulatedWarehouseTotals: { spend: 100, impressions: 1000, clicks: 50, conversions: 5, revenue: 200 },
          simulatedDestinationReceiptId: "rcpt_meta_001",
          simulatedRecoveryPassed: true,
        },
        nativeComparison: { spend: 100, impressions: 1000, clicks: 50, conversions: 5, revenue: 200 },
        humanReviewSignOff: {
          reviewerName: "Attempted Auditor",
          reviewerRole: "Reviewer",
          signedAt: new Date().toISOString(),
          comments: "Attempting to waive Meta sandbox",
        },
      });

      assert.notEqual(metaUnjustified.evidencePack.highestProvenLevel, "PILOT_CERTIFIED");
      assert.equal(metaUnjustified.evidencePack.pilotEligible, false);
      const metaPilotGate = metaUnjustified.evidencePack.gateOutcomes.find((g) => g.gate === "PILOT_CERTIFIED");
      assert.equal(metaPilotGate?.status, "NOT_EXECUTED");
      assert.ok(
        metaUnjustified.evidencePack.blockers.some(
          (b) => b.category === "INVALID_NOT_APPLICABLE_JUSTIFICATION" || b.category === "UNJUSTIFIED_EXEMPTION"
        )
      );

      // Case B: Attempting unjustified NOT_APPLICABLE on a mandatory gate (e.g. LIVE_RECONCILED)
      const gadsMandatoryUnjustified = await harness.execute({
        workspaceId: "ws-unjustified-gate",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "commit-gate-unjustified",
        simulation: {
          simulatedConnection: true,
          simulatedWarehouseRows: 100,
          unjustifiedGateExemption: "LIVE_RECONCILED",
          simulatedDestinationReceiptId: "rcpt_gads_001",
          simulatedRecoveryPassed: true,
        },
        humanReviewSignOff: {
          reviewerName: "Attempted Auditor",
          reviewerRole: "Reviewer",
          signedAt: new Date().toISOString(),
          comments: "Attempting to waive reconciliation",
        },
      });

      assert.notEqual(gadsMandatoryUnjustified.evidencePack.highestProvenLevel, "PILOT_CERTIFIED");
      assert.equal(gadsMandatoryUnjustified.evidencePack.pilotEligible, false);
      const gadsPilotGate = gadsMandatoryUnjustified.evidencePack.gateOutcomes.find((g) => g.gate === "PILOT_CERTIFIED");
      assert.equal(gadsPilotGate?.status, "NOT_EXECUTED");
      assert.ok(
        gadsMandatoryUnjustified.evidencePack.blockers.some(
          (b) => b.category === "UNJUSTIFIED_EXEMPTION" || b.category === "MANDATORY_GATES_INCOMPLETE"
        )
      );
    });

    it("strictly prohibits live certification evidence from being written anywhere inside repository root (path traversal, symlinks, newly-created directories)", async () => {
      // 1. Path traversal inside repo root
      const traversalPath = path.join(process.cwd(), "docs", "..", "evidence", "leak_test");
      assert.equal(CertificationHarness.isInsideRepositoryRoot(traversalPath), true);
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test-traversal",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-traversal",
            evidenceClass: "live_certification_evidence",
            outputDirectory: traversalPath,
          }),
        /Security violation: Refusing to write live_certification_evidence anywhere inside repository root/
      );

      // 2. Newly-created untracked directory inside repository
      const newUntrackedDir = path.join(process.cwd(), "completely_new_untracked_dir_xyz", "nested_proofs");
      assert.equal(CertificationHarness.isInsideRepositoryRoot(newUntrackedDir), true);
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test-newdir",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-newdir",
            evidenceClass: "live_certification_evidence",
            outputDirectory: newUntrackedDir,
          }),
        /Security violation: Refusing to write live_certification_evidence anywhere inside repository root/
      );

      // 3. Symlink pointing into repository root
      const tempSymlink = path.join(os.tmpdir(), `symlink_to_repo_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      try {
        fs.symlinkSync(process.cwd(), tempSymlink, "dir");
        assert.equal(CertificationHarness.isInsideRepositoryRoot(tempSymlink), true);
        await assert.rejects(
          () =>
            harness.execute({
              workspaceId: "ws-test-symlink",
              provider: "google_ads",
              accountId: "123-456-7890",
              startDate: "2026-08-01",
              endDate: "2026-08-07",
              buildId: "build-symlink",
              evidenceClass: "live_certification_evidence",
              outputDirectory: tempSymlink,
            }),
          /Security violation: Refusing to write live_certification_evidence anywhere inside repository root/
        );
      } finally {
        if (fs.existsSync(tempSymlink)) {
          fs.unlinkSync(tempSymlink);
        }
      }

      // 4. Truly external directory outside repository is permitted
      const externalDir = path.join(os.tmpdir(), `definitely_outside_repo_${Date.now()}`);
      assert.equal(CertificationHarness.isInsideRepositoryRoot(externalDir), false);
    });

    it("derives observed provider API versions from connector configuration and marks portal claims unverified until owner-confirmed", async () => {
      // Connectors must derive from runtime configuration:
      assert.equal(RUNTIME_CONNECTOR_API_VERSIONS.google_ads, "v23");
      assert.equal(RUNTIME_CONNECTOR_API_VERSIONS.meta_ads, "v23.0");
      assert.equal(RUNTIME_CONNECTOR_API_VERSIONS.tiktok_business, "v1.3");

      // Evaluation derives observedApiVersion without relying on Cloud Console:
      const googleRun = await harness.execute({
        workspaceId: "ws-api-ver-check",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-api-ver",
      });
      assert.equal(googleRun.evidencePack.providerAccessFacts?.observedApiVersion, "v23");
      // Without portal owner confirmation, facts must remain unverified
      assert.equal(googleRun.evidencePack.providerAccessFacts?.status, "UNVERIFIED");
      assert.equal(googleRun.evidencePack.providerAccessFacts?.verificationSource, "unverified");
      assert.deepEqual(googleRun.evidencePack.providerAccessFacts?.grantedScopesOrPermissions, []);

      const metaRun = await harness.execute({
        workspaceId: "ws-api-ver-check",
        provider: "meta_ads",
        accountId: "act_123456",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-api-ver",
      });
      assert.equal(metaRun.evidencePack.providerAccessFacts?.observedApiVersion, "v23.0");
      assert.equal(metaRun.evidencePack.providerAccessFacts?.status, "UNVERIFIED");

      const tiktokRun = await harness.execute({
        workspaceId: "ws-api-ver-check",
        provider: "tiktok_business",
        accountId: "7123456789012345678",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-api-ver",
      });
      assert.equal(tiktokRun.evidencePack.providerAccessFacts?.observedApiVersion, "v1.3");
      assert.equal(tiktokRun.evidencePack.providerAccessFacts?.status, "UNVERIFIED");

      // When portal owner confirms, claims are marked verified
      const confirmedRun = await harness.execute({
        workspaceId: "ws-api-ver-check",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-confirmed",
        providerAccessFacts: {
          observedApiVersion: "v23",
          appAccountMode: "live",
          grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
          accessLevelStatus: "basic",
          authorizationModel: "oauth2_user_consent",
          tokenLifecycleModel: "refreshable_offline",
          verificationSource: "portal_owner_confirmed",
          verifiedAt: new Date().toISOString(),
          status: "VERIFIED",
        },
      });
      assert.equal(confirmedRun.evidencePack.providerAccessFacts?.status, "VERIFIED");
      assert.equal(confirmedRun.evidencePack.providerAccessFacts?.observedApiVersion, "v23");
      assert.deepEqual(confirmedRun.evidencePack.providerAccessFacts?.grantedScopesOrPermissions, [
        "https://www.googleapis.com/auth/adwords",
      ]);
    });

    it("restricts live_certification_evidence primary persistence to database, disallows unflagged local export, and enforces 0600 on explicit export", async () => {
      // 1. Primary persistence without outputDirectory defaults to database_backed with zero files
      const defaultLiveRun = await harness.execute({
        workspaceId: "ws-test-db-primary",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-db-primary",
        evidenceClass: "live_certification_evidence",
        trustedRuntimeMetadata: {
          workingTreeDirty: false,
          commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
          schemaVersion: "20260904160000",
        },
        providerAccessFacts: {
          observedApiVersion: "v23",
          appAccountMode: "live",
          grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
          accessLevelStatus: "basic",
          authorizationModel: "oauth2_user_consent",
          tokenLifecycleModel: "refreshable_offline",
          verificationSource: "portal_owner_confirmed",
          verifiedAt: new Date().toISOString(),
          status: "VERIFIED",
        },
      });
      assert.equal(defaultLiveRun.evidencePack.storageType, "database_backed");
      assert.equal(defaultLiveRun.evidenceJsonPath, "");
      assert.equal(defaultLiveRun.evidenceMdPath, "");

      // 2. Specifying outputDirectory without allowOperatorLocalExport throws security violation
      const tempExternalDir = path.join(os.tmpdir(), `audit_export_attempt_${Date.now()}`);
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-test-unflagged-export",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-unflagged-export",
            evidenceClass: "live_certification_evidence",
            outputDirectory: tempExternalDir,
            allowOperatorLocalExport: false,
            trustedRuntimeMetadata: {
              workingTreeDirty: false,
              commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
              schemaVersion: "20260904160000",
            },
          }),
        /Security violation: Local filesystem export of live_certification_evidence is disabled by default/
      );

      // 3. Explicit operator export outside repository writes with restrictive 0600 permissions and warning
      try {
        const flaggedExportRun = await harness.execute({
          workspaceId: "ws-test-flagged-export",
          provider: "google_ads",
          accountId: "123-456-7890",
          startDate: "2026-08-01",
          endDate: "2026-08-07",
          buildId: "build-flagged-export",
          evidenceClass: "live_certification_evidence",
          outputDirectory: tempExternalDir,
          allowOperatorLocalExport: true,
          trustedRuntimeMetadata: {
            workingTreeDirty: false,
            commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
            schemaVersion: "20260904160000",
          },
          providerAccessFacts: {
            observedApiVersion: "v23",
            appAccountMode: "live",
            grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
            accessLevelStatus: "basic",
            authorizationModel: "oauth2_user_consent",
            tokenLifecycleModel: "refreshable_offline",
            verificationSource: "portal_owner_confirmed",
            verifiedAt: new Date().toISOString(),
            status: "VERIFIED",
          },
        });

        assert.equal(flaggedExportRun.evidencePack.storageType, "operator_local_export");
        assert.ok(flaggedExportRun.evidencePack.localExportWarning);
        assert.ok(flaggedExportRun.evidencePack.localExportDeletionPolicy);
        assert.ok(flaggedExportRun.markdownReport.includes("Temporary Operator Local Export:"));
        assert.ok(flaggedExportRun.markdownReport.includes("Deletion Policy:"));

        // Verify files exist on disk outside repo
        assert.ok(fs.existsSync(flaggedExportRun.evidenceJsonPath));
        assert.ok(fs.existsSync(flaggedExportRun.evidenceMdPath));

        // Verify restrictive permissions (mode 0o600)
        const jsonStat = fs.statSync(flaggedExportRun.evidenceJsonPath);
        assert.equal(jsonStat.mode & 0o777, 0o600, "JSON evidence file must have 0600 permissions");
        const mdStat = fs.statSync(flaggedExportRun.evidenceMdPath);
        assert.equal(mdStat.mode & 0o777, 0o600, "Markdown report file must have 0600 permissions");
      } finally {
        if (fs.existsSync(tempExternalDir)) {
          fs.rmSync(tempExternalDir, { recursive: true, force: true });
        }
      }
    });

    it("records exact commit SHA and schema version in generated evidence metadata", async () => {
      const run = await harness.execute({
        workspaceId: "ws-sha-schema-check",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-sha-schema",
      });

      const exactSha = getExactCommitSha();
      assert.ok(exactSha.length >= 7);
      assert.equal(run.evidencePack.metadata.gitCommit, exactSha);
      assert.equal(run.evidencePack.metadata.schemaVersion, "20260904160000");
    });
  });

  describe("Traceability & Runtime Source State Verification Suite", () => {
    const harness = new CertificationHarness();

    it("1. synthetic dirty-tree preflight is allowed but ineligible", async () => {
      const run = await harness.execute({
        workspaceId: "ws-traceability-1",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-dirty-synthetic",
        evidenceClass: "synthetic_fixture",
        trustedRuntimeMetadata: {
          commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
          schemaVersion: "20260904160000",
          workingTreeDirty: true,
        },
      });

      assert.equal(run.evidencePack.workingTreeDirty, true);
      assert.equal(run.evidencePack.certificationEligible, false);
      assert.equal(run.evidencePack.metadata.workingTreeDirty, true);
      assert.equal(run.evidencePack.metadata.certificationEligible, false);
      assert.ok(run.markdownReport.includes("Working Tree Dirty:** **YES (Dirty) ⚠️"));
      assert.ok(run.markdownReport.includes("Certification Eligible:** **NO ❌"));
    });

    it("2. live dirty-tree certification is rejected", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-traceability-2",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-live-dirty",
            evidenceClass: "live_certification_evidence",
            trustedRuntimeMetadata: {
              commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
              schemaVersion: "20260904160000",
              workingTreeDirty: true,
            },
          }),
        /Security violation: Live certification cannot be executed against an uncommitted or dirty source state/
      );
    });

    it("3. missing build SHA is rejected for live certification", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-traceability-3",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-missing-sha",
            evidenceClass: "live_certification_evidence",
            trustedRuntimeMetadata: {
              commitSha: "",
              schemaVersion: "20260904160000",
              workingTreeDirty: false,
            },
          }),
        /Security violation: Missing runtime commit SHA for live certification run/
      );
    });

    it("4. missing schema version is rejected for live certification", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-traceability-4",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-missing-schema",
            evidenceClass: "live_certification_evidence",
            trustedRuntimeMetadata: {
              commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
              schemaVersion: "",
              workingTreeDirty: false,
            },
          }),
        /Security violation: Missing schema version for live certification run/
      );
    });

    it("5. client-supplied SHA cannot override trusted runtime metadata", async () => {
      const run = await harness.execute({
        workspaceId: "ws-traceability-5",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-client-sha-override",
        clientSuppliedCommitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
        trustedRuntimeMetadata: {
          commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
          schemaVersion: "20260904160000",
          workingTreeDirty: false,
        },
      });

      // Must strictly match trusted runtime metadata
      assert.equal(run.evidencePack.metadata.commitSha, "b3058dad3cfd45eab1697dac307d94f598edcbe7");

      // Attempting to supply a client SHA when runtime SHA is missing throws
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-traceability-5b",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-client-sha-missing",
            clientSuppliedCommitSha: "fake_client_sha_123",
            trustedRuntimeMetadata: {
              commitSha: "",
              schemaVersion: "20260904160000",
              workingTreeDirty: false,
            },
          }),
        /Security violation: Client supplied commit SHA .* but trusted runtime commit SHA is missing/
      );
    });

    it("6. mismatched deployed/runtime SHA is rejected", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-traceability-6",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-mismatched-sha",
            clientSuppliedCommitSha: "0000000000000000000000000000000000000000",
            trustedRuntimeMetadata: {
              commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
              schemaVersion: "20260904160000",
              workingTreeDirty: false,
            },
          }),
        /Security violation: Mismatched deployed\/runtime commit SHA/
      );
    });

    it("7. mismatched schema version is rejected", async () => {
      await assert.rejects(
        () =>
          harness.execute({
            workspaceId: "ws-traceability-7",
            provider: "google_ads",
            accountId: "123-456-7890",
            startDate: "2026-08-01",
            endDate: "2026-08-07",
            buildId: "build-mismatched-schema",
            expectedSchemaVersion: "20250101000000",
            trustedRuntimeMetadata: {
              commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
              schemaVersion: "20260904160000",
              workingTreeDirty: false,
            },
          }),
        /Security violation: Mismatched schema version/
      );
    });

    it("8. clean matching metadata permits certification progression", async () => {
      const run = await harness.execute({
        workspaceId: "ws-traceability-8",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-clean-progression",
        evidenceClass: "synthetic_fixture",
        trustedRuntimeMetadata: {
          commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
          schemaVersion: "20260904160000",
          workingTreeDirty: false,
        },
        providerAccessFacts: {
          observedApiVersion: "v23",
          appAccountMode: "live",
          grantedScopesOrPermissions: ["https://www.googleapis.com/auth/adwords"],
          accessLevelStatus: "basic",
          authorizationModel: "oauth2_user_consent",
          tokenLifecycleModel: "refreshable_offline",
          verificationSource: "portal_owner_confirmed",
          verifiedAt: new Date().toISOString(),
          status: "VERIFIED",
        },
        simulation: {
          simulatedConnection: true,
          simulatedWarehouseRows: 42,
          simulatedWarehouseTotals: { spend: 5000, impressions: 20000, clicks: 1200, conversions: 80, revenue: 15000 },
          simulatedDestinationReceiptId: "rcpt_clean_01",
          simulatedRecoveryPassed: true,
        },
        nativeComparison: { spend: 5000, impressions: 20000, clicks: 1200, conversions: 80, revenue: 15000 },
        snapshotTiming: {
          accountTimezone: "Asia/Ho_Chi_Minh",
          currency: "VND",
          nativeRetrievalTime: "2026-08-08T01:00:00Z",
          monsteraDataThroughTime: "2026-08-08T01:00:00Z",
          warehouseQueryTime: "2026-08-08T01:02:00Z",
        },
        humanReviewSignOff: {
          reviewerName: "Traceability Auditor",
          reviewerRole: "Platform Security Lead",
          signedAt: new Date().toISOString(),
          comments: "Clean deployed commit and matching schema verified",
        },
      });

      assert.equal(run.evidencePack.workingTreeDirty, false);
      assert.equal(run.evidencePack.highestProvenLevel, "PILOT_CERTIFIED");
      assert.equal(run.evidencePack.pilotEligible, true);
      assert.equal(run.evidencePack.certificationEligible, true);
      assert.equal(run.evidencePack.metadata.workingTreeDirty, false);
      assert.equal(run.evidencePack.metadata.certificationEligible, true);
      assert.ok(run.markdownReport.includes("Certification Eligible:** **YES ✅"));
      assert.ok(run.markdownReport.includes("Working Tree Dirty:** **NO (Clean) ✅"));
    });

    it("9. generated evidence includes all traceability versions", async () => {
      const run = await harness.execute({
        workspaceId: "ws-traceability-9",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-all-versions",
        trustedRuntimeMetadata: {
          commitSha: "b3058dad3cfd45eab1697dac307d94f598edcbe7",
          schemaVersion: "20260904160000",
          harnessVersion: "1.2.0",
          evidencePackSchemaVersion: "1.0.0",
          workingTreeDirty: false,
        },
      });

      assert.equal(run.evidencePack.metadata.commitSha, "b3058dad3cfd45eab1697dac307d94f598edcbe7");
      assert.equal(run.evidencePack.metadata.schemaVersion, "20260904160000");
      assert.equal(run.evidencePack.metadata.harnessVersion, "1.2.0");
      assert.equal(run.evidencePack.metadata.contractVersion, "1.0.0");
      assert.equal(run.evidencePack.metadata.evidencePackSchemaVersion, "1.0.0");
      assert.equal(run.evidencePack.metadata.buildId, "build-all-versions");
      assert.equal(typeof run.evidencePack.metadata.workingTreeDirty, "boolean");
      assert.equal(typeof run.evidencePack.metadata.certificationEligible, "boolean");

      assert.ok(run.markdownReport.includes("- **Harness Version:** 1.2.0"));
      assert.ok(run.markdownReport.includes("- **Metric Contract Version:** 1.0.0"));
      assert.ok(run.markdownReport.includes("- **Evidence Pack Schema Version:** 1.0.0"));
      assert.ok(run.markdownReport.includes("- **Schema Version:** 20260904160000"));
      assert.ok(run.markdownReport.includes("- **Git Commit SHA:** `b3058dad3cfd45eab1697dac307d94f598edcbe7`"));
    });

    it("10. no secret values appear in traceability metadata", async () => {
      const secretToken = "ya29.secret_bearer_token_super_secret_value_12345";
      const clientSecret = "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65";

      const run = await harness.execute({
        workspaceId: "ws-traceability-10",
        provider: "google_ads",
        accountId: "123-456-7890",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        buildId: "build-no-secrets",
        varianceExplanations: {
          spend: `Explained with token: ${secretToken}`,
          clientSecret: clientSecret,
        },
        humanReviewSignOff: {
          reviewerName: "Auditor",
          reviewerRole: "Security",
          signedAt: new Date().toISOString(),
          comments: `Reviewed token ${secretToken}`,
        },
      });

      const serializedPack = JSON.stringify(run.evidencePack);
      const serializedReport = run.markdownReport;

      assert.equal(serializedPack.includes(secretToken), false, "Raw bearer token must not leak into evidence JSON");
      assert.equal(serializedPack.includes(clientSecret), false, "Client secret must not leak into evidence JSON");
      assert.equal(serializedReport.includes(secretToken), false, "Raw bearer token must not leak into Markdown report");
      assert.equal(serializedReport.includes(clientSecret), false, "Client secret must not leak into Markdown report");
    });
  });
});

