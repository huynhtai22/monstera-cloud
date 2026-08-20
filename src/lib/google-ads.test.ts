import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GoogleAdsProviderError,
  GoogleAdsReportClient,
} from "./google-ads";

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

async function withMockedFetch<T>(
  responses: Response[],
  run: (calls: () => number) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async () => {
    count++;
    const response = responses.shift();
    if (!response) throw new Error("Unexpected Google Ads request");
    return response;
  }) as typeof fetch;
  try {
    return await run(() => count);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function googleError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google Ads SearchStream HTTP failure handling", () => {
  it("treats a valid 200 empty report as a successful zero-row result", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
    await withMockedFetch([new Response("[]", { status: 200 })], async (calls) => {
      const rows = await new GoogleAdsReportClient().getCampaignPerformance("access", "123", "LAST_7_DAYS");
      assert.deepEqual(rows, []);
      assert.equal(calls(), 1);
    });
  });

  it("retries a 429 and surfaces a retryable provider error after exhaustion", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
    await withFastRetries(() => withMockedFetch([
      googleError(429, "RESOURCE_EXHAUSTED: quota exceeded"),
      googleError(429, "RESOURCE_EXHAUSTED: quota exceeded"),
      googleError(429, "RESOURCE_EXHAUSTED: quota exceeded"),
    ], async (calls) => {
      await assert.rejects(
        new GoogleAdsReportClient().getCampaignPerformance("access", "123", "LAST_7_DAYS"),
        (error: unknown) => error instanceof GoogleAdsProviderError && error.retryable && error.status === 429,
      );
      assert.equal(calls(), 3);
    }));
  });

  it("retries a transient 503 and rejects rather than returning an empty report", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
    await withFastRetries(() => withMockedFetch([
      new Response("upstream proxy unavailable", { status: 503 }),
      new Response("upstream proxy unavailable", { status: 503 }),
      new Response("upstream proxy unavailable", { status: 503 }),
    ], async (calls) => {
      await assert.rejects(
        new GoogleAdsReportClient().getCampaignPerformance("access", "123", "LAST_7_DAYS"),
        (error: unknown) => error instanceof GoogleAdsProviderError && error.retryable && error.status === 503,
      );
      assert.equal(calls(), 3);
    }));
  });

  it("surfaces non-retryable 4xx responses explicitly", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-token";
    await withMockedFetch([googleError(403, "permission denied")], async (calls) => {
      await assert.rejects(
        new GoogleAdsReportClient().getCampaignPerformance("access", "123", "LAST_7_DAYS"),
        (error: unknown) => error instanceof GoogleAdsProviderError && !error.retryable && error.status === 403,
      );
      assert.equal(calls(), 1);
    });
  });
});
