import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { upsertSourceConnection } from "./connection-upsert";

describe("connection upsert reconnect recovery", () => {
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

  it("marks a first-time identity as created", async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "01".repeat(32);
    const result = await upsertSourceConnection({
      workspaceId: "ws-a",
      provider: "google_ads",
      remoteAccountId: "123",
      name: "Google Ads",
      type: "source",
      credentials: { refresh_token: "secret" },
    });
    assert.equal(result.created, true);
    assert.equal(result.lastError, null);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
});
