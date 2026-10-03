import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import prisma from "./prisma";
import { createOAuthAttempt, consumeOAuthAttempt, oauthAttemptCookieName } from "./oauth-attempt";

const originalOAuthAttempt = (prisma as any).oAuthAttempt;

describe("OAuth workspace preservation", () => {
  let store: Map<string, any>;
  let originalTransaction: any;
  beforeEach(() => {
    store = new Map();
    originalTransaction = (prisma as any).$transaction;
    (prisma as any).oAuthAttempt = {
      create: async ({ data }: any) => {
        const id = `attempt-${store.size + 1}`;
        const record = { id, ...data, consumedAt: null, expiresAt: data.expiresAt };
        store.set(data.tokenHash, record);
        return record;
      },
      findUnique: async ({ where }: any) => store.get(where.tokenHash) ?? null,
      updateMany: async ({ where, data }: any) => {
        const rec = Array.from(store.values()).find((r) => r.id === where.id);
        if (!rec || rec.consumedAt || rec.expiresAt <= new Date()) return { count: 0 };
        Object.assign(rec, data);
        return { count: 1 };
      },
    };
    (prisma as any).$transaction = async (fn: any) => {
      const tx = { oAuthAttempt: (prisma as any).oAuthAttempt };
      return fn(tx);
    };
  });
  afterEach(() => {
    (prisma as any).oAuthAttempt = originalOAuthAttempt;
    (prisma as any).$transaction = originalTransaction;
  });

  it("preserves the selected workspace ID through the OAuth state", async () => {
    const token = await createOAuthAttempt({
      userId: "user-a",
      workspaceId: "workspace-a",
      provider: "meta_ads",
    });
    assert.ok(token.length > 20);
    const cookieName = oauthAttemptCookieName("meta_ads");
    assert.equal(cookieName, "monstera_oauth_meta_ads");

    const consumed = await consumeOAuthAttempt({ token, provider: "meta_ads", sessionUserId: "user-a" });
    assert.equal(consumed.workspaceId, "workspace-a");
    assert.equal(consumed.userId, "user-a");
  });

  it("rejects replayed or expired state", async () => {
    const token = await createOAuthAttempt({
      userId: "user-a",
      workspaceId: "workspace-a",
      provider: "google_ads",
    });
    await consumeOAuthAttempt({ token, provider: "google_ads", sessionUserId: "user-a" });
    await assert.rejects(
      () => consumeOAuthAttempt({ token, provider: "google_ads", sessionUserId: "user-a" }),
      /already been used|invalid/i,
    );
  });

  it("rejects mismatched provider or user", async () => {
    const token = await createOAuthAttempt({
      userId: "user-a",
      workspaceId: "workspace-a",
      provider: "shopee",
    });
    await assert.rejects(
      () => consumeOAuthAttempt({ token, provider: "meta_ads", sessionUserId: "user-a" }),
      /invalid/i,
    );
    await assert.rejects(
      () => consumeOAuthAttempt({ token, provider: "shopee", sessionUserId: "user-b" }),
      /invalid/i,
    );
  });

  it("preserves reconnectConnectionId alongside workspaceId", async () => {
    const token = await createOAuthAttempt({
      userId: "user-a",
      workspaceId: "workspace-a",
      provider: "meta_ads",
      reconnectConnectionId: "conn-123",
    });
    const consumed = await consumeOAuthAttempt({ token, provider: "meta_ads", sessionUserId: "user-a" });
    assert.equal(consumed.reconnectConnectionId, "conn-123");
    assert.equal(consumed.workspaceId, "workspace-a");
  });
});
