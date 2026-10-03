import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import prisma from "@/lib/prisma";
import { computeStaleRowStats } from "./provider-row-reconciliation";

describe("provider-row-reconciliation unit tests", () => {
  beforeEach(() => {
    (prisma as any).campaignMetric = {
      findMany: async ({ where }: any) => {
        // Return entityIds in warehouse
        if (where.connectionId === "conn-1" && where.accountId === "act-1") {
          return [
            { entityId: "camp-1" },
            { entityId: "camp-2" },
            { entityId: "camp-3" },
          ];
        }
        return [];
      },
    };
  });

  it("returns null if fetchComplete is false", async () => {
    const stats = await computeStaleRowStats({
      workspaceId: "ws-1",
      connectionId: "conn-1",
      accountId: "act-1",
      level: "campaign",
      since: new Date("2026-08-01"),
      until: new Date("2026-08-05"),
      providerEntityIds: ["camp-1"],
      fetchComplete: false,
    });

    assert.equal(stats, null);
  });

  it("identifies stale entity ids when provider fetch is complete", async () => {
    const stats = await computeStaleRowStats({
      workspaceId: "ws-1",
      connectionId: "conn-1",
      accountId: "act-1",
      level: "campaign",
      since: new Date("2026-08-01"),
      until: new Date("2026-08-05"),
      // Provider only returned camp-1 and camp-2. camp-3 is missing in provider!
      providerEntityIds: ["camp-1", "camp-2"],
      fetchComplete: true,
    });

    assert.ok(stats);
    assert.equal(stats.warehouseEntityCount, 3);
    assert.equal(stats.providerEntityCount, 2);
    assert.equal(stats.staleRowCount, 1);
    assert.deepEqual(stats.staleEntityIds, ["camp-3"]);
  });

  it("handles provider returning additional new entities without flagging staleness", async () => {
    const stats = await computeStaleRowStats({
      workspaceId: "ws-1",
      connectionId: "conn-1",
      accountId: "act-1",
      level: "campaign",
      since: new Date("2026-08-01"),
      until: new Date("2026-08-05"),
      // Provider returned all existing plus new ones
      providerEntityIds: ["camp-1", "camp-2", "camp-3", "camp-4"],
      fetchComplete: true,
    });

    assert.ok(stats);
    assert.equal(stats.staleRowCount, 0);
    assert.deepEqual(stats.staleEntityIds, []);
  });
});
