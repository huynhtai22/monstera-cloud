import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { mapToCanonical } from "@/etl/transform";
import {
  decideSchemaPatchProposal,
  loadApprovedMappingOverlay,
  sanitizeMappingDelta,
} from "@/lib/ai/mapping-overlay";

type Proposal = {
  id: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
  status: string;
  mappingDelta: string;
  breaking: boolean;
  note: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  createdAt: Date;
};

describe("sanitizeMappingDelta", () => {
  it("keeps canonical targets and drops compile-time keys and unknown targets", () => {
    const out = sanitizeMappingDelta(
      {
        reach: "impressions",
        spend: "spend",
        mystery: "not_a_column",
        conversion_value: "revenue",
      },
      { spend: "spend" },
    );
    assert.deepEqual(out, { reach: "impressions", conversion_value: "revenue" });
  });
});

describe("mapToCanonical overlay", () => {
  it("applies OPERATOR overlay before global aliases", () => {
    const mapped = mapToCanonical(
      { reach: 12, spend: "4.5" },
      { platform: "meta_ads", pipelineId: "p1", connectionId: "c1" },
      { reach: "impressions" },
    );
    assert.equal(mapped.impressions, 12);
    assert.equal(mapped.spend, 4.5);
  });
});

describe("decideSchemaPatchProposal", () => {
  const proposals: Proposal[] = [];
  const audits: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    proposals.length = 0;
    audits.length = 0;
    (prisma as any).schemaPatchProposal = {
      findUnique: async ({ where }: any) => proposals.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        proposals.filter((p) => {
          if (where.workspaceId && p.workspaceId !== where.workspaceId) return false;
          if (where.connectionId && p.connectionId !== where.connectionId) return false;
          if (where.status && p.status !== where.status) return false;
          if (where.breaking === false && p.breaking) return false;
          return true;
        }),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const p of proposals) {
          if (where.id && p.id !== where.id) continue;
          if (where.workspaceId && p.workspaceId !== where.workspaceId) continue;
          if (where.status && p.status !== where.status) continue;
          Object.assign(p, data);
          count += 1;
        }
        return { count };
      },
    };
    (prisma as any).auditEvent = {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    };
  });

  it("rejects a pending proposal and writes an audit row", async () => {
    proposals.push({
      id: "p1",
      workspaceId: "ws-a",
      connectionId: "c1",
      provider: "meta_ads",
      status: "pending",
      mappingDelta: JSON.stringify({ reach: "impressions" }),
      breaking: false,
      note: null,
      decidedAt: null,
      decidedBy: null,
      createdAt: new Date(),
    });
    const result = await decideSchemaPatchProposal({
      proposalId: "p1",
      decision: "rejected",
      operatorUserId: "op-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.decision, "rejected");
    assert.equal(proposals[0].status, "rejected");
    assert.equal(audits[0]?.action, "schema_patch.rejected");
    assert.equal(audits[0]?.workspaceId, "ws-a");
  });

  it("applies an additive overlay on approve", async () => {
    proposals.push({
      id: "p2",
      workspaceId: "ws-a",
      connectionId: "c1",
      provider: "meta_ads",
      status: "pending",
      mappingDelta: JSON.stringify({ conversion_value: "revenue", junk: "nope" }),
      breaking: false,
      note: null,
      decidedAt: null,
      decidedBy: null,
      createdAt: new Date(),
    });
    const result = await decideSchemaPatchProposal({
      proposalId: "p2",
      decision: "approved",
      operatorUserId: "op-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.overlayApplied, { conversion_value: "revenue" });
    }
    assert.equal(proposals[0].status, "approved");
    assert.equal(audits[0]?.action, "schema_patch.approved");
    const overlay = await loadApprovedMappingOverlay("ws-a", "c1", "meta_ads");
    assert.deepEqual(overlay, { conversion_value: "revenue" });
  });

  it("refuses to overlay a breaking proposal and leaves it pending", async () => {
    proposals.push({
      id: "p3",
      workspaceId: "ws-a",
      connectionId: "c1",
      provider: "meta_ads",
      status: "pending",
      mappingDelta: "{}",
      breaking: true,
      note: "required missing",
      decidedAt: null,
      decidedBy: null,
      createdAt: new Date(),
    });
    const result = await decideSchemaPatchProposal({
      proposalId: "p3",
      decision: "approved",
      operatorUserId: "op-1",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 409);
      assert.equal(result.error, "breaking_requires_engineer_pr");
    }
    assert.equal(proposals[0].status, "pending");
    assert.equal(audits.length, 0);
  });

  it("does not apply another workspace's overlay", async () => {
    proposals.push({
      id: "p4",
      workspaceId: "ws-b",
      connectionId: "c1",
      provider: "meta_ads",
      status: "approved",
      mappingDelta: JSON.stringify({ conversion_value: "revenue" }),
      breaking: false,
      note: null,
      decidedAt: new Date(),
      decidedBy: "op-1",
      createdAt: new Date(),
    });
    const overlay = await loadApprovedMappingOverlay("ws-a", "c1", "meta_ads");
    assert.deepEqual(overlay, {});
  });
});
