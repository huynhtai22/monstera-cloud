import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { POST as postGoogleReport } from "./google-ads/report/route";
import { POST as postMetaReport } from "./meta-ads/report/route";
import { GET as getMetaReport } from "./meta-ads/report/[reportRunId]/route";
import { POST as postTikTokReport } from "./tiktok-business/report/create/route";
import { GET as getTikTokReport } from "./tiktok-business/report/[taskId]/route";
import { setAuthSessionOverride } from "@/lib/auth-session";
import { encrypt } from "@/lib/encryption";
import { googleAdsOAuthClient, googleAdsReportClient } from "@/lib/google-ads";
import { metaAdsClient, metaReportClient } from "@/lib/meta-ads";
import { getConnectorContext } from "@/lib/observability/connector-telemetry";
import prisma from "@/lib/prisma";
import { tiktokBusinessClient, tiktokReportClient } from "@/lib/tiktok-business";

if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

const session = {
  user: { id: "report-context-user", email: "report-context@example.test" },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

describe("direct provider report routes use one authorized connector context", () => {
  const originalFindFirst = prisma.connection.findFirst;
  const originalUpdate = prisma.connection.update;
  const originalMetaRefresh = metaAdsClient.exchangeForLongLived;
  const originalMetaReport = metaReportClient.getInsights;
  const originalMetaPoll = metaReportClient.checkAsyncReport;
  const originalGoogleRefresh = googleAdsOAuthClient.refreshAccessToken;
  const originalGoogleReport = googleAdsReportClient.getCampaignPerformance;
  const originalTikTokRefresh = tiktokBusinessClient.refreshAccessToken;
  const originalTikTokReport = tiktokReportClient.createTask;
  const originalTikTokPoll = tiktokReportClient.checkTask;

  beforeEach(() => {
    setAuthSessionOverride(async () => session);
    prisma.connection.update = (async () => ({})) as any;
  });

  afterEach(() => {
    setAuthSessionOverride(null);
    prisma.connection.findFirst = originalFindFirst;
    prisma.connection.update = originalUpdate;
    metaAdsClient.exchangeForLongLived = originalMetaRefresh;
    metaReportClient.getInsights = originalMetaReport;
    metaReportClient.checkAsyncReport = originalMetaPoll;
    googleAdsOAuthClient.refreshAccessToken = originalGoogleRefresh;
    googleAdsReportClient.getCampaignPerformance = originalGoogleReport;
    tiktokBusinessClient.refreshAccessToken = originalTikTokRefresh;
    tiktokReportClient.createTask = originalTikTokReport;
    tiktokReportClient.checkTask = originalTikTokPoll;
  });

  it("keeps Meta, Google, and TikTok refresh plus provider execution in their matching contexts", async () => {
    const observed: Record<string, Array<{ phase: string; workspaceId?: string; connectionId?: string; provider?: string }>> = {
      meta: [], google: [], tiktok: [],
    };
    const observe = (provider: "meta" | "google" | "tiktok", phase: string) => {
      const context = getConnectorContext();
      observed[provider].push({ phase, ...context });
    };

    const connections: Record<string, any> = {
      conn_meta_report_context: {
        id: "conn_meta_report_context", workspaceId: "ws_meta_report_context", provider: "meta_ads", status: "connected",
        workspace: { plan: "pilot" },
        credentials: encrypt(JSON.stringify({ accessToken: "meta-old", expiresAt: new Date(Date.now() - 1).toISOString() })),
      },
      conn_google_report_context: {
        id: "conn_google_report_context", workspaceId: "ws_google_report_context", provider: "google_ads", status: "connected",
        workspace: { plan: "pilot" },
        credentials: encrypt(JSON.stringify({ accessToken: "google-old", refreshToken: "google-refresh", expiresAt: new Date(Date.now() - 1).toISOString() })),
      },
      conn_tiktok_report_context: {
        id: "conn_tiktok_report_context", workspaceId: "ws_tiktok_report_context", provider: "tiktok_business", status: "connected",
        workspace: { plan: "pilot" },
        credentials: encrypt(JSON.stringify({ accessToken: "tiktok-old", refreshToken: "tiktok-refresh", expiresAt: new Date(Date.now() - 1).toISOString() })),
      },
    };
    prisma.connection.findFirst = (async ({ where }: any) => connections[where.id] ?? null) as typeof prisma.connection.findFirst;
    metaAdsClient.exchangeForLongLived = (async () => {
      observe("meta", "refresh");
      return { access_token: "meta-new", expires_in: 3600 };
    }) as any;
    metaReportClient.getInsights = (async () => {
      observe("meta", "provider");
      return [];
    }) as any;
    googleAdsOAuthClient.refreshAccessToken = (async () => {
      observe("google", "refresh");
      return { access_token: "google-new", expires_in: 3600, token_type: "Bearer", scope: "synthetic" };
    }) as any;
    googleAdsReportClient.getCampaignPerformance = (async () => {
      observe("google", "provider");
      return [];
    }) as any;
    tiktokBusinessClient.refreshAccessToken = (async () => {
      observe("tiktok", "refresh");
      return { access_token: "tiktok-new", refresh_token: "tiktok-refresh-new", expires_in: 3600 };
    }) as any;
    tiktokReportClient.createTask = (async () => {
      observe("tiktok", "provider");
      return "synthetic-task";
    }) as any;

    const [meta, google, tiktok] = await Promise.all([
      postMetaReport(new Request("http://localhost/api/meta-ads/report", { method: "POST", body: JSON.stringify({ connectionId: "conn_meta_report_context", adAccountId: "act_1" }) })),
      postGoogleReport(new Request("http://localhost/api/google-ads/report", { method: "POST", body: JSON.stringify({ connectionId: "conn_google_report_context", customerId: "123", reportType: "campaign" }) })),
      postTikTokReport(new Request("http://localhost/api/tiktok-business/report/create", { method: "POST", body: JSON.stringify({ connectionId: "conn_tiktok_report_context", advertiser_id: "456", report_type: "BASIC", data_level: "AUCTION_AD", dimensions: [], metrics: [], start_date: "2026-09-01", end_date: "2026-09-02" }) })),
    ]);

    assert.deepEqual([meta.status, google.status, tiktok.status], [200, 200, 200]);
    for (const [provider, expected] of Object.entries({
      meta: ["ws_meta_report_context", "conn_meta_report_context", "meta_ads"],
      google: ["ws_google_report_context", "conn_google_report_context", "google_ads"],
      tiktok: ["ws_tiktok_report_context", "conn_tiktok_report_context", "tiktok_business"],
    })) {
      assert.deepEqual(observed[provider].map((entry) => entry.phase), ["refresh", "provider"]);
      assert.ok(observed[provider].every((entry) => entry.workspaceId === expected[0] && entry.connectionId === expected[1] && entry.provider === expected[2]));
    }
    assert.equal(getConnectorContext(), undefined);
  });

  it("rejects unauthenticated and rival Meta report requests before refresh or provider work", async () => {
    let refreshes = 0;
    let providerCalls = 0;
    metaAdsClient.exchangeForLongLived = (async () => { refreshes++; return { access_token: "unused" }; }) as any;
    metaReportClient.getInsights = (async () => { providerCalls++; return []; }) as any;
    const request = () => new Request("http://localhost/api/meta-ads/report", { method: "POST", body: JSON.stringify({ connectionId: "conn_rival", adAccountId: "act_1" }) });

    setAuthSessionOverride(async () => null);
    assert.equal((await postMetaReport(request())).status, 401);
    setAuthSessionOverride(async () => session);
    prisma.connection.findFirst = (async () => null) as typeof prisma.connection.findFirst;
    assert.equal((await postMetaReport(request())).status, 404);
    assert.equal(refreshes, 0);
    assert.equal(providerCalls, 0);
    assert.equal(getConnectorContext(), undefined);
  });

  it("keeps Meta and TikTok polling refreshes in the same authorized context as the poll", async () => {
    const observed: Array<{ phase: string; provider?: string; workspaceId?: string; connectionId?: string }> = [];
    const observe = (phase: string) => observed.push({ phase, ...getConnectorContext() });
    const connections: Record<string, any> = {
      conn_meta_poll_context: {
        id: "conn_meta_poll_context", workspaceId: "ws_meta_poll_context", provider: "meta_ads", status: "connected",
        credentials: encrypt(JSON.stringify({ accessToken: "meta-old", expiresAt: new Date(Date.now() - 1).toISOString() })),
      },
      conn_tiktok_poll_context: {
        id: "conn_tiktok_poll_context", workspaceId: "ws_tiktok_poll_context", provider: "tiktok_business", status: "connected",
        credentials: encrypt(JSON.stringify({ accessToken: "tiktok-old", refreshToken: "tiktok-refresh", expiresAt: new Date(Date.now() - 1).toISOString() })),
      },
    };
    prisma.connection.findFirst = (async ({ where }: any) => connections[where.id] ?? null) as typeof prisma.connection.findFirst;
    metaAdsClient.exchangeForLongLived = (async () => { observe("meta-refresh"); return { access_token: "meta-new", expires_in: 3600 }; }) as any;
    metaReportClient.checkAsyncReport = (async () => { observe("meta-poll"); return { async_status: "Job Running", async_percent_completion: 50 }; }) as any;
    tiktokBusinessClient.refreshAccessToken = (async () => { observe("tiktok-refresh"); return { access_token: "tiktok-new", refresh_token: "tiktok-refresh-new", expires_in: 3600 }; }) as any;
    tiktokReportClient.checkTask = (async () => { observe("tiktok-poll"); return { status: "RUNNING" }; }) as any;

    const [meta, tiktok] = await Promise.all([
      getMetaReport(new Request("http://localhost/api/meta-ads/report/report_1?connectionId=conn_meta_poll_context") as any, { params: Promise.resolve({ reportRunId: "report_1" }) }),
      getTikTokReport(new Request("http://localhost/api/tiktok-business/report/task_1?connectionId=conn_tiktok_poll_context&advertiser_id=456"), { params: Promise.resolve({ taskId: "task_1" }) }),
    ]);
    assert.deepEqual([meta.status, tiktok.status], [200, 200]);
    assert.deepEqual(observed.map((entry) => entry.phase).sort(), ["meta-poll", "meta-refresh", "tiktok-poll", "tiktok-refresh"]);
    assert.ok(observed.filter((entry) => entry.provider === "meta_ads").every((entry) => entry.workspaceId === "ws_meta_poll_context" && entry.connectionId === "conn_meta_poll_context"));
    assert.ok(observed.filter((entry) => entry.provider === "tiktok_business").every((entry) => entry.workspaceId === "ws_tiktok_poll_context" && entry.connectionId === "conn_tiktok_poll_context"));
    assert.equal(getConnectorContext(), undefined);
  });
});
