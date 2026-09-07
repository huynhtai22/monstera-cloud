/**
 * Deterministic Multi-Provider API Simulator
 *
 * Simulates Meta Ads Graph API v23.0, Google Ads API v23 SearchStream,
 * and TikTok Marketing API v1.3 with full deterministic fault injection.
 */

export interface SimulatorMetrics {
  totalRequests: number;
  metaRequests: number;
  googleRequests: number;
  tiktokRequests: number;
  rateLimitHits: number;
  serverErrors: number;
  authErrors: number;
  activeConcurrency: number;
  peakConcurrency: number;
}

export interface FaultConfig {
  meta?: {
    rateLimitAccountIds?: Set<string>;
    revokedAccountIds?: Set<string>;
    serverErrorAccountIds?: Set<string>;
    malformedAccountIds?: Set<string>;
    outage503Remaining?: number;
    throttleHeaderUsagePct?: number;
    retryAfterSeconds?: number;
    latencyMs?: number;
  };
  google?: {
    rateLimitCustomerIds?: Set<string>;
    blockedDevToken?: boolean;
    unauthorizedCustomerIds?: Set<string>;
    serverErrorCustomerIds?: Set<string>;
    outage503Remaining?: number;
    latencyMs?: number;
  };
  tiktok?: {
    rateLimitAdvertiserIds?: Set<string>;
    authErrorAdvertiserIds?: Set<string>;
    serverErrorAdvertiserIds?: Set<string>;
    asyncReportPollDelayCycles?: number; // Number of "PROCESSING" polls before "SUCCESS"
    outage503Remaining?: number;
    retryAfterSeconds?: number;
    latencyMs?: number;
  };
}

export class ProviderSimulator {
  public metrics: SimulatorMetrics = {
    totalRequests: 0,
    metaRequests: 0,
    googleRequests: 0,
    tiktokRequests: 0,
    rateLimitHits: 0,
    serverErrors: 0,
    authErrors: 0,
    activeConcurrency: 0,
    peakConcurrency: 0,
  };

  private faults: FaultConfig = {};
  private tiktokTaskPollCounts = new Map<string, number>();

  constructor(faults?: FaultConfig) {
    if (faults) this.faults = faults;
  }

  public setFaults(faults: FaultConfig): void {
    this.faults = faults;
  }

