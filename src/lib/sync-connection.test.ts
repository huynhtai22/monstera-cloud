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
  const originalTransaction = (prisma as any).$transaction;
  const originalSyncLock = (prisma as any).syncLock;
  const originalKey = process.env.ENCRYPTION_KEY;
  const updates: Array<{ data: Record<string, unknown> }> = [];
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  globalThis.fetch = fetchImpl;
  (prisma as any).connection = {
    findUnique: async () => null,
    update: async (args: { data: Record<string, unknown> }) => {
      updates.push(args);
      return args;
    },
    updateMany: async (args: { data: Record<string, unknown> }) => {
      updates.push(args);
      return { count: args.data && Object.keys(args.data).length >= 0 ? 1 : 0 };
    },
  };
  // Connection-lease stubs: acquire always wins, and the lease stays valid so
  // fenced outcome persistence is exercised through the real code path.
  const validLease = {
    leaseId: "test-lease",
    fencingToken: BigInt(1),
    status: "running",
    leaseExpiresAt: new Date(Date.now() + 20 * 60 * 1000),
  };
  (prisma as any).$transaction = async (fn: any) =>
    fn({
      $queryRawUnsafe: async () => [{ locked: true }],
      syncLock: {
        findUnique: async () => null,
        upsert: async (args: any) => ({ ...args.update, ...validLease }),
        updateMany: async () => ({ count: 1 }),
      },
    });
  (prisma as any).syncLock = {
    findUnique: async () => ({ ...validLease }),
    updateMany: async () => ({ count: 1 }),
  };
  const originalSupportTicket = (prisma as any).supportTicket;
  (prisma as any).supportTicket = {
    findFirst: async () => null,
    create: async (args: any) => ({ id: "ticket-1", ...args.data }),
    update: async (args: any) => args,
  };
  try {
    return await run(updates);
  } finally {
    globalThis.fetch = originalFetch;
    (prisma as any).connection = originalConnection;
    (prisma as any).$transaction = originalTransaction;
    (prisma as any).syncLock = originalSyncLock;
    (prisma as any).supportTicket = originalSupportTicket;
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
        return new Response(JSON.stringify([{ results: [{ customerClient: { id: customerId, manager: false, status: "ENABLED", descriptiveName: customerId } }] }]), { status: 200 });
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
      if (url.includes("/advertiser/info/")) return Response.json({code:0,data:{list:[]}});
      if (url.includes("/report/task/create/")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { advertiser_id: string };
        return new Response(JSON.stringify({ code: 0, data: { task_id: `${body.advertiser_id}-task` } }), { status: 200 });
      }
      if (url.includes("/report/task/check/")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }), { status: 200 });
      }
      if (url.includes("/report/task/download/")) {
        const advertiserId = new URL(url).searchParams.get("advertiser_id");
        return new Response(JSON.stringify({ code: 0, data: { download_url: `https://download.test/${advertiserId}` } }), { status: 200 });
      }
      if (url.endsWith("/712345678901234")) return new Response("", { status: 200 });
      failedDownloadAttempts++;
      return new Response(JSON.stringify({ code: 429, message: "rate limit" }), { status: 429 });
    }) as typeof fetch, async (updates) => {
      const result = await syncConnectionData({
        connectionId: "tiktok-connection",
        provider: "tiktok_business",
        credentials: { ...freshCredentials, advertiserIds: ["712345678901234", "712345678901235"] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(result.outcome, "partial");
      assert.equal(result.success, false);
      assert.deepEqual(result.children.map((child) => [child.id, child.ok]), [["712345678901234", true], ["712345678901235", false]]);
      assert.equal(result.children.find((child) => child.id === "712345678901235")?.retryable, true);
      assert.equal(result.children.find((child) => child.id === "712345678901235")?.retryState?.reportTaskId, "712345678901235-task");
      assert.equal(failedDownloadAttempts, 3);
      assert.equal("lastSyncAt" in updates[0].data, false);
      assert.match(String(updates[0].data.lastError), /^\[partial\]/);
    }));
  });

  it("resumes a still-processing TikTok report task without creating a duplicate", async () => {
    let phase: "pending" | "ready" = "pending";
    let createCalls = 0;
    let checkCalls = 0;
    const reportTaskId = "7679241688576950293";
    const advertiserId = "7677495922629787656";

    await withFastRetries(() => withSyncHarness((async (input) => {
      const url = String(input);
      if (url.includes("/report/task/create/")) {
        createCalls++;
        return new Response(JSON.stringify({ code: 0, data: { task_id: reportTaskId } }));
      }
      if (url.includes("/report/task/check/")) {
        checkCalls++;
        const data = phase === "pending"
          ? { status: "PROCESSING" }
          : { status: "SUCCESS" };
        return new Response(JSON.stringify({ code: 0, data }));
      }
      if (url.includes("/report/task/download/")) {
        return new Response(JSON.stringify({ code: 0, data: { download_url: "https://download.test/resumed" } }));
      }
      if (url === "https://download.test/resumed") return new Response("");
      return new Response(JSON.stringify({ code: 40000, message: "unexpected request" }), { status: 400 });
    }) as typeof fetch, async () => {
      const first = await syncConnectionData({
        connectionId: "tiktok-resume-connection",
        provider: "tiktok_business",
        credentials: { ...freshCredentials, advertiserIds: [advertiserId] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(first.outcome, "failed");
      assert.equal(first.children[0].retryable, true);
      assert.deepEqual(first.children[0].retryState, {
        provider: "tiktok_business",
        advertiserId,
        reportTaskId,
      });
      assert.equal(createCalls, 1);
      assert.equal(checkCalls, 11);

      phase = "ready";
      const resumed = await syncConnectionData({
        connectionId: "tiktok-resume-connection",
        provider: "tiktok_business",
        credentials: { ...freshCredentials, advertiserIds: [advertiserId] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
        providerState: first.children[0].retryState,
      });
      assert.equal(resumed.outcome, "success");
      assert.equal(createCalls, 1, "resuming must not create another TikTok task");
      assert.equal(checkCalls, 12);
    }));
  });

  it("uses a numeric legacy connection identity when credentials do not yet contain advertiser IDs", async () => {
    let reportRequests = 0;
    await withSyncHarness((async (input, init) => {
      const url = String(input);
      if (url.includes("/report/task/create/")) {
        reportRequests++;
        const body = JSON.parse(String(init?.body ?? "{}")) as { advertiser_id: string };
        assert.equal(body.advertiser_id, "712345678901234");
        return new Response(JSON.stringify({ code: 0, data: { task_id: "legacy-task" } }));
      }
      if (url.includes("/report/task/check/")) {
        return new Response(JSON.stringify({ code: 0, data: { status: "SUCCESS" } }));
      }
      if (url.includes("/report/task/download/")) {
        return new Response(JSON.stringify({ code: 0, data: { download_url: "https://download.test/legacy" } }));
      }
      return new Response("");
    }) as typeof fetch, async () => {
      (prisma as any).connection.findUnique = async () => ({ remoteAccountId: "712345678901234" });
      const result = await syncConnectionData({
        connectionId: "tiktok-numeric-legacy-connection",
        provider: "tiktok_business",
        credentials: { ...freshCredentials },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(reportRequests, 1);
      assert.doesNotMatch(String(result.error), /reconnect required/i);
    });
  });

  it("fails closed without calling TikTok when legacy credentials contain no numeric advertiser ID", async () => {
    let reportRequests = 0;
    await withSyncHarness((async (input) => {
      if (String(input).includes("/report/task/")) reportRequests++;
      return new Response("unexpected");
    }) as typeof fetch, async (updates) => {
      const result = await syncConnectionData({
        connectionId: "tiktok-legacy-connection",
        provider: "tiktok_business",
        credentials: { ...freshCredentials, advertiserIds: ["#un1v"] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(result.outcome, "failed");
      assert.match(String(result.error), /reconnect required/i);
      assert.equal(reportRequests, 0);
      assert.match(String(updates[0].data.lastError), /reconnect required/i);
    });
  });

  it("Meta Error 190 revokes the connection via the established handler instead of retrying per account", async () => {
    await withFastRetries(() => withSyncHarness((async (input) => {
      const url = String(input);
      if (url.includes("/insights")) {
        return new Response(JSON.stringify({ error: { message: "Error validating access token: session has been revoked", code: 190, type: "OAuthException" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch, async (updates) => {
      const result = await syncConnectionData({
        connectionId: "meta-connection",
        provider: "meta_ads",
        credentials: { ...freshCredentials, adAccounts: [{ id: "act_111", name: "Revoked Account" }, { id: "act_222", name: "Second Account" }] },
        workspaceId: "workspace-1",
        userPlan: "pilot",
      });
      assert.equal(result.outcome, "failed");
      const revokedChild = result.children.find((c) => c.id === "act_111");
      assert.ok(revokedChild);
      assert.equal(revokedChild.retryable, false, "revoked OAuth must never retry");
      assert.match(revokedChild.error ?? "", /reconnect required/i);
      assert.equal(result.children.length, 1, "remaining accounts are skipped once the token is known revoked");
      const disconnect = updates.find((u) => u.data && (u.data as any).status === "disconnected");
      assert.ok(disconnect, "handleMetaRevocation must disconnect the connection");
    }));
  });
});

describe("google runtime authority fail-closed", () => {
  it("rejects runtime mode before any provider contact or writes", async () => {
    const previousMode = process.env.GOOGLE_CONNECTOR_RUNTIME_MODE;
    process.env.GOOGLE_CONNECTOR_RUNTIME_MODE = "runtime";
    let calls = 0;
    try {
      await withFastRetries(() => withSyncHarness((async () => {
        calls++;
        throw new Error("provider must not be contacted");
      }) as typeof fetch, async () => {
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
        const result = await syncConnectionData({
          connectionId: "google-connection",
          provider: "google_ads",
          credentials: { ...freshCredentials, customerIds: ["111"] },
          workspaceId: "workspace-1",
          userPlan: "pilot",
        });
        assert.equal(result.success, false);
        assert.match(String(result.error ?? ""), /GOOGLE_RUNTIME_MODE_NOT_PROMOTED/);
        assert.equal(calls, 0);
      }));
    } finally {
      if (previousMode === undefined) delete process.env.GOOGLE_CONNECTOR_RUNTIME_MODE;
      else process.env.GOOGLE_CONNECTOR_RUNTIME_MODE = previousMode;
    }
  });
});
