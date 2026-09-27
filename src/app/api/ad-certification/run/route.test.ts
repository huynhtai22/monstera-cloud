import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { CertificationHarness, CURRENT_SCHEMA_VERSION } from "@/lib/ad-certification/harness";
import { POST } from "./route";

const savedPrisma = {
  user: (prisma as any).user,
  evidencePackRecord: (prisma as any).evidencePackRecord,
  auditEvent: (prisma as any).auditEvent,
  $queryRaw: (prisma as any).$queryRaw,
};
const envKeys = ["AD_CERTIFICATION_LIVE_RUNS_ENABLED", "RUNTIME_COMMIT_SHA", "RUNTIME_SCHEMA_VERSION", "BUILD_WORKING_TREE_DIRTY"] as const;
const savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalExecute = CertificationHarness.prototype.execute;
let userRole = "OPERATOR";
let executionInput: any;
let durable = true;
let appliedSchemaVersion: string | undefined = CURRENT_SCHEMA_VERSION;
let migrationQueryFails = false;

const evidencePack = {
  runId: "cert_google_ads_test",
  provider: "google_ads",
  highestProvenLevel: "CODE_VERIFIED",
  blockers: [],
};

function request(body: unknown) {
  return new Request("https://monstera.test/api/ad-certification/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  workspaceId: "workspace-1",
  connectionId: "connection-1",
  accountId: "123-456-7890",
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  nativeComparison: { spend: 10, impressions: 100, clicks: 5, conversions: 1, revenue: 25 },
  snapshotTiming: {
    nativeRetrievalTime: "2026-09-08T01:00:00.000Z",
    monsteraDataThroughTime: "2026-09-08T01:00:00.000Z",
    warehouseQueryTime: "2026-09-08T01:01:00.000Z",
  },
};

describe("POST /api/ad-certification/run", () => {
  beforeEach(() => {
    userRole = "OPERATOR";
    executionInput = undefined;
    durable = true;
    appliedSchemaVersion = CURRENT_SCHEMA_VERSION;
    migrationQueryFails = false;
    process.env.AD_CERTIFICATION_LIVE_RUNS_ENABLED = "true";
    process.env.RUNTIME_COMMIT_SHA = "b3058dad3cfd45eab1697dac307d94f598edcbe7";
    process.env.RUNTIME_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
    process.env.BUILD_WORKING_TREE_DIRTY = "false";
    setAuthSessionOverride(async () => ({
      user: { id: "operator-1", email: "operator@example.test" },
      expires: new Date(Date.now() + 60_000).toISOString(),
    }));
    (prisma as any).user = { findUnique: async () => ({ id: "operator-1", platformRole: userRole }) };
    (prisma as any).evidencePackRecord = { findFirst: async () => durable ? { id: "evidence-1" } : null };
    (prisma as any).auditEvent = { findFirst: async () => durable ? { id: "audit-1" } : null };
    (prisma as any).$queryRaw = async () => {
      if (migrationQueryFails) throw new Error("migration table unavailable");
      return appliedSchemaVersion ? [{ migration_name: appliedSchemaVersion }] : [];
    };
    CertificationHarness.prototype.execute = async function (input: any) {
      executionInput = input;
      return { evidencePack, markdownReport: "sanitized report", evidenceJsonPath: "", evidenceMdPath: "" } as any;
    };
  });

  after(() => {
    for (const [key, value] of Object.entries(savedPrisma)) (prisma as any)[key] = value;
    for (const key of envKeys) {
      const value = savedEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    CertificationHarness.prototype.execute = originalExecute;
  });

  it("runs only as an operator and supplies server-derived live provenance", async () => {
    const response = await POST(request(validBody));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(executionInput.provider, "google_ads");
    assert.equal(executionInput.evidenceClass, "live_certification_evidence");
    assert.equal(executionInput.buildId, process.env.RUNTIME_COMMIT_SHA);
    assert.equal(executionInput.trustedRuntimeMetadata.commitSha, process.env.RUNTIME_COMMIT_SHA);
    assert.equal(executionInput.trustedRuntimeMetadata.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(executionInput.accountId, "1234567890");
    assert.equal("trustedRuntimeMetadata" in validBody, false);
  });

  it("rejects runs when the database migration state differs from the deployed schema", async () => {
    appliedSchemaVersion = "20260901000000_stale_database";
    const response = await POST(request(validBody));
    assert.equal(response.status, 409);
    assert.equal(executionInput, undefined);
  });

  it("fails closed when applied migration metadata cannot be read", async () => {
    migrationQueryFails = true;
    const response = await POST(request(validBody));
    assert.equal(response.status, 503);
    assert.equal(executionInput, undefined);
  });

  it("rejects non-operators and caller-supplied simulation controls", async () => {
    userRole = "USER";
    const forbidden = await POST(request(validBody));
    assert.equal(forbidden.status, 403);
    userRole = "OPERATOR";
    const simulation = await POST(request({ ...validBody, simulatedConnection: true }));
    assert.equal(simulation.status, 400);
    assert.equal(executionInput, undefined);
  });

  it("keeps live runs disabled unless the deployment flag is explicitly enabled", async () => {
    delete process.env.AD_CERTIFICATION_LIVE_RUNS_ENABLED;
    const response = await POST(request(validBody));
    assert.equal(response.status, 503);
    assert.equal(executionInput, undefined);
  });

  it("enforces the bounded 7-day window and requires durable evidence storage", async () => {
    const longWindow = await POST(request({ ...validBody, endDate: "2026-09-08" }));
    assert.equal(longWindow.status, 400);
    assert.equal(executionInput, undefined);
    durable = false;
    const notSaved = await POST(request(validBody));
    assert.equal(notSaved.status, 503);
    assert.match((await notSaved.json()).error, /durably persisted/);
  });
});