  public resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      metaRequests: 0,
      googleRequests: 0,
      tiktokRequests: 0,
      rateLimitHits: 0,
      serverErrors: 0,
      authErrors: 0,
      activeConcurrency: 0,
      peakConcurrency: 0,
    };
    this.tiktokTaskPollCounts.clear();
  }

  private trackRequestStart(): void {
    this.metrics.totalRequests++;
    this.metrics.activeConcurrency++;
    if (this.metrics.activeConcurrency > this.metrics.peakConcurrency) {
      this.metrics.peakConcurrency = this.metrics.activeConcurrency;
    }
  }

  private trackRequestEnd(): void {
    this.metrics.activeConcurrency = Math.max(0, this.metrics.activeConcurrency - 1);
  }

  /**
   * Main request interceptor passed to NetworkDenialGuard
   */
  public async handleRequest(urlStr: string, init?: RequestInit): Promise<Response | null> {
    const url = new URL(urlStr);

    if (url.hostname === "graph.facebook.com") {
      this.trackRequestStart();
      try {
        return await this.handleMetaRequest(url, init);
      } finally {
        this.trackRequestEnd();
      }
    }

    if (url.hostname === "googleads.googleapis.com" || url.hostname === "oauth2.googleapis.com") {
      this.trackRequestStart();
      try {
        return await this.handleGoogleRequest(url, init);
      } finally {
        this.trackRequestEnd();
      }
    }

    if (url.hostname === "business-api.tiktok.com" || url.hostname === "sandbox-ads.tiktok.com" || url.hostname === "ads.tiktok.com") {
      this.trackRequestStart();
      try {
        return await this.handleTikTokRequest(url, init);
      } finally {
        this.trackRequestEnd();
      }
    }

    return null;
  }

  // ── Meta Ads Handler ────────────────────────────────────────────────────────
  private async handleMetaRequest(url: URL, _init?: RequestInit): Promise<Response> {
    this.metrics.metaRequests++;
    const metaFaults = this.faults.meta;

    if (metaFaults?.latencyMs) {
      await new Promise((r) => setTimeout(r, metaFaults.latencyMs));
    }

    // 1. Check global 503 outage
    if (metaFaults?.outage503Remaining && metaFaults.outage503Remaining > 0) {
      metaFaults.outage503Remaining--;
      this.metrics.serverErrors++;
      return new Response(
        JSON.stringify({ error: { message: "Service Temporarily Unavailable", code: 2, type: "OAuthException" } }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    // Account list endpoint: /v23.0/me/adaccounts or similar
    if (url.pathname.includes("/adaccounts") && !url.pathname.includes("/insights")) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "act_1001", name: "Simulated Meta Account 1", currency: "USD", timezone_name: "America/New_York" },
            { id: "act_1002", name: "Simulated Meta Account 2", currency: "USD", timezone_name: "America/New_York" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Insights endpoint: /v23.0/act_<id>/insights
    const actMatch = url.pathname.match(/act_([^/]+)/);
    const rawAccountId = actMatch ? actMatch[1] : "unknown";
    const cleanAccountId = rawAccountId.replace(/^act_/, "");

    // Revocation Fault
    if (metaFaults?.revokedAccountIds?.has(cleanAccountId) || metaFaults?.revokedAccountIds?.has(`act_${cleanAccountId}`)) {
      this.metrics.authErrors++;
      return new Response(
        JSON.stringify({
          error: {
            message: "Error validating access token: Session has expired or token is revoked.",
            type: "OAuthException",
            code: 190,
            error_subcode: 463,
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Rate limit Fault
    if (metaFaults?.rateLimitAccountIds?.has(cleanAccountId) || metaFaults?.rateLimitAccountIds?.has(`act_${cleanAccountId}`)) {
      this.metrics.rateLimitHits++;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (metaFaults.retryAfterSeconds) {
        headers["Retry-After"] = String(metaFaults.retryAfterSeconds);
      }
      return new Response(
        JSON.stringify({
          error: {
            message: "(#613) Calls to this api have exceeded the rate limit.",
            type: "OAuthException",
            code: 613,
          },
        }),
        { status: 429, headers }
      );
    }

    // Server error Fault
    if (metaFaults?.serverErrorAccountIds?.has(cleanAccountId) || metaFaults?.serverErrorAccountIds?.has(`act_${cleanAccountId}`)) {
      this.metrics.serverErrors++;
      return new Response(
        JSON.stringify({
          error: {
            message: "An unexpected error occurred while processing the request.",
            type: "OAuthException",
            code: 1,
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Malformed JSON Fault
    if (metaFaults?.malformedAccountIds?.has(cleanAccountId)) {
      return new Response("{ not valid json -- corrupted stream", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Headers with throttle info
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (metaFaults?.throttleHeaderUsagePct) {
      headers["x-business-use-case-usage"] = JSON.stringify({
        [cleanAccountId]: [
          {
            call_count: metaFaults.throttleHeaderUsagePct,
            total_cputime: metaFaults.throttleHeaderUsagePct,
            total_time: metaFaults.throttleHeaderUsagePct,
            estimated_time_to_regain_access: 5,
          },
        ],
      });
    }

    // Standard Success response
    const dateSince = url.searchParams.get("time_range")
      ? JSON.parse(url.searchParams.get("time_range") || "{}").since || "2026-01-01"
      : "2026-01-01";
    const dateUntil = url.searchParams.get("time_range")
      ? JSON.parse(url.searchParams.get("time_range") || "{}").until || "2026-01-02"
      : "2026-01-02";

    return new Response(
      JSON.stringify({
        data: [
          {
            campaign_id: `meta_cmp_${cleanAccountId}_1`,
            campaign_name: `Meta Campaign 1 (${cleanAccountId})`,
            adset_id: `meta_adset_${cleanAccountId}_1`,
            adset_name: `AdSet 1`,
            ad_id: `meta_ad_${cleanAccountId}_1`,
            ad_name: `Ad 1`,
            date_start: dateSince,
            date_stop: dateSince,
            spend: "125.50",
            impressions: "4500",
            clicks: "120",
            cpc: "1.045",
            cpm: "27.88",
            ctr: "2.66",
            actions: [{ action_type: "purchase", value: "8" }],
            action_values: [{ action_type: "purchase", value: "340.00" }],
          },
          {
            campaign_id: `meta_cmp_${cleanAccountId}_1`,
            campaign_name: `Meta Campaign 1 (${cleanAccountId})`,
            adset_id: `meta_adset_${cleanAccountId}_1`,
            adset_name: `AdSet 1`,
            ad_id: `meta_ad_${cleanAccountId}_1`,
            date_start: dateUntil,
            date_stop: dateUntil,
            spend: "98.20",
            impressions: "3800",
            clicks: "95",
            cpc: "1.033",
            cpm: "25.84",
            ctr: "2.50",
            actions: [{ action_type: "purchase", value: "5" }],
            action_values: [{ action_type: "purchase", value: "210.00" }],
          },
        ],
        paging: {
          cursors: { before: "cur_b", after: "cur_a" },
        },
      }),
      { status: 200, headers }
    );
  }

  // ── Google Ads Handler ──────────────────────────────────────────────────────
  private async handleGoogleRequest(url: URL, init?: RequestInit): Promise<Response> {
    this.metrics.googleRequests++;
    const googleFaults = this.faults.google;

    if (googleFaults?.latencyMs) {
      await new Promise((r) => setTimeout(r, googleFaults.latencyMs));
    }

    // Token exchange endpoint
    if (url.pathname === "/token") {
      return new Response(
        JSON.stringify({
          access_token: "simulated-google-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Global developer token blocked fault
    if (googleFaults?.blockedDevToken) {
      this.metrics.authErrors++;
      return new Response(
        JSON.stringify([
          {
            error: {
              code: 403,
              message: "The developer token is not approved. DEVELOPER_TOKEN_NOT_APPROVED",
              status: "PERMISSION_DENIED",
              details: [{ "@type": "type.googleapis.com/google.ads.googleads.v23.errors.GoogleAdsFailure" }],
            },
          },
        ]),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // 503 Outage fault
    if (googleFaults?.outage503Remaining && googleFaults.outage503Remaining > 0) {
      googleFaults.outage503Remaining--;
      this.metrics.serverErrors++;
      return new Response(
        JSON.stringify([
          {
            error: {
              code: 503,
              message: "The service is currently unavailable. Please retry later.",
              status: "UNAVAILABLE",
            },
          },
        ]),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    // MCC hierarchy query: googleAds.searchStream on customer
    const custMatch = url.pathname.match(/customers\/([^/:]+)/);
    const customerId = custMatch ? custMatch[1] : "unknown";

    // Rate Limit fault
    if (googleFaults?.rateLimitCustomerIds?.has(customerId)) {
      this.metrics.rateLimitHits++;
      return new Response(
        JSON.stringify([
          {
            error: {
              code: 429,
              message: "Resource has been exhausted (e.g. check quota). RESOURCE_EXHAUSTED",
              status: "RESOURCE_EXHAUSTED",
            },
          },
        ]),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // Unauthorized customer fault
    if (googleFaults?.unauthorizedCustomerIds?.has(customerId)) {
      this.metrics.authErrors++;
      return new Response(
        JSON.stringify([
          {
            error: {
              code: 403,
              message: "User doesn't have permission to access customer. NOT_ADS_USER / CUSTOMER_NOT_ENABLED",
              status: "PERMISSION_DENIED",
            },
          },
        ]),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Server error customer fault
    if (googleFaults?.serverErrorCustomerIds?.has(customerId)) {
      this.metrics.serverErrors++;
      return new Response(
        JSON.stringify([
          {
            error: {
              code: 500,
              message: "Internal error encountered.",
              status: "INTERNAL",
            },
          },
        ]),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Distinguish between MCC customer_client search and Campaign performance search
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    const isCustomerClientSearch = bodyStr.includes("customer_client");

    if (isCustomerClientSearch) {
      return new Response(
        JSON.stringify([
          {
            results: [
              {
                customerClient: {
                  clientCustomer: `customers/${customerId}`,
                  id: customerId,
                  descriptiveName: `Google Client ${customerId}`,
                  manager: false,
                  level: 1,
                  status: "ENABLED",
                },
              },
            ],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Campaign Performance Stream
    return new Response(
      JSON.stringify([
        {
          results: [
            {
              campaign: {
                resourceName: `customers/${customerId}/campaigns/9001`,
                id: "9001",
                name: `Google Search Campaign (${customerId})`,
                status: "ENABLED",
              },
              customer: {
                id: customerId,
                descriptiveName: `Google Client ${customerId}`,
                currencyCode: "USD",
                timeZone: "America/New_York",
              },
              segments: {
                date: "2026-01-01",
              },
              metrics: {
                impressions: "5200",
                clicks: "210",
                costMicros: "150000000", // $150.00
                conversions: "12",
                conversionsValue: "480.0",
                averageCpc: "714285", // $0.71
                ctr: "0.04038",
              },
            },
            {
              campaign: {
                resourceName: `customers/${customerId}/campaigns/9001`,
                id: "9001",
                name: `Google Search Campaign (${customerId})`,
                status: "ENABLED",
              },
              customer: {
                id: customerId,
                descriptiveName: `Google Client ${customerId}`,
                currencyCode: "USD",
                timeZone: "America/New_York",
              },
              segments: {
                date: "2026-01-02",
              },
              metrics: {
                impressions: "4800",
                clicks: "195",
                costMicros: "140000000", // $140.00
                conversions: "9",
                conversionsValue: "360.0",
                averageCpc: "717948",
                ctr: "0.04062",
              },
            },
          ],
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── TikTok Marketing API Handler ────────────────────────────────────────────
  private async handleTikTokRequest(url: URL, init?: RequestInit): Promise<Response> {
    this.metrics.tiktokRequests++;
    const tiktokFaults = this.faults.tiktok;

    if (tiktokFaults?.latencyMs) {
      await new Promise((r) => setTimeout(r, tiktokFaults.latencyMs));
    }

    // 503 Outage fault
    if (tiktokFaults?.outage503Remaining && tiktokFaults.outage503Remaining > 0) {
      tiktokFaults.outage503Remaining--;
      this.metrics.serverErrors++;
      return new Response(
        JSON.stringify({ code: 50000, message: "TikTok API Internal Service Error", data: {} }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1. Advertiser info endpoint: /advertiser/info/
    if (url.pathname.includes("/advertiser/info/")) {
      const advIdsParam = url.searchParams.get("advertiser_ids") || "[]";
      let advIds: string[] = [];
      try { advIds = JSON.parse(advIdsParam); } catch {}
      const advId = advIds[0] || "70001";

      return new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: {
            list: [
              {
                advertiser_id: advId,
                name: `TikTok Advertiser ${advId}`,
                currency: "USD",
                timezone: "America/New_York",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Report task create: /report/task/create/
    if (url.pathname.includes("/report/task/create/")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      const advertiserId = String(body.advertiser_id || "70001");

      if (tiktokFaults?.authErrorAdvertiserIds?.has(advertiserId)) {
        this.metrics.authErrors++;
        return new Response(
          JSON.stringify({ code: 40001, message: "Invalid Access Token or Permission Denied", data: {} }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }

      if (tiktokFaults?.rateLimitAdvertiserIds?.has(advertiserId)) {
        this.metrics.rateLimitHits++;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (tiktokFaults.retryAfterSeconds) headers["Retry-After"] = String(tiktokFaults.retryAfterSeconds);
        return new Response(
          JSON.stringify({ code: 40100, message: "Rate limit exceeded. Too many requests.", data: {} }),
          { status: 429, headers }
        );
      }

      const taskId = `task_${advertiserId}_${Date.now()}`;
      return new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: { task_id: taskId },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Report task check: /report/task/check/
    if (url.pathname.includes("/report/task/check/")) {
      const taskId = url.searchParams.get("task_id") || "task_unknown";
      const pollCount = (this.tiktokTaskPollCounts.get(taskId) || 0) + 1;
      this.tiktokTaskPollCounts.set(taskId, pollCount);

      const requiredDelay = tiktokFaults?.asyncReportPollDelayCycles ?? 0;
      const status = pollCount > requiredDelay ? "SUCCESS" : "PROCESSING";

      return new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: {
            task_id: taskId,
            status,
            create_time: "2026-01-01 10:00:00",
            complete_time: status === "SUCCESS" ? "2026-01-01 10:00:05" : undefined,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 4. Report download URL: /report/task/download/
    if (url.pathname.includes("/report/task/download/")) {
      const taskId = url.searchParams.get("task_id") || "task_unknown";
      return new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: {
            download_url: `https://business-api.tiktok.com/simulated-download/${taskId}.csv`,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5. CSV download: /simulated-download/
    if (url.pathname.includes("/simulated-download/")) {
      const csvData = [
        "campaign_id,campaign_name,stat_time_day,impression,click,spend,conversion,revenue,cpc,ctr,roas",
        "tt_cmp_1,TikTok Spark Campaign,2026-01-01,10000,450,220.00,15,660.00,0.488,0.045,3.0",
        "tt_cmp_1,TikTok Spark Campaign,2026-01-02,9500,410,205.00,12,510.00,0.500,0.043,2.48",
      ].join("\n");

      return new Response(csvData, {
        status: 200,
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      });
    }

    // 6. Synchronous sandbox report: /report/integrated/get/
    if (url.pathname.includes("/report/integrated/get/")) {
      const advId = url.searchParams.get("advertiser_id") || "70001";
      return new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: {
            list: [
              {
                dimensions: { campaign_id: `tt_sync_cmp_${advId}`, campaign_name: "TikTok Sync Campaign", stat_time_day: "2026-01-01" },
                metrics: { spend: "150.00", impression: "6000", click: "250", conversion: "10", revenue: "400.00", cpc: "0.60", ctr: "0.0416" },
              },
            ],
            page_info: { page: 1, page_size: 100, total_page: 1, total_number: 1 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ code: 0, message: "OK", data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
