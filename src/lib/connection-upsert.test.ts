import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import prisma from "./prisma";
import { canonicalizeRemoteAccountId, upsertSourceConnection } from "./connection-upsert";

describe("connection upsert reconnect recovery and MCC deduplication", () => {
  const rows = new Map<string, any>();

  beforeEach(() => {
    rows.clear();
    (prisma as any).connection = {
      findUnique: async ({ where }: any) => {
        const key = where.workspaceId_provider_remoteAccountId;
        if (!key) return null;
        const id = `${key.workspaceId}:${key.provider}:${key.remoteAccountId}`;
        return rows.get(id) ?? null;
      },
      findMany: async ({ where }: any) => {
        return Array.from(rows.values()).filter(
          (r) => r.workspaceId === where.workspaceId && r.provider === where.provider
        );
      },
      update: async ({ where, data }: any) => {
        for (const [key, val] of rows.entries()) {
          if (val.id === where.id) {
            const next = {
              ...val,
              ...data,
              updatedAt: data.updatedAt ?? new Date(),
            };
            rows.delete(key);
            const newKey = `${next.workspaceId}:${next.provider}:${next.remoteAccountId}`;
            rows.set(newKey, next);
            return next;
          }
        }
        throw new Error("Record not found for update");
      },
      create: async ({ data }: any) => {
        const created = {
          id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
          lastSyncAt: null,
          ...data,
        };
        const key = `${created.workspaceId}:${created.provider}:${created.remoteAccountId}`;
        rows.set(key, created);
        return created;
      },
      upsert: async ({ where, update, create }: any) => {
        const key = where.workspaceId_provider_remoteAccountId;
        const id = `${key.workspaceId}:${key.provider}:${key.remoteAccountId}`;
        const existing = rows.get(id);
        if (existing) {
          const next = {
            ...existing,
            ...update,
            id: existing.id,
            workspaceId: existing.workspaceId,
            createdAt: existing.createdAt,
            updatedAt: update.updatedAt ?? new Date(),
          };
          rows.set(id, next);
          return next;
        }
        const created = {
          id: "conn_new",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
          lastSyncAt: null,
          ...create,
        };
        rows.set(id, created);
        return created;
      },
    };
  });

  it("clears lastError and preserves identity on reconnect upsert", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    rows.set("ws-a:meta_ads:act_1", {
      id: "conn_existing",
      workspaceId: "ws-a",
      provider: "meta_ads",
      remoteAccountId: "act_1",
      name: "Old",
      type: "source",
      credentials: "enc-old",
      status: "error",
      lastError: "Error 190: token revoked",
      lastSyncAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "01".repeat(32);

    const result = await upsertSourceConnection({
      workspaceId: "ws-a",
      provider: "meta_ads",
      remoteAccountId: "act_1",
      name: "Meta Ads",
      type: "source",
      credentials: { access_token: "new-token" },
      status: "connected",
    });

    assert.equal(result.created, false);
    assert.equal(result.id, "conn_existing");
    assert.equal(result.workspaceId, "ws-a");
    assert.equal(result.remoteAccountId, "act_1");
    assert.equal(result.status, "connected");
    assert.equal(result.lastError, null);
    assert.equal(JSON.stringify(result).includes("new-token"), false);
  });

  it("deduplicates identical MCC accounts across dashed and raw ID formats", async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "01".repeat(32);
    
    // Seed existing connection with raw ID
    rows.set("ws-a:google_ads:1581709190", {
      id: "conn_mcc_1",
      workspaceId: "ws-a",
      provider: "google_ads",
      remoteAccountId: "1581709190",
      name: "Google Ads (8 accounts)",
      type: "source",
      credentials: "enc-old",
      status: "connected",
    });

    // Attempt to upsert with dashed format "158-170-9190"
    const result = await upsertSourceConnection({
      workspaceId: "ws-a",
      provider: "google_ads",
      remoteAccountId: "158-170-9190",
      name: "Google Ads",
      type: "source",
      credentials: { refresh_token: "secret", customerIds: ["1581709190"] },
    });

    // Must update existing connection, NOT create a second duplicate row
    assert.equal(result.created, false);
    assert.equal(result.id, "conn_mcc_1");
    assert.equal(result.remoteAccountId, "1581709190");
    assert.equal(rows.size, 1);
  });

  it("canonicalizes remoteAccountId correctly across providers", () => {
    assert.equal(canonicalizeRemoteAccountId("google_ads", "158-170-9190"), "1581709190");
    assert.equal(canonicalizeRemoteAccountId("google_ads", "", { customerIds: ["999-888-7777"] }), "9998887777");
    assert.equal(canonicalizeRemoteAccountId("meta_ads", "123456789"), "act_123456789");
    assert.equal(canonicalizeRemoteAccountId("meta_ads", "act_123456789"), "act_123456789");
    assert.equal(canonicalizeRemoteAccountId("shopee", "", { shop_id: 12345 }), "12345");
  });

  it("marks a first-time identity as created", async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "01".repeat(32);
    const result = await upsertSourceConnection({
      workspaceId: "ws-a",
      provider: "google_ads",
      remoteAccountId: "9876543210",
      name: "Google Ads",
      type: "source",
      credentials: { refresh_token: "secret" },
    });
    assert.equal(result.created, true);
    assert.equal(result.lastError, null);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
});
