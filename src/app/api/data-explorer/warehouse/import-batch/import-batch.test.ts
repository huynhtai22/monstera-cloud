import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { runDurableImportWorker } from "./route";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

describe("Batch Import Worker & Post-Refresh Data Quality Gating", () => {
  const mockWorkspaceId = "ws-batch-dq-test";
  const mockJobId = "job-dq-batch-1";
  const mockLeaseId = "lease-valid-123";

  let checkedConnections: string[] = [];

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    checkedConnections = [];

    const encryptedCredentials = encrypt(JSON.stringify({ accessToken: "mock-access-token" }));

    // Mock warehouseImportJob in prisma
    (prisma as any).warehouseImportJob = {
      findUnique: async ({ where }: any) => {
        if (where.id === mockJobId) {
          return {
            id: mockJobId,
            workspaceId: mockWorkspaceId,
            plan: "pilot",
            since: "2026-01-01",
            until: "2026-01-10",
            status: "running",
            leaseId: mockLeaseId,
            items: [
              { connectionId: "conn-success-1" },
              { connectionId: "conn-success-1" }, // Duplicate connectionId in same job
              { connectionId: "conn-success-2" },
              { connectionId: "conn-failed-3" },
            ],
          };
        }
        return null;
      },
      updateMany: async () => ({ count: 1 }),
    };

    // Mock connection in prisma
    (prisma as any).connection = {
      findMany: async () => [
        {
          id: "conn-success-1",
          workspaceId: mockWorkspaceId,
          provider: "meta_ads",
          credentials: encryptedCredentials,
          status: "connected",
        },
        {
          id: "conn-success-2",
          workspaceId: mockWorkspaceId,
          provider: "shopify",
          credentials: encryptedCredentials,
          status: "connected",
        },
        // conn-failed-3 is absent / disconnected -> will fail
      ],
    };

    // Mock dataQualityRule to track post-refresh quality check invocations
    (prisma as any).dataQualityRule = {
      findMany: async ({ where }: any) => {
        if (where.OR) {
          for (const clause of where.OR) {
            if (clause.connectionId) {
              checkedConnections.push(clause.connectionId);
            }
          }
        }
        return [];
      },
    };

    (prisma as any).dataQualityViolation = {
      create: async ({ data }: any) => ({ id: "v-1", ...data }),
    };
  });

  it("awaits post-refresh data quality checks exactly once per successful connection and skips failed connections", async () => {
    const mockSyncFn = async () => ({
      success: true,
      rowsIngested: 100,
    });

    await runDurableImportWorker(mockJobId, mockLeaseId, mockSyncFn as any);

    // conn-success-1 had 2 items -> deduplicated to 1 check
    // conn-success-2 had 1 item -> 1 check
    // conn-failed-3 failed -> 0 checks
    assert.equal(checkedConnections.length, 2);
    assert.ok(checkedConnections.includes("conn-success-1"));
    assert.ok(checkedConnections.includes("conn-success-2"));
    assert.ok(!checkedConnections.includes("conn-failed-3"));
  });
});
