import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import prisma from "./prisma";
import {
  PilotActivationConflictError,
  recordDashboardReviewMilestone,
} from "./pilot-activation-store";

const originalCampaignMetric = (prisma as any).campaignMetric;
const originalAuditEvent = (prisma as any).auditEvent;

describe("pilot activation milestone storage", () => {
  let upsertCalls = 0;

  beforeEach(() => {
    upsertCalls = 0;
    (prisma as any).campaignMetric = {
      count: async () => 4,
      aggregate: async () => ({ _max: { date: new Date("2026-09-03T00:00:00.000Z") } }),
    };
    (prisma as any).auditEvent = {
      findFirst: async () => null,
      upsert: async ({ create }: any) => {
        upsertCalls += 1;
        assert.equal(create.workspaceId, "workspace-a");
        assert.equal(create.actorUserId, "user-a");
        return { createdAt: new Date("2026-09-03T01:00:00.000Z") };
      },
    };
  });

  afterEach(() => {
    (prisma as any).campaignMetric = originalCampaignMetric;
    (prisma as any).auditEvent = originalAuditEvent;
  });

  it("rejects review recording when no recent KPI rows exist", async () => {
    (prisma as any).campaignMetric.count = async () => 0;
    await assert.rejects(
      () => recordDashboardReviewMilestone({ workspaceId: "workspace-a", actorUserId: "user-a" }),
      PilotActivationConflictError,
    );
    assert.equal(upsertCalls, 0);
  });

  it("uses a deterministic upsert so repeat requests cannot create duplicate milestones", async () => {
    const first = await recordDashboardReviewMilestone({ workspaceId: "workspace-a", actorUserId: "user-a" });
    assert.equal(first.rows7d, 4);
    assert.equal(upsertCalls, 1);

    (prisma as any).auditEvent.findFirst = async () => ({
      createdAt: new Date("2026-09-03T01:00:00.000Z"),
    });
    const repeat = await recordDashboardReviewMilestone({ workspaceId: "workspace-a", actorUserId: "user-a" });
    assert.equal(repeat.rows7d, 4);
    assert.equal(upsertCalls, 1);
  });
});
