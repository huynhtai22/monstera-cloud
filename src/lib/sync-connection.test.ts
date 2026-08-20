import assert from "node:assert/strict";
import { describe, it } from "node:test";
import prisma from "@/lib/prisma";
import { syncConnectionData } from "./sync-connection";

const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

async function withFastRetries<T>(run: () => Promise<T>): Promise<T> {
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: (...args: unknown[]) => unknown, _delay?: number, ...args: unknown[]) => {
    handler(...args);
    return 0 as never;
  }) as unknown as typeof setTimeout;
  try {
    return await run();
  } finally {
    globalThis.setTimeout = originalTimeout;
  }
}

async function withSyncHarness<T>(
  fetchImpl: typeof fetch,
  run: (updates: Array<{ data: Record<string, unknown> }>) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalConnection = (prisma as any).connection;
  const originalKey = process.env.ENCRYPTION_KEY;
  const updates: Array<{ data: Record<string, unknown> }> = [];
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  globalThis.fetch = fetchImpl;
  (prisma as any).connection = {
    update: async (args: { data: Record<string, unknown> }) => {
      updates.push(args);
      return args;
    },
  };
  try {
    return await run(updates);
  } finally {
    globalThis.fetch = originalFetch;
    (prisma as any).connection = originalConnection;
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  }
}

const freshCredentials = { accessToken: "test-access-token", expiresAt: "2099-01-01T00:00:00.000Z" };

describe("provider HTTP failures preserve sync correctness", () => {
  it("keeps mixed Google customer outcomes partial and does not advance lastSyncAt after a 429", async () => {
    let calls = 0;
    await withFastRetries(() => withSyncHarness((async (input, init) => {
      calls++;
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      const rootId = url.match(/customers\/([^/]+)\//)?.[1];
      if (body.query?.includes("customer_client")) {
        const customerId = rootId === "111" ? "101" : "202";
        return new Response(JSON.stringify([{ results: [{ customerClient: { id: customerId, manager: false, descriptiveName: customerId } }] }]), { status: 200 });
      }
      if (rootId === "101") return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ error: { code: 429, message: "RESOURCE_EXHAUSTED quota" } }), { status: 429 });
    }) as typeof fetch, async (updates) => {
      process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
      const result = await syncConnectionData({
        connectionId: "google-connection",
        provider: "google_ads",
        credentials: { ...freshCredentials, customerIds: ["111", "222"] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(result.outcome, "partial");
      assert.equal(result.success, false);
      assert.deepEqual(result.children.map((child) => [child.id, child.ok]), [["101", true], ["202", false]]);
      assert.equal(result.children.find((child) => child.id === "202")?.retryable, true);
      assert.equal(calls, 6); // hierarchy for both customers, empty success, then three bounded 429 attempts
      assert.equal(updates.length, 1);
      assert.equal("lastSyncAt" in updates[0].data, false);
      assert.match(String(updates[0].data.lastError), /^\[partial\]/);
    }));
  });

  it("keeps a TikTok advertiser download failure partial after bounded retries", async () => {
    let failedDownloadAttempts = 0;
    await withFastRetries(() => withSyncHarness((async (input, init) => {
      const url = String(input);
      if (url.includes("/report/task/create/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { advertiser_id: string };
        return new Response(JSON.stringify({ code: 0, data: { task_id: `${body.advertiser_id}-task` } }), { status: 200 });
      }
      if (url.includes("/report/task/check/")) {
        const advertiserId = new URL(url).searchParams.get("advertiser_id");
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS", url: `https://download.test/${advertiserId}` } }), { status: 200 });
      }
      if (url.endsWith("/advertiser-a")) return new Response("", { status: 200 });
      failedDownloadAttempts++;
      return new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 429 });
    }) as typeof fetch, async (updates) => {
      const result = await syncConnectionData({
        connectionId: "tiktok-connection",
        provider: "tiktok_business",
        credentials: { ...freshCredentials, advertiserIds: ["advertiser-a", "advertiser-b"] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(result.outcome, "partial");
      assert.equal(result.success, false);
      assert.deepEqual(result.children.map((child) => [child.id, child.ok]), [["advertiser-a", true], ["advertiser-b", false]]);
      assert.equal(result.children.find((child) => child.id === "advertiser-b")?.retryable, true);
      assert.equal(failedDownloadAttempts, 3);
      assert.equal("lastSyncAt" in updates[0].data, false);
      assert.match(String(updates[0].data.lastError), /^\[partial\]/);
    }));
  });
});
