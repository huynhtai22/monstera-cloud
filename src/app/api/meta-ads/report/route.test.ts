import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { setAuthSessionOverride } from '@/lib/auth-session';
import { encrypt } from '@/lib/encryption';
import { metaReportClient } from '@/lib/meta-ads';
import type { MetaInsightsParams } from '@/lib/meta-ads-contract';
import prisma from '@/lib/prisma';
import { clearMetaReportCacheForTest, POST } from './route';
import { GET as getAsyncReport } from './[reportRunId]/route';

const session = {
  user: { id: 'meta-report-user', email: 'meta-report@example.test' },
  expires: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('POST /api/meta-ads/report query integrity', () => {
  const originalFindFirst = prisma.connection.findFirst;
  const originalGetInsights = metaReportClient.getInsights;
  const originalCreateAsyncReport = metaReportClient.createAsyncReport;
  const originalCheckAsyncReport = metaReportClient.checkAsyncReport;
  const originalFetchAsyncResults = metaReportClient.fetchAsyncResults;
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    clearMetaReportCacheForTest();
    setAuthSessionOverride(async () => session);
  });

  afterEach(() => {
    clearMetaReportCacheForTest();
    setAuthSessionOverride(null);
    prisma.connection.findFirst = originalFindFirst;
    metaReportClient.getInsights = originalGetInsights;
    metaReportClient.createAsyncReport = originalCreateAsyncReport;
    metaReportClient.checkAsyncReport = originalCheckAsyncReport;
    metaReportClient.fetchAsyncResults = originalFetchAsyncResults;
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  function installConnection() {
    prisma.connection.findFirst = (async () => ({
      id: 'conn-meta',
      workspaceId: 'ws-meta',
      provider: 'meta_ads',
      status: 'connected',
      workspace: { plan: 'professional' },
      credentials: encrypt(JSON.stringify({
        accessToken: 'test-token',
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })),
    })) as any;
  }

  function request(body: Record<string, unknown>) {
    return new Request('http://localhost/api/meta-ads/report', {
      method: 'POST',
      body: JSON.stringify({ connectionId: 'conn-meta', adAccountId: 'act_123', ...body }),
    });
  }

  it('rejects unknown identifiers and retired attribution before database, token, or provider contact', async () => {
    let databaseCalls = 0;
    let syncProviderCalls = 0;
    let asyncProviderCalls = 0;
    prisma.connection.findFirst = (async () => { databaseCalls++; return null; }) as typeof prisma.connection.findFirst;
    metaReportClient.getInsights = (async () => { syncProviderCalls++; return [{ spend: '1' }]; }) as any;
    metaReportClient.createAsyncReport = (async () => { asyncProviderCalls++; return 'run'; }) as any;

    for (const [body, code] of [
      [{ fields: ['unknown_field'] }, 'INVALID_FIELD'],
      [{ breakdowns: ['unknown_breakdown'] }, 'INVALID_BREAKDOWN'],
      [{ actionAttributionWindows: ['unknown_window'] }, 'INVALID_ATTRIBUTION_WINDOW'],
      [{ actionAttributionWindows: ['1d_click', '7d_view'] }, 'RETIRED_ATTRIBUTION_WINDOW'],
      [{ actionAttributionWindows: ['28d_view'] }, 'RETIRED_ATTRIBUTION_WINDOW'],
      [{ actionAttributionWindows: ['7d_view', '28d_view'] }, 'RETIRED_ATTRIBUTION_WINDOW'],
      [{ limit: 1 }, 'UNSUPPORTED_LIMIT'],
      [{ filtering: [] }, 'UNSUPPORTED_FILTERING'],
    ] as const) {
      const response = await POST(request(body));
      assert.equal(response.status, 400);
      const payload = await response.json();
      assert.equal(payload.code, code);
      assert.ok(payload.error.length < 160);
    }
    assert.equal(databaseCalls, 0);
    assert.equal(syncProviderCalls, 0);
    assert.equal(asyncProviderCalls, 0);
  });

  it('rejects over-age restricted queries before token or provider contact', async () => {
    installConnection();
    let providerCalls = 0;
    metaReportClient.getInsights = (async () => { providerCalls++; return [{ spend: '1' }]; }) as any;

    const response = await POST(request({
      fields: ['unique_actions'],
      timeRange: { since: '2020-01-01', until: '2020-01-31' },
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'HISTORICAL_DATA_UNAVAILABLE');
    assert.equal(providerCalls, 0);
  });

  it('shares a cache entry for normalized arrays and account IDs', async () => {
    installConnection();
    let providerCalls = 0;
    metaReportClient.getInsights = (async (_token: string, params: MetaInsightsParams) => {
      providerCalls++;
      assert.equal(params.adAccountId, '123');
      return [{ spend: '10' }];
    }) as any;

    const first = await POST(request({
      fields: ['spend', 'clicks'], breakdowns: ['gender', 'age'],
      actionAttributionWindows: ['7d_click', '1d_view'],
    }));
    const second = await POST(new Request('http://localhost/api/meta-ads/report', {
      method: 'POST',
      body: JSON.stringify({
        connectionId: 'conn-meta', adAccountId: '123', fields: ['clicks', 'spend'],
        breakdowns: ['age', 'gender'], actionAttributionWindows: ['1d_view', '7d_click'],
      }),
    }));

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).cached, true);
    assert.equal(providerCalls, 1);
  });

  it('keeps distinct attribution and execution modes out of the same cache entry', async () => {
    installConnection();
    let syncCalls = 0;
    let asyncCalls = 0;
    metaReportClient.getInsights = (async () => { syncCalls++; return [{ spend: '10' }]; }) as any;
    metaReportClient.createAsyncReport = (async () => { asyncCalls++; return 'run-1'; }) as any;

    const oneDay = await POST(request({ actionAttributionWindows: ['1d_click'] }));
    const sevenDay = await POST(request({ actionAttributionWindows: ['7d_click'] }));
    const asyncResponse = await POST(request({ actionAttributionWindows: ['7d_click'], async: true }));

    assert.deepEqual([oneDay.status, sevenDay.status, asyncResponse.status], [200, 200, 200]);
    assert.equal(syncCalls, 2);
    assert.equal(asyncCalls, 1);
  });

  it('supports valid defaults and reports empty provider output as upstream failure', async () => {
    installConnection();
    let captured: unknown;
    metaReportClient.getInsights = (async (_token: string, params: MetaInsightsParams) => {
      captured = params;
      return [{ spend: '10' }];
    }) as any;

    const valid = await POST(request({}));
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { mode: 'sync', rows: [{ spend: '10' }] });
    assert.equal((captured as { level: string }).level, 'campaign');

    clearMetaReportCacheForTest();
    metaReportClient.getInsights = (async () => []) as any;
    const empty = await POST(request({ fields: ['spend'] }));
    assert.equal(empty.status, 502);
    assert.match((await empty.json()).error, /no report rows/);
  });

  it('does not present a completed async report with empty output as a genuine zero', async () => {
    installConnection();
    metaReportClient.checkAsyncReport = (async () => ({
      async_status: 'Job Completed', async_percent_completion: 100,
    })) as any;
    metaReportClient.fetchAsyncResults = (async () => []) as any;

    const empty = await getAsyncReport(
      new Request('http://localhost/api/meta-ads/report/run-1?connectionId=conn-meta') as any,
      { params: Promise.resolve({ reportRunId: 'run-1' }) },
    );
    assert.equal(empty.status, 502);
    assert.match((await empty.json()).error, /completed without report rows/);

    metaReportClient.fetchAsyncResults = (async () => [{ spend: '10.00' }]) as any;
    const rows = await getAsyncReport(
      new Request('http://localhost/api/meta-ads/report/run-1?connectionId=conn-meta') as any,
      { params: Promise.resolve({ reportRunId: 'run-1' }) },
    );
    assert.equal(rows.status, 200);
    assert.deepEqual(await rows.json(), { status: 'COMPLETED', percent: 100, rows: [{ spend: '10.00' }] });
  });
});
