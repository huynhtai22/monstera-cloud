import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { POST } from "./route";

const previousCronSecret = process.env.CRON_SECRET;
const originalArtifact = (prisma as any).connectorRunArtifact;
const originalAudit = (prisma as any).auditEvent;

function authedRequest(body?: unknown) {
  return new Request("https://monstera.test/api/cron/connector-artifacts-cleanup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/cron/connector-artifacts-cleanup", () => {
  afterEach(() => {
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
    (prisma as any).connectorRunArtifact = originalArtifact;
    (prisma as any).auditEvent = originalAudit;
  });

  it("rejects requests without the cron secret", async () => {
    process.env.CRON_SECRET = "a-32-character-test-cron-secret-value";
    const response = await POST(
      new Request("https://monstera.test/api/cron/connector-artifacts-cleanup", { method: "POST" }),
    );
    assert.equal(response.status, 401);
  });

  it("returns the bounded cleanup summary for an empty store", async () => {
    process.env.CRON_SECRET = "a-32-character-test-cron-secret-value";
    (prisma as any).connectorRunArtifact = {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    };
    (prisma as any).auditEvent = {
      create: async () => {
        throw new Error("audit must not be written when nothing was deleted");
      },
    };
    const response = await POST(authedRequest({ limit: 10 }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.cleanup.deleted, 0);
    assert.equal(body.cleanup.hasMore, false);
  });

  it("caps the batch limit from the request body", async () => {
    process.env.CRON_SECRET = "a-32-character-test-cron-secret-value";
    let seenLimit = 0;
    (prisma as any).connectorRunArtifact = {
      findMany: async (args: any) => {
        seenLimit = args.take;
        return [];
      },
      deleteMany: async () => ({ count: 0 }),
    };
    (prisma as any).auditEvent = {
      create: async () => {
        throw new Error("audit must not be written when nothing was deleted");
      },
    };
    const response = await POST(authedRequest({ limit: 5000 }));
    assert.equal(response.status, 200);
    // take = batchLimit + 1, capped at MAX_CLEANUP_BATCH_LIMIT
    assert.equal(seenLimit, 1001);
  });
});
