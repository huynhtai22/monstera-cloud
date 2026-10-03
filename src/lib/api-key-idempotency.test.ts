import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import {
  apiKeyMutationRequestHash,
  ApiKeyIdempotencyError,
  requireIdempotencyKey,
  runIdempotentApiKeyMutation,
} from "./api-key-idempotency";

const encryptionKey = "0".repeat(64);

function fakeTransaction() {
  let stored: Record<string, any> | null = null;
  const tx = {
    apiKeyMutationReceipt: {
      findUnique: async () => stored,
      create: async ({ data }: { data: Record<string, any> }) => {
        stored = { id: "receipt-1", createdAt: new Date(), ...data };
        return stored;
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, stored: () => stored };
}

describe("API-key mutation idempotency", () => {
  it("requires a bounded URL-safe key", () => {
    assert.throws(
      () => requireIdempotencyKey(new Request("http://localhost")),
      (error: unknown) => error instanceof ApiKeyIdempotencyError && error.code === "IDEMPOTENCY_KEY_REQUIRED",
    );
    assert.equal(
      requireIdempotencyKey(new Request("http://localhost", { headers: { "Idempotency-Key": "request-1234567890" } })),
      "request-1234567890",
    );
  });

  it("returns the encrypted stored winner on an identical retry", async () => {
    const previousKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = encryptionKey;
    try {
      const { tx, stored } = fakeTransaction();
      let creates = 0;
      const input = {
        tx,
        workspaceId: "ws-1",
        actorUserId: "user-1",
        operation: "rotate" as const,
        idempotencyKey: "request-1234567890",
        requestHash: apiKeyMutationRequestHash({ id: "key-1" }),
        now: new Date("2026-09-20T10:00:00Z"),
        create: async () => {
          creates += 1;
          return { response: { id: "new-key", key: "mc_live_secret" }, statusCode: 201, apiKeyId: "new-key" };
        },
      };
      const first = await runIdempotentApiKeyMutation(input);
      const replay = await runIdempotentApiKeyMutation(input);
      assert.equal(creates, 1);
      assert.deepEqual(replay.response, first.response);
      assert.equal(replay.created, false);
      assert.equal(JSON.stringify(stored()).includes("mc_live_secret"), false);
    } finally {
      if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previousKey;
    }
  });

  it("rejects reuse for a different request", async () => {
    const previousKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = encryptionKey;
    try {
      const { tx } = fakeTransaction();
      const base = {
        tx,
        workspaceId: "ws-1",
        actorUserId: "user-1",
        operation: "create" as const,
        idempotencyKey: "request-1234567890",
        now: new Date("2026-09-20T10:00:00Z"),
        create: async () => ({ response: { key: "secret" }, statusCode: 201 }),
      };
      await runIdempotentApiKeyMutation({ ...base, requestHash: apiKeyMutationRequestHash({ name: "one" }) });
      await assert.rejects(
        runIdempotentApiKeyMutation({ ...base, requestHash: apiKeyMutationRequestHash({ name: "two" }) }),
        (error: unknown) => error instanceof ApiKeyIdempotencyError && error.code === "IDEMPOTENCY_CONFLICT",
      );
    } finally {
      if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previousKey;
    }
  });
});
