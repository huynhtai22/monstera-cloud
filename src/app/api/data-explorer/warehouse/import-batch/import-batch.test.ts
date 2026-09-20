import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  assertBatchHistoricalExecutionAllowed,
} from "./route";
import {
  processBatchItems,
  runDurableImportWorker,
} from "@/lib/warehouse-import-worker";
import prisma from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

describe("Batch Import Worker & Post-Refresh Data Quality Gating", () => {
  const mockWorkspaceId = "ws-batch-dq-test";
  const mockJobId = "job-dq-batch-1";
  const mockLeaseId = "lease-valid-123";

  let checkedConnections: string[] = [];

  it("never calls a provider with a stale initial worker lease", async () => {
    let calls = 0;
    (prisma as any).warehouseImportJob.updateMany = async () => ({ count: 0 });
    await runDurableImportWorker(mockJobId, "stale-lease", (async () => {
      calls++;
      return { success: true, rowsIngested: 0 };
    }) as any);
    assert.equal(calls, 0);
  });

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    checkedConnections = [];

    const encryptedCredentials = encrypt(JSON.stringify({
      accessToken: "mock-access-token",
      extraFields: {
        advertiserIds: ["7677495922629787656", "7677495922629787000"],
        selectedAdvertiserIds: ["7677495922629787656", "7677495922629787000"],
      },
    }));

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
      findFirst: async ({ where }: any) => {
        if (where.id === mockJobId) {
          return {
            id: mockJobId,
            status: "running",
            leaseId: mockLeaseId,
            leaseExpiresAt: new Date(Date.now() + 60_000),
            idempotencyKey: null,
          };
        }
        return null;
      },
      updateMany: async () => ({ count: 1 }),
    };

    // Legacy jobs predate chunk materialization: no relational chunks exist.
    (prisma as any).warehouseBackfillChunk = {
      count: async () => 0,
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
          provider: "google_ads",
          credentials: encryptedCredentials,
          status: "connected",
        },
      ],
    };

    // Mock workspaceProviderAccess in prisma
    (prisma as any).workspaceProviderAccess = {
      findMany: async () => [
        { provider: "meta_ads", enabled: true },
        { provider: "google_ads", enabled: true },
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

  it("carries provider continuation state into and out of targeted retries", async () => {
    const encryptedCredentials = encrypt(JSON.stringify({ accessToken: "mock-access-token" }));
    (prisma as any).connection.findMany = async () => [{
      id: "conn-tiktok",
      workspaceId: mockWorkspaceId,
      provider: "tiktok_business",
      remoteAccountId: "7677495922629787656",
      credentials: encryptedCredentials,
      status: "error",
    }];
    (prisma as any).workspaceProviderAccess.findMany = async () => [
      { provider: "tiktok_business", enabled: true },
    ];

    const providerState = {
      provider: "tiktok_business" as const,
      advertiserId: "7677495922629787656",
      reportTaskId: "7679241688576950293",
    };
    let receivedState: unknown;
    let receivedCredentials: any;
    const results = await processBatchItems({
      workspaceId: mockWorkspaceId,
      since: "2026-08-01",
      until: "2026-08-29",
      plan: "pilot",
      items: [{ connectionId: "conn-tiktok", accountId: providerState.advertiserId, providerState }],
      syncFn: (async (options: { providerState?: unknown; credentials?: unknown }) => {
        receivedState = options.providerState;
        receivedCredentials = options.credentials;
        return {
          success: false,
          outcome: "failed",
          rowsIngested: 0,
          error: "still processing",
          children: [{
            id: providerState.advertiserId,
            kind: "advertiser",
            ok: false,
            retryable: true,
            retryState: providerState,
          }],
        };
      }) as any,
    });

    assert.deepEqual(receivedState, providerState);
    assert.deepEqual(receivedCredentials.selectedAdvertiserIds, [providerState.advertiserId]);
    assert.deepEqual(receivedCredentials.extraFields.selectedAdvertiserIds, [providerState.advertiserId]);
    assert.deepEqual(results[0].retryItems, [{
      connectionId: "conn-tiktok",
      accountId: providerState.advertiserId,
      providerState,
    }]);
  });

  it("executes a durable item only within its explicit chunk range", async () => {
    const receivedRanges: Array<{ since: string; until: string }> = [];
    const results = await processBatchItems({
      workspaceId: mockWorkspaceId,
      since: "2026-06-01",
      until: "2026-08-29",
      plan: "pro",
      items: [{
        connectionId: "conn-success-1",
        executionSince: "2026-07-31",
        executionUntil: "2026-08-29",
      }],
      syncFn: (async (options: { since: string; until: string }) => {
        receivedRanges.push({ since: options.since, until: options.until });
        return { success: true, rowsIngested: 1 };
      }) as any,
    });

    assert.deepEqual(receivedRanges, [{ since: "2026-07-31", until: "2026-08-29" }]);
    assert.equal(results[0]?.executionSince, "2026-07-31");
    assert.equal(results[0]?.executionUntil, "2026-08-29");
  });

  it("fails closed before plan clamping can dispatch a generic 90-day Meta request", async () => {
    await assert.rejects(
      () => assertBatchHistoricalExecutionAllowed({
        workspaceId: mockWorkspaceId,
        since: "2026-06-01",
        until: "2026-08-29",
        planMaximumDays: 14,
        items: [{ connectionId: "conn-success-1" }],
      }),
      (error: unknown) =>
        error instanceof Error && error.message.includes("REQUEST_CHUNKING_NOT_IMPLEMENTED"),
    );
  });
});
