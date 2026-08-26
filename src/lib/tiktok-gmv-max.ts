/**
 * TikTok Marketing API — GMV Max Reporting Client
 * 
 * Official Marketing API: GET /open_api/v1.3/gmv_max/report/get/
 * Portal Doc ID: 1824721673497601
 * 
 * Note: GMV Max uses a 1-day blended attribution window (Paid + Organic + Affiliate).
 * Metrics (gmv_max_cost, gmv_max_gross_revenue, gmv_max_orders, gmv_max_roi)
 * represent shop-wide GMV optimization and must NOT be mapped or unioned into standard CampaignMetric ROAS.
 */

import { isTikTokRetryableFailure, TikTokProviderError } from "@/lib/tiktok-business";

export const GMV_MAX_PRODUCT_DIMENSIONS = [
  "stat_time_day",
  "campaign_id",
  "store_id",
  "item_id",
] as const;

export const GMV_MAX_LIVE_DIMENSIONS = [
  "stat_time_day",
  "campaign_id",
  "store_id",
  "live_room_id",
] as const;

export const GMV_MAX_METRICS = [
  "gmv_max_cost",
  "gmv_max_gross_revenue",
  "gmv_max_orders",
  "gmv_max_roi",
] as const;

export const GMV_MAX_ATTRIBUTION_DISCLAIMER =
  "Product GMV Max uses 1-day blended attribution (paid + organic + affiliate). Do not compare with standard ad ROAS.";

export interface GmvMaxReportRow {
  dimensions: {
    stat_time_day?: string;
    campaign_id?: string;
    campaign_name?: string;
    store_id?: string;
    store_name?: string;
    item_id?: string;
    item_name?: string;
    item_group_id?: string;
    item_group_name?: string;
    live_room_id?: string;
    room_title?: string;
    [key: string]: unknown;
  };
  metrics: {
    gmv_max_cost?: number | string;
    gmv_max_gross_revenue?: number | string;
    gmv_max_orders?: number | string;
    gmv_max_roi?: number | string;
    [key: string]: unknown;
  };
}

export interface GetGmvMaxReportParams {
  advertiser_id: string;
  store_ids: string[];
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  campaign_type?: "PRODUCT" | "LIVE";
  dimensions?: string[];
  metrics?: string[];
  page_size?: number;
  filters?: Record<string, unknown>;
}

export class TikTokGmvMaxClient {
  private getBaseUrl(sandbox = false): string {
    return sandbox
      ? "https://sandbox-ads.tiktok.com/open_api/v1.3"
      : "https://business-api.tiktok.com/open_api/v1.3";
  }

  /**
   * Chunks a date range into safe windows (default <= 14 days)
   * to respect TikTok's strict 30-day cap on day-level reporting.
   */
  chunkDateRange(
    startDate: string,
    endDate: string,
    maxWindowDays = 14
  ): Array<{ start: string; end: string }> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return [{ start: startDate, end: endDate }];
    }

    const chunks: Array<{ start: string; end: string }> = [];
    let currentStart = new Date(start);

    while (currentStart <= end) {
      const currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + maxWindowDays - 1);

      const chunkEnd = currentEnd < end ? currentEnd : end;

      chunks.push({
        start: currentStart.toISOString().split("T")[0],
        end: chunkEnd.toISOString().split("T")[0],
      });

      currentStart = new Date(chunkEnd);
      currentStart.setDate(currentStart.getDate() + 1);
    }

    return chunks;
  }

  /**
   * Fetches GMV Max report rows for a single time slice (<= 14 days).
   * Paginates until all rows for this slice are retrieved.
   */
  async getReportSlice(
    accessToken: string,
    params: GetGmvMaxReportParams,
    sandbox = false
  ): Promise<GmvMaxReportRow[]> {
    const base = this.getBaseUrl(sandbox);
    const campaignType = params.campaign_type ?? "PRODUCT";

    const dimensions =
      params.dimensions ??
      (campaignType === "LIVE"
        ? [...GMV_MAX_LIVE_DIMENSIONS]
        : [...GMV_MAX_PRODUCT_DIMENSIONS]);

    const metrics = params.metrics ?? [...GMV_MAX_METRICS];
    const pageSize = Math.min(params.page_size ?? 100, 1000);

    const allRows: GmvMaxReportRow[] = [];
    let page = 1;

    while (true) {
      const url = new URL(`${base}/gmv_max/report/get/`);
      url.searchParams.set("advertiser_id", params.advertiser_id);
      url.searchParams.set("store_ids", JSON.stringify(params.store_ids));
      url.searchParams.set("start_date", params.start_date);
      url.searchParams.set("end_date", params.end_date);
      url.searchParams.set("dimensions", JSON.stringify(dimensions));
      url.searchParams.set("metrics", JSON.stringify(metrics));
      const apiCampaignType = campaignType === "LIVE" ? "LIVE_STREAM" : "PRODUCT";
      url.searchParams.set("campaign_type", apiCampaignType);
      url.searchParams.set("filters", JSON.stringify({ campaign_types: [apiCampaignType], ...(params.filters || {}) }));
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(pageSize));

      const maxAttempts = 3;
      let json: Record<string, unknown> | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const res = await fetch(url.toString(), {
            method: "GET",
            headers: {
              "Access-Token": accessToken,
              "Content-Type": "application/json",
            },
          });

          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

          if (res.ok && (body.code as number) === 0) {
            json = body;
            break;
          }

          const message = String(body.message ?? `HTTP ${res.status}`);
          const retryable = isTikTokRetryableFailure(res.status, body.code, message);

          if (!retryable || attempt === maxAttempts - 1) {
            throw new TikTokProviderError(
              `TikTok GMV Max API error ${body.code ?? res.status}: ${message}`,
              retryable,
              res.status
            );
          }

          const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 200);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } catch (err) {
          if (err instanceof TikTokProviderError && !err.retryable) {
            throw err;
          }
          if (attempt === maxAttempts - 1) {
            throw err instanceof Error
              ? err
              : new TikTokProviderError("TikTok GMV Max request failed", true);
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }
      }

      if (!json || !json.data) break;

      const data = json.data as Record<string, unknown>;
      const list = (data.list as GmvMaxReportRow[]) ?? [];
      allRows.push(...list);

      const pageInfo = data.page_info as Record<string, number> | undefined;
      const totalPage = pageInfo?.total_page ?? 1;
      if (page >= totalPage || list.length === 0) break;
      page++;
    }

    return allRows;
  }

  /**
   * Retrieves GMV Max report data across the full requested range by
   * automatically slicing into <=14 day windows.
   */
  async getReport(
    accessToken: string,
    params: GetGmvMaxReportParams,
    sandbox = false
  ): Promise<GmvMaxReportRow[]> {
    const chunks = this.chunkDateRange(params.start_date, params.end_date, 14);
    const combinedRows: GmvMaxReportRow[] = [];

    for (const chunk of chunks) {
      const sliceParams: GetGmvMaxReportParams = {
        ...params,
        start_date: chunk.start,
        end_date: chunk.end,
      };
      const sliceRows = await this.getReportSlice(accessToken, sliceParams, sandbox);
      combinedRows.push(...sliceRows);
    }

    return combinedRows;
  }
}

export const tiktokGmvMaxClient = new TikTokGmvMaxClient();
