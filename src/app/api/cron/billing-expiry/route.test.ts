import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { GET } from "./route";

const originalWorkspace = (prisma as any).workspace;
const previousCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  (prisma as any).workspace = originalWorkspace;
  if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousCronSecret;
});

describe("billing expiry cron", () => {
  it("downgrades dated domestic-transfer plans and trials while retaining the workspace", async () => {
    process.env.CRON_SECRET = "a-32-character-test-cron-secret-value";
    let updateArgs: any;
    (prisma as any).workspace = {
      updateMany: async (args: any) => {
        updateArgs = args;
        return { count: 1 };
      },
    };

    const response = await GET(new Request("https://monstera.test/api/cron/billing-expiry", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(updateArgs.where.OR, [
      { subscriptionProvider: "vietqr_domestic" },
      { status: "PILOT" },
    ]);
    assert.equal(updateArgs.where.subscriptionEndsAt.lte instanceof Date, true);
    assert.equal(updateArgs.data.plan, "free");
    assert.equal(updateArgs.data.status, "ACTIVE");
    assert.equal(updateArgs.data.subscriptionEndsAt, null);
  });
});
